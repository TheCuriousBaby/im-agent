// 输入后端路由：每次操作按当前设置选择软件模拟（robotjs）或硬件 HID 后端，切换设置无需重启。
// 自动模式下先探测硬件是否可用，可用走硬件，否则走软件；硬件操作失败时本次回退到软件，
// 并按“鼠标”“键盘”两组分别暂停尝试硬件，所以模组里只搭了其中一组指令时，另一组仍然走硬件。
import type { Point } from '../../shared/types'
import type { Settings } from '../../shared/settings'
import { HidUnsupportedError } from './hidProtocol'
import type { InputBackend } from './inputBackend'
import type { MouseButtonName } from './protocol'

export type BackendKind = 'software' | 'hardware'

// 操作所属的指令组，硬件失败按组记录；neutral 不依赖模组指令，不参与失败记录
type OpGroup = 'mouse' | 'keyboard' | 'neutral'

export interface RoutingOptions {
  // 探测硬件模组是否可用：找到串口且模组程序有回应
  probe: () => Promise<boolean>
  // 实际使用的后端发生变化时通知，reason 说明原因，用于写日志
  onSwitch?: (kind: BackendKind, reason: string) => void
  now?: () => number
  // 探测成功、失败后分别缓存多久再重新探测
  okTtlMs?: number
  failTtlMs?: number
  // 某一组指令在硬件上失败后，多久内不再尝试
  groupFailTtlMs?: number
}

const DEFAULT_OK_TTL_MS = 30_000
const DEFAULT_FAIL_TTL_MS = 15_000
const DEFAULT_GROUP_FAIL_TTL_MS = 60_000

export class RoutingInputBackend implements InputBackend {
  private readonly now: () => number
  private readonly okTtlMs: number
  private readonly failTtlMs: number
  private readonly groupFailTtlMs: number
  private readonly groupFailedAt = new Map<OpGroup, number>()
  private probed: { ok: boolean; at: number } | null = null
  private readonly lastKind = new Map<OpGroup, BackendKind>()
  private probing: Promise<boolean> | null = null

  constructor(
    private readonly software: InputBackend,
    private readonly hardware: InputBackend,
    private readonly mode: () => Settings['input']['backend'],
    private readonly options: RoutingOptions
  ) {
    this.now = options.now ?? Date.now
    this.okTtlMs = options.okTtlMs ?? DEFAULT_OK_TTL_MS
    this.failTtlMs = options.failTtlMs ?? DEFAULT_FAIL_TTL_MS
    this.groupFailTtlMs = options.groupFailTtlMs ?? DEFAULT_GROUP_FAIL_TTL_MS
  }

  // 每一组操作各自记录上次用的后端，只在变化时通知，避免键盘走硬件、鼠标走软件时来回刷日志
  private notify(group: OpGroup, kind: BackendKind, reason: string): void {
    if (this.lastKind.get(group) === kind) return
    this.lastKind.set(group, kind)
    this.options.onSwitch?.(kind, group === 'neutral' ? reason : `${group === 'mouse' ? '鼠标' : '键盘'}：${reason}`)
  }

  private hardwareReady(): Promise<boolean> {
    const cached = this.probed
    if (cached && this.now() - cached.at < (cached.ok ? this.okTtlMs : this.failTtlMs)) return Promise.resolve(cached.ok)
    // 并发操作共用同一次探测
    this.probing ??= this.options
      .probe()
      .catch(() => false)
      .then((ok) => {
        this.probed = { ok, at: this.now() }
        return ok
      })
      .finally(() => {
        this.probing = null
      })
    return this.probing
  }

  private groupBlocked(group: OpGroup): boolean {
    const failedAt = this.groupFailedAt.get(group)
    return failedAt !== undefined && this.now() - failedAt < this.groupFailTtlMs
  }

  private async run<T>(group: OpGroup, op: (backend: InputBackend) => Promise<T>): Promise<T> {
    const mode = this.mode()
    if (mode === 'software') {
      this.notify(group, 'software', '设置为软件模拟')
      return op(this.software)
    }
    if (mode === 'hardware') {
      this.notify(group, 'hardware', '设置为硬件 HID 模组')
      return op(this.hardware)
    }
    if ((await this.hardwareReady()) && !this.groupBlocked(group)) {
      try {
        const result = await op(this.hardware)
        this.notify(group, 'hardware', '自动识别到硬件 HID 模组')
        return result
      } catch (error) {
        // 硬件表达不了的输入（如中文、冷门按键）只让这一次走软件，硬件本身仍可用
        if (error instanceof HidUnsupportedError) return op(this.software)
        if (group === 'neutral') throw error
        this.groupFailedAt.set(group, this.now())
        this.notify(group, 'software', `硬件 HID 模组操作失败（${(error as Error).message}），这一类操作回退到软件模拟`)
        return op(this.software)
      }
    }
    this.notify(group, 'software', this.groupBlocked(group) ? '硬件 HID 模组这一类操作暂时不可用，使用软件模拟' : '没有识别到可用的硬件 HID 模组，使用软件模拟')
    return op(this.software)
  }

  moveTo(point: Point, humanize: boolean): Promise<void> {
    return this.run('mouse', (b) => b.moveTo(point, humanize))
  }

  click(button?: MouseButtonName, double?: boolean): Promise<void> {
    return this.run('mouse', (b) => b.click(button, double))
  }

  keyTap(key: string, modifiers?: string[]): Promise<void> {
    return this.run('keyboard', (b) => b.keyTap(key, modifiers))
  }

  typeString(text: string): Promise<void> {
    return this.run('keyboard', (b) => b.typeString(text))
  }

  scroll(dy: number): Promise<void> {
    return this.run('mouse', (b) => b.scroll(dy))
  }

  mousePosition(): Promise<Point> {
    return this.run('neutral', (b) => b.mousePosition())
  }

  // 设置里的串口或输入方式变了，丢掉缓存的探测结果，下一次操作重新探测
  reset(): void {
    this.probed = null
    this.groupFailedAt.clear()
  }

  dispose(): void {
    this.software.dispose()
    this.hardware.dispose()
  }
}
