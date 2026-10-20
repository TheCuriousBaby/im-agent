// 定时任务页：维护本地定时任务，支持 cron 周期执行与一次性执行，动作为文字或图片。
import { useEffect, useState } from 'react'
import type { ScheduledTask, TaskAction, TaskStatus } from '../../../shared/types'
import { formatTime, fromLocalInput, toLocalInput } from '../format'

const STATUS_LABELS: Record<TaskStatus, string> = {
  queued: '已入队',
  running: '执行中',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已中断'
}

const IMAGE_PREFIX = /^(图片|image)[:：]\s*/i

function actionsToText(actions: TaskAction[]): string {
  return actions.map((a) => (a.type === 'text' ? a.text : `图片：${a.path}`)).join('\n')
}

function textToActions(text: string): TaskAction[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      IMAGE_PREFIX.test(line)
        ? { type: 'image' as const, path: line.replace(IMAGE_PREFIX, '') }
        : { type: 'text' as const, text: line }
    )
}

interface Form {
  id: string
  name: string
  enabled: boolean
  mode: 'cron' | 'once'
  cron: string
  runAt: string
  targetName: string
  chatType: 'single' | 'group'
  actions: string
}

const EMPTY_FORM: Form = {
  id: '',
  name: '',
  enabled: true,
  mode: 'cron',
  cron: '0 9 * * 1-5',
  runAt: '',
  targetName: '',
  chatType: 'single',
  actions: ''
}

function toForm(task: ScheduledTask): Form {
  return {
    id: task.id,
    name: task.name,
    enabled: task.enabled,
    mode: task.cron ? 'cron' : 'once',
    cron: task.cron ?? '0 9 * * 1-5',
    runAt: toLocalInput(task.runAt),
    targetName: task.target.name,
    chatType: task.target.chatType,
    actions: actionsToText(task.actions)
  }
}

export function TasksPage(): React.JSX.Element {
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [form, setForm] = useState<Form>(EMPTY_FORM)
  const [message, setMessage] = useState('')

  const reload = async (): Promise<void> => setTasks(await window.imAgent.tasks.list())

  useEffect(() => {
    void reload()
  }, [])

  const save = async (): Promise<void> => {
    setMessage('')
    try {
      const actions = textToActions(form.actions)
      const runAt = form.mode === 'once' ? fromLocalInput(form.runAt) : null
      if (form.mode === 'once' && runAt === null) throw new Error('请选择执行时间')
      const existing = tasks.find((t) => t.id === form.id)
      await window.imAgent.tasks.save({
        id: form.id,
        name: form.name.trim(),
        enabled: form.enabled,
        cron: form.mode === 'cron' ? form.cron.trim() : null,
        runAt,
        target: { name: form.targetName.trim(), chatType: form.chatType },
        actions,
        lastRunAt: existing?.lastRunAt ?? null,
        lastStatus: existing?.lastStatus ?? null,
        nextRunAt: null
      })
      setForm(EMPTY_FORM)
      await reload()
      setMessage('已保存')
    } catch (error) {
      setMessage(`保存失败：${(error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`)
    }
  }

  const remove = async (task: ScheduledTask): Promise<void> => {
    if (!window.confirm(`确认删除任务「${task.name}」？`)) return
    await window.imAgent.tasks.delete(task.id)
    if (form.id === task.id) setForm(EMPTY_FORM)
    await reload()
  }

  const set = <K extends keyof Form>(key: K, value: Form[K]): void => setForm({ ...form, [key]: value })

  return (
    <div className="page two-col">
      <section className="card list">
        <h2>任务列表</h2>
        {tasks.length === 0 && <p className="muted">还没有定时任务。</p>}
        {tasks.map((t) => (
          <div key={t.id} className="item static">
            <div className="row spread">
              <strong>{t.name}</strong>
              <span className="muted">{t.enabled ? '已启用' : '已停用'}</span>
            </div>
            <span className="muted">
              发送给「{t.target.name}」　{t.cron ?? `一次性 ${formatTime(t.runAt)}`}
            </span>
            <span className="muted">
              下次：{formatTime(t.nextRunAt)}　上次结果：{t.lastStatus ? STATUS_LABELS[t.lastStatus] : '无'}
            </span>
            <div className="row">
              <button onClick={() => setForm(toForm(t))}>编辑</button>
              <button onClick={() => void remove(t)}>删除</button>
            </div>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>{form.id ? '编辑任务' : '新建任务'}</h2>
        <label className="field">
          <span>任务名称</span>
          <input value={form.name} onChange={(e) => set('name', e.target.value)} />
        </label>
        <div className="grid">
          <label className="field">
            <span>发送给（会话名称）</span>
            <input value={form.targetName} onChange={(e) => set('targetName', e.target.value)} />
          </label>
          <label className="field">
            <span>会话类型</span>
            <select value={form.chatType} onChange={(e) => set('chatType', e.target.value as 'single' | 'group')}>
              <option value="single">单聊</option>
              <option value="group">群聊</option>
            </select>
          </label>
          <label className="field">
            <span>触发方式</span>
            <select value={form.mode} onChange={(e) => set('mode', e.target.value as 'cron' | 'once')}>
              <option value="cron">周期（cron）</option>
              <option value="once">一次性</option>
            </select>
          </label>
          {form.mode === 'cron' ? (
            <label className="field">
              <span>cron 表达式（分 时 日 月 周）</span>
              <input value={form.cron} onChange={(e) => set('cron', e.target.value)} />
            </label>
          ) : (
            <label className="field">
              <span>执行时间</span>
              <input type="datetime-local" value={form.runAt} onChange={(e) => set('runAt', e.target.value)} />
            </label>
          )}
        </div>
        <label className="field">
          <span>发送内容（每行一条；以“图片：”开头的行表示发送该路径的图片）</span>
          <textarea rows={6} value={form.actions} onChange={(e) => set('actions', e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />
          <span>启用</span>
        </label>
        <div className="row">
          <button className="primary" onClick={() => void save()}>
            保存任务
          </button>
          {form.id && <button onClick={() => setForm(EMPTY_FORM)}>取消编辑</button>}
          {message && <span className={message.startsWith('保存失败') ? 'error' : 'ok'}>{message}</span>}
        </div>
        <p className="muted">任务只有在引擎启动并选定目标窗口后才会执行。</p>
      </section>
    </div>
  )
}
