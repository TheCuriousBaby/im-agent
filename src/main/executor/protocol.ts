// 主进程与输入执行子进程之间的消息协议。
export type MouseButtonName = 'left' | 'right' | 'middle'

export type InputRequest =
  | { id: number; op: 'ping' }
  | { id: number; op: 'moveTo'; x: number; y: number; humanize: boolean }
  | { id: number; op: 'click'; button: MouseButtonName; double: boolean }
  | { id: number; op: 'keyTap'; key: string; modifiers: string[] }
  | { id: number; op: 'typeString'; text: string }
  | { id: number; op: 'scroll'; dy: number }
  | { id: number; op: 'mousePos' }

export type InputRequestBody = InputRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never

export type InputResponse =
  | { id: number; ok: true; result?: unknown }
  | { id: number; ok: false; error: string }
