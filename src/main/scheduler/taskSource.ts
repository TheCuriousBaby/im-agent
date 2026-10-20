// 任务源与回报的统一接口，以及任务消息的校验；本地调度、本机 API、远程 WebSocket 都实现这套接口。
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { TaskMessage, TaskReport } from '../../shared/types'

export interface TaskSink {
  submit(task: TaskMessage): void
}

export interface TaskSource {
  readonly id: string
  start(sink: TaskSink): void | Promise<void>
  stop(): void | Promise<void>
  // 引擎执行完任务后回报结果，任务源按需转发（本地调度更新状态，远程源回传服务端）
  report?(report: TaskReport): void | Promise<void>
}

export const TaskActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().min(1).max(5000) }),
  z.object({ type: z.literal('image'), path: z.string().min(1).max(1024) })
])

export const TaskInputSchema = z.object({
  id: z.string().min(1).max(128).optional(),
  target: z.object({
    name: z.string().min(1).max(200),
    chatType: z.enum(['single', 'group']).default('single')
  }),
  actions: z.array(TaskActionSchema).min(1).max(20)
})

export type TaskInput = z.infer<typeof TaskInputSchema>

export function toTaskMessage(input: TaskInput, source: string, now: number = Date.now()): TaskMessage {
  return {
    id: input.id ?? randomUUID(),
    source,
    target: input.target,
    actions: input.actions,
    createdAt: now
  }
}
