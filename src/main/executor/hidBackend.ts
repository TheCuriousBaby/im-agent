// 硬件 HID 输入后端：把键鼠操作编码成串口文本指令交给外接 HID 模组，由模组向本机输出真实的 USB 键鼠信号。
// 链路（串口）通过 HidLink 注入，所以本文件不依赖 Electron 和串口库，可以直接单元测试。
import type { Point, Rect } from '../../shared/types'
import { bezierPath, randomInt, type Rand } from './humanize'
import type { InputBackend } from './inputBackend'
import { hidCommands, isAck, toHidAxis } from './hidProtocol'
import type { MouseButtonName } from './protocol'

export interface HidLink {
  write(line: string): Promise<void>
  onLine(listener: (line: string) => void): void
  onClose(listener: (error?: Error) => void): void
  close(): void
}

export interface HidBackendDeps {
  connect: () => Promise<HidLink>
  // 主屏的物理像素范围，HID 绝对坐标按它换算
  screen: () => Rect
  // 当前系统光标位置，拟人化轨迹的起点
  cursor: () => Point
  // 模组是否对每条指令回 OK；关闭时发送后只等一个很短的间隔
  ack: () => boolean
  ackTimeoutMs?: number
  noAckDelayMs?: number
  sleep?: (ms: number) => Promise<void>
  rand?: Rand
}

const DEFAULT_ACK_TIMEOUT_MS = 3000
const DEFAULT_NO_ACK_DELAY_MS = 8
// 等待回执期间的心跳间隔：serialport 在 Windows 上的收发回调只在事件循环被唤醒时才处理，
// 空闲等待时回复会被拖到下一个定时器触发（实测等于整个超时时间），所以等待时需要短定时器保持事件循环转动
const WAIT_TICK_MS = 5

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

interface AckWaiter {
  resolve: () => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export class HidInputBackend implements InputBackend {
  private link: HidLink | null = null
  private connecting: Promise<HidLink> | null = null
  private waiter: AckWaiter | null = null
  private tick: NodeJS.Timeout | null = null
  private tail: Promise<unknown> = Promise.resolve()
  private readonly sleep: (ms: number) => Promise<void>
  private readonly rand: Rand

  constructor(private readonly deps: HidBackendDeps) {
    this.sleep = deps.sleep ?? realSleep
    this.rand = deps.rand ?? Math.random
  }

  private async ensureLink(): Promise<HidLink> {
    if (this.link) return this.link
    if (!this.connecting) {
      this.connecting = this.deps
        .connect()
        .then((link) => {
          link.onLine((line) => {
            if (isAck(line)) this.settleWaiter()
          })
          link.onClose((error) => {
            if (this.link === link) this.link = null
            this.settleWaiter(error ?? new Error('硬件 HID 串口已断开'))
          })
          this.link = link
          return link
        })
        .finally(() => {
          this.connecting = null
        })
    }
    return this.connecting
  }

  private stopTick(): void {
    if (this.tick) clearInterval(this.tick)
    this.tick = null
  }

  private settleWaiter(error?: Error): void {
    const waiter = this.waiter
    if (!waiter) return
    this.waiter = null
    clearTimeout(waiter.timer)
    this.stopTick()
    if (error) waiter.reject(error)
    else waiter.resolve()
  }

  // 指令串行发送：同一时刻只有一条在等待模组回执
  private send(command: string, probe?: { ackTimeoutMs: number }): Promise<void> {
    const run = async (): Promise<void> => {
      const link = await this.ensureLink()
      if (!probe && !this.deps.ack()) {
        await link.write(command)
        await this.sleep(this.deps.noAckDelayMs ?? DEFAULT_NO_ACK_DELAY_MS)
        return
      }
      const acked = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (this.waiter?.timer === timer) {
            this.waiter = null
            this.stopTick()
          }
          reject(new Error(`硬件 HID 模组没有回应指令“${command}”，请检查模组里的 cyStudio 程序是否已下载并运行`))
        }, probe?.ackTimeoutMs ?? this.deps.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS)
        this.waiter = { resolve, reject, timer }
        this.tick = setInterval(() => undefined, WAIT_TICK_MS)
      })
      // 写入出错或卡住都通过回执等待来收口，不单独等待写入，避免写入卡住时永远不返回
      void link.write(command).catch((error: Error) => this.settleWaiter(error))
      await acked
    }
    const result = this.tail.then(run, run)
    this.tail = result.catch(() => undefined)
    return result
  }

  async moveTo(point: Point, humanize: boolean): Promise<void> {
    const screen = this.deps.screen()
    const target = { x: Math.round(point.x), y: Math.round(point.y) }
    if (!humanize) {
      await this.send(hidCommands.move(toHidAxis(target, screen)))
      return
    }
    for (const step of bezierPath(this.deps.cursor(), target, {}, this.rand)) {
      await this.send(hidCommands.move(toHidAxis(step, screen)))
      if (step.delayMs > 0) await this.sleep(step.delayMs)
    }
  }

  private async clickOnce(button: MouseButtonName): Promise<void> {
    await this.send(hidCommands.buttonDown(button))
    await this.sleep(randomInt(60, 140, this.rand))
    await this.send(hidCommands.buttonUp(button))
  }

  async click(button: MouseButtonName = 'left', double = false): Promise<void> {
    await this.clickOnce(button)
    if (double) {
      await this.sleep(randomInt(60, 110, this.rand))
      await this.clickOnce(button)
    }
  }

  async keyTap(key: string, modifiers: string[] = []): Promise<void> {
    await this.send(hidCommands.keyTap(key, modifiers))
  }

  async typeString(text: string): Promise<void> {
    await this.send(hidCommands.typeText(text))
  }

  async scroll(dy: number): Promise<void> {
    await this.send(hidCommands.scroll(dy))
  }

  async mousePosition(): Promise<Point> {
    return this.deps.cursor()
  }

  // 连通性自检：必须有回执才能确认模组里的程序在运行，所以不受“关闭回执”设置影响
  async ping(timeoutMs = 1500): Promise<void> {
    await this.send(hidCommands.ping(), { ackTimeoutMs: timeoutMs })
  }

  dispose(): void {
    this.stopTick()
    this.settleWaiter(new Error('硬件 HID 后端已关闭'))
    this.link?.close()
    this.link = null
  }
}
