// 已选目标窗口：主进程里唯一的一份，选取方式（浮层、快捷键）和引擎都从这里读写。
import type { TargetWindow } from '../../shared/types'

type Listener = (target: TargetWindow | null) => void

export class TargetSelection {
  private current: TargetWindow | null = null
  private readonly listeners = new Set<Listener>()

  get(): TargetWindow | null {
    return this.current
  }

  set(target: TargetWindow | null): void {
    this.current = target
    for (const listener of this.listeners) listener(target)
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
