// 本地定时调度器：任务保存在本机 JSON 文件，按 cron 或一次性时间触发，实现任务源接口。
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'
import type { ScheduledTask, TaskReport } from '../../shared/types'
import { nextCronRun } from './cron'
import { TaskActionSchema, type TaskSink, type TaskSource } from './taskSource'

const ScheduledTaskSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  enabled: z.boolean(),
  cron: z.string().nullable(),
  runAt: z.number().nullable(),
  target: z.object({ name: z.string().min(1).max(200), chatType: z.enum(['single', 'group']) }),
  actions: z.array(TaskActionSchema).min(1).max(20),
  lastRunAt: z.number().nullable(),
  lastStatus: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']).nullable(),
  nextRunAt: z.number().nullable()
})

const TICK_MS = 15000
const MISSED_GRACE_MS = 5 * 60 * 1000

export class LocalScheduler implements TaskSource {
  readonly id = 'local-scheduler'
  private tasks = new Map<string, ScheduledTask>()
  private timer: NodeJS.Timeout | null = null
  private sink: TaskSink | null = null

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now
  ) {
    this.load()
  }

  private load(): void {
    if (!existsSync(this.file)) return
    try {
      const raw = z.array(z.unknown()).parse(JSON.parse(readFileSync(this.file, 'utf8')))
      for (const item of raw) {
        const parsed = ScheduledTaskSchema.safeParse(item)
        if (parsed.success) this.tasks.set(parsed.data.id, this.recompute(parsed.data))
      }
    } catch {
      // 任务文件损坏时从空列表开始，原文件保留不覆盖直到下次保存
    }
  }

  private persist(): void {
    const dir = dirname(this.file)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify([...this.tasks.values()], null, 2), 'utf8')
    renameSync(tmp, this.file)
  }

  // 重新计算下一次触发时间；一次性任务错过超过宽限期则不再触发
  private recompute(task: ScheduledTask): ScheduledTask {
    if (!task.enabled) return { ...task, nextRunAt: null }
    const now = this.now()
    if (task.cron) return { ...task, nextRunAt: nextCronRun(task.cron, now) }
    if (task.runAt !== null) {
      if (task.runAt >= now - MISSED_GRACE_MS && task.lastRunAt === null) return { ...task, nextRunAt: task.runAt }
      return { ...task, nextRunAt: null, enabled: false }
    }
    return { ...task, nextRunAt: null }
  }

  list(): ScheduledTask[] {
    return [...this.tasks.values()].sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity))
  }

  save(input: ScheduledTask): ScheduledTask {
    const parsed = ScheduledTaskSchema.parse({ ...input, id: input.id || randomUUID() })
    if (!parsed.cron && parsed.runAt === null) throw new Error('需要填写 cron 表达式或一次性执行时间')
    const task = this.recompute(parsed)
    this.tasks.set(task.id, task)
    this.persist()
    return task
  }

  delete(id: string): void {
    if (this.tasks.delete(id)) this.persist()
  }

  start(sink: TaskSink): void {
    this.sink = sink
    this.stop()
    this.timer = setInterval(() => this.tick(), TICK_MS)
    this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private tick(): void {
    if (!this.sink) return
    const now = this.now()
    let changed = false
    for (const task of this.tasks.values()) {
      if (!task.enabled || task.nextRunAt === null || task.nextRunAt > now) continue
      this.sink.submit({
        id: `${task.id}:${task.nextRunAt}`,
        source: this.id,
        target: task.target,
        actions: task.actions,
        createdAt: now
      })
      const updated = this.recompute({ ...task, lastRunAt: now, lastStatus: 'queued' })
      this.tasks.set(task.id, task.cron ? updated : { ...updated, enabled: false, nextRunAt: null })
      changed = true
    }
    if (changed) this.persist()
  }

  report(report: TaskReport): void {
    const taskId = report.taskId.split(':')[0]
    const task = this.tasks.get(taskId)
    if (!task) return
    this.tasks.set(taskId, { ...task, lastStatus: report.status })
    this.persist()
  }
}
