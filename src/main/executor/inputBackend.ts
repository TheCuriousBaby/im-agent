// 输入后端：把键鼠原子操作交给 robotjs 子进程；其他后端（如外接硬件）实现同一接口即可替换。
import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import type { Point } from '../../shared/types'
import type { InputRequestBody, InputResponse, MouseButtonName } from './protocol'

export interface InputBackend {
  moveTo(point: Point, humanize: boolean): Promise<void>
  click(button?: MouseButtonName, double?: boolean): Promise<void>
  keyTap(key: string, modifiers?: string[]): Promise<void>
  typeString(text: string): Promise<void>
  scroll(dy: number): Promise<void>
  mousePosition(): Promise<Point>
  dispose(): void
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: NodeJS.Timeout
}

const REQUEST_TIMEOUT_MS = 15000

export class RobotInputBackend implements InputBackend {
  private child: UtilityProcess | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()

  private ensureChild(): UtilityProcess {
    if (this.child) return this.child
    const child = utilityProcess.fork(join(__dirname, 'inputWorker.js'), [], { serviceName: 'im-agent-input' })
    child.on('message', (response: InputResponse) => {
      const entry = this.pending.get(response.id)
      if (!entry) return
      clearTimeout(entry.timer)
      this.pending.delete(response.id)
      if (response.ok) entry.resolve(response.result)
      else entry.reject(new Error(response.error))
    })
    child.on('exit', () => {
      if (this.child === child) this.child = null
      for (const [id, entry] of this.pending) {
        clearTimeout(entry.timer)
        entry.reject(new Error('输入执行进程已退出'))
        this.pending.delete(id)
      }
    })
    this.child = child
    return child
  }

  private request(body: InputRequestBody): Promise<unknown> {
    const child = this.ensureChild()
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('输入执行超时'))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      child.postMessage({ id, ...body })
    })
  }

  async moveTo(point: Point, humanize: boolean): Promise<void> {
    await this.request({ op: 'moveTo', x: point.x, y: point.y, humanize })
  }

  async click(button: MouseButtonName = 'left', double = false): Promise<void> {
    await this.request({ op: 'click', button, double })
  }

  async keyTap(key: string, modifiers: string[] = []): Promise<void> {
    await this.request({ op: 'keyTap', key, modifiers })
  }

  async typeString(text: string): Promise<void> {
    await this.request({ op: 'typeString', text })
  }

  async scroll(dy: number): Promise<void> {
    await this.request({ op: 'scroll', dy })
  }

  async mousePosition(): Promise<Point> {
    return (await this.request({ op: 'mousePos' })) as Point
  }

  dispose(): void {
    this.child?.kill()
    this.child = null
  }
}
