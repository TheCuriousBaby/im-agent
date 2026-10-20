// localScheduler 的单元测试：入队触发、一次性任务、持久化与结果回写。
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { ScheduledTask, TaskMessage } from '../../shared/types'
import { LocalScheduler } from './localScheduler'

function draft(overrides: Partial<ScheduledTask>): ScheduledTask {
  return {
    id: '',
    name: '测试任务',
    enabled: true,
    cron: null,
    runAt: null,
    target: { name: '张三', chatType: 'single' },
    actions: [{ type: 'text', text: '你好' }],
    lastRunAt: null,
    lastStatus: null,
    nextRunAt: null,
    ...overrides
  }
}

function withScheduler(now: () => number, run: (s: LocalScheduler, file: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'im-agent-tasks-'))
  const file = join(dir, 'tasks.json')
  try {
    run(new LocalScheduler(file, now), file)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('必须提供 cron 或一次性时间', () => {
  withScheduler(Date.now, (s) => {
    assert.throws(() => s.save(draft({})), /cron/)
  })
})

test('一次性任务到点触发一次后停用，并更新回报状态', () => {
  const now = new Date(2026, 9, 20, 9, 0).getTime()
  withScheduler(
    () => now,
    (s) => {
      const saved = s.save(draft({ runAt: now }))
      assert.equal(saved.nextRunAt, now)
      const received: TaskMessage[] = []
      s.start({ submit: (t) => received.push(t) })
      s.stop()
      assert.equal(received.length, 1)
      assert.equal(received[0].id, `${saved.id}:${now}`)
      assert.equal(received[0].target.name, '张三')
      const after = s.list()[0]
      assert.equal(after.enabled, false)
      assert.equal(after.nextRunAt, null)
      s.report({ taskId: received[0].id, status: 'succeeded', finishedAt: now })
      assert.equal(s.list()[0].lastStatus, 'succeeded')
    }
  )
})

test('周期任务未到点不触发，且下一次时间已计算', () => {
  const now = new Date(2026, 9, 20, 10, 0).getTime()
  withScheduler(
    () => now,
    (s) => {
      const saved = s.save(draft({ cron: '0 9 * * *' }))
      assert.ok((saved.nextRunAt ?? 0) > now)
      const received: TaskMessage[] = []
      s.start({ submit: (t) => received.push(t) })
      s.stop()
      assert.equal(received.length, 0)
    }
  )
})

test('任务保存在文件里，重新创建调度器后仍在', () => {
  const now = new Date(2026, 9, 20, 10, 0).getTime()
  withScheduler(
    () => now,
    (s, file) => {
      s.save(draft({ cron: '0 9 * * *' }))
      assert.equal(new LocalScheduler(file, () => now).list().length, 1)
    }
  )
})

test('删除任务', () => {
  const now = new Date(2026, 9, 20, 10, 0).getTime()
  withScheduler(
    () => now,
    (s) => {
      const saved = s.save(draft({ cron: '0 9 * * *' }))
      s.delete(saved.id)
      assert.equal(s.list().length, 0)
    }
  )
})
