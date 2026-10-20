// 智能体页：管理多套回复提示词，同一时间只有一个智能体处于开启状态，开启的那个决定回复风格。
import { useState } from 'react'
import { DEFAULT_SYSTEM_PROMPT, type Agent } from '../../../shared/settings'
import { IconPlus } from '../icons'
import { useSettingsContext } from './SettingsContext'

interface Form {
  id: string
  name: string
  description: string
  prompt: string
}

const NEW_FORM: Form = { id: '', name: '', description: '', prompt: DEFAULT_SYSTEM_PROMPT }

export function AgentsSection(): React.JSX.Element {
  const { draft, commit, busy, message } = useSettingsContext()
  const [form, setForm] = useState<Form | null>(null)

  const agents = [...draft.agents].sort((a, b) => Number(b.pinned) - Number(a.pinned))

  const update = (id: string, change: Partial<Agent>): Promise<void> =>
    commit({ agents: draft.agents.map((a) => (a.id === id ? { ...a, ...change } : a)) })

  const toggle = (agent: Agent): Promise<void> =>
    commit({ agents: draft.agents.map((a) => ({ ...a, enabled: a.id === agent.id ? !agent.enabled : false })) })

  const remove = async (agent: Agent): Promise<void> => {
    if (!window.confirm(`确认删除智能体「${agent.name}」？`)) return
    await commit({ agents: draft.agents.filter((a) => a.id !== agent.id) })
  }

  const saveForm = async (): Promise<void> => {
    if (!form || !form.name.trim() || !form.prompt.trim()) return
    if (form.id) {
      await update(form.id, { name: form.name.trim(), description: form.description.trim(), prompt: form.prompt })
    } else {
      const created: Agent = {
        id: crypto.randomUUID(),
        name: form.name.trim(),
        description: form.description.trim(),
        prompt: form.prompt,
        enabled: draft.agents.every((a) => !a.enabled),
        pinned: false
      }
      await commit({ agents: [...draft.agents, created] })
    }
    setForm(null)
  }

  return (
    <div className="section">
      <div className="toolbar">
        <button className="pill-button" onClick={() => setForm(NEW_FORM)}>
          <IconPlus size={16} />
          <span>新建智能体</span>
        </button>
        {message && <span className="error">{message}</span>}
      </div>

      <div className="agent-table">
        <div className="agent-head">
          <span>智能体名称</span>
          <span>智能体描述</span>
          <span>开启状态</span>
          <span>操作</span>
        </div>
        {agents.length === 0 && <div className="agent-empty">还没有智能体，未开启任何智能体时使用内置的默认提示词。</div>}
        {agents.map((agent) => (
          <div key={agent.id} className="agent-row">
            <span className="agent-name">
              {agent.pinned && <i className="pin" />}
              {agent.name}
            </span>
            <span className="agent-desc">{agent.description || agent.prompt}</span>
            <span>
              <button
                className={agent.enabled ? 'switch on' : 'switch'}
                disabled={busy}
                onClick={() => void toggle(agent)}
              >
                <i />
              </button>
            </span>
            <span className="agent-actions">
              <button
                className="link"
                onClick={() =>
                  setForm({ id: agent.id, name: agent.name, description: agent.description, prompt: agent.prompt })
                }
              >
                编辑
              </button>
              <button className="link danger" onClick={() => void remove(agent)}>
                删除
              </button>
              <button className="link" onClick={() => void update(agent.id, { pinned: !agent.pinned })}>
                {agent.pinned ? '取消置顶' : '置顶'}
              </button>
            </span>
          </div>
        ))}
      </div>
      <div className="table-foot">共 {agents.length} 个智能体</div>

      {form && (
        <div className="modal-mask">
          <div className="modal">
            <h3>{form.id ? '编辑智能体' : '新建智能体'}</h3>
            <label className="field">
              <span>名称</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="field">
              <span>描述</span>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            <label className="field">
              <span>提示词（决定回复的角色、语气与规则，需要要求模型只输出 JSON 的部分由程序自动追加）</span>
              <textarea rows={10} value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} />
            </label>
            <div className="row">
              <button className="primary" disabled={busy || !form.name.trim() || !form.prompt.trim()} onClick={() => void saveForm()}>
                保存
              </button>
              <button onClick={() => setForm(null)}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
