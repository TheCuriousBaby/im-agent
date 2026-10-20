// 消息追踪：按会话记住已见消息，通过前后两次识别结果的重叠部分找出新增消息。
import type { ObservedMessage } from '../../shared/types'

export function messageKey(message: ObservedMessage): string {
  return `${message.role}|${message.text.replace(/\s+/g, ' ').trim()}`
}

// 取上一次列表的后缀与本次列表前缀的最长重叠，重叠之后的部分即新增消息
export function findNewMessages(previous: ObservedMessage[], current: ObservedMessage[]): ObservedMessage[] {
  const prevKeys = previous.map(messageKey)
  const curKeys = current.map(messageKey)
  const max = Math.min(prevKeys.length, curKeys.length)
  for (let k = max; k > 0; k--) {
    let same = true
    for (let i = 0; i < k; i++) {
      if (prevKeys[prevKeys.length - k + i] !== curKeys[i]) {
        same = false
        break
      }
    }
    if (same) return current.slice(k)
  }
  return current
}

export function normalizeTitle(title: string): string {
  return title.replace(/[（(]\d+[）)]\s*$/, '').replace(/\s+/g, '').toLowerCase()
}

export class MessageTracker {
  private readonly seen = new Map<string, ObservedMessage[]>()
  private static readonly MAX_CONVERSATIONS = 200

  has(title: string): boolean {
    return this.seen.has(normalizeTitle(title))
  }

  // 记录当前会话的全部可见消息并返回其中的新增消息；首次见到的会话返回空，视为历史基线
  update(title: string, messages: ObservedMessage[], treatAllAsNew = false): ObservedMessage[] {
    const key = normalizeTitle(title)
    const previous = this.seen.get(key)
    this.seen.delete(key)
    this.seen.set(key, messages)
    if (this.seen.size > MessageTracker.MAX_CONVERSATIONS) {
      const oldest = this.seen.keys().next().value
      if (oldest !== undefined) this.seen.delete(oldest)
    }
    if (!previous) return treatAllAsNew ? messages : []
    return findNewMessages(previous, messages)
  }

  // 失败重试时用：取出某会话当前记录的消息，之后可用 restore 回退到这个状态
  snapshot(title: string): ObservedMessage[] | undefined {
    return this.seen.get(normalizeTitle(title))
  }

  restore(title: string, messages: ObservedMessage[] | undefined): void {
    const key = normalizeTitle(title)
    if (messages === undefined) this.seen.delete(key)
    else this.seen.set(key, messages)
  }

  reset(title: string): void {
    this.seen.delete(normalizeTitle(title))
  }

  clear(): void {
    this.seen.clear()
  }
}
