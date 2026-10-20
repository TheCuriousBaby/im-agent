// 联系人画像页：查看、编辑、删除，并支持整体导出与导入 JSON。
import { useEffect, useRef, useState } from 'react'
import type { ContactProfile } from '../../../shared/types'
import { formatTime } from '../format'

const splitLines = (text: string): string[] =>
  text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

export function ProfilesPage(): React.JSX.Element {
  const [profiles, setProfiles] = useState<ContactProfile[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tags, setTags] = useState('')
  const [facts, setFacts] = useState('')
  const [preferences, setPreferences] = useState('')
  const [summary, setSummary] = useState('')
  const [message, setMessage] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const reload = async (): Promise<ContactProfile[]> => {
    const list = await window.imAgent.profiles.list()
    setProfiles(list)
    return list
  }

  useEffect(() => {
    void reload()
  }, [])

  const selected = profiles.find((p) => p.id === selectedId) ?? null

  const select = (profile: ContactProfile): void => {
    setSelectedId(profile.id)
    setTags(profile.tags.join('、'))
    setFacts(profile.facts.join('\n'))
    setPreferences(profile.preferences.join('\n'))
    setSummary(profile.summary)
    setMessage('')
  }

  const save = async (): Promise<void> => {
    if (!selected) return
    await window.imAgent.profiles.save({
      ...selected,
      tags: tags
        .split(/[、,，\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
      facts: splitLines(facts),
      preferences: splitLines(preferences),
      summary: summary.trim()
    })
    await reload()
    setMessage('已保存')
  }

  const remove = async (): Promise<void> => {
    if (!selected || !window.confirm(`确认删除「${selected.name}」的画像？`)) return
    await window.imAgent.profiles.delete(selected.id)
    setSelectedId(null)
    await reload()
  }

  const exportAll = async (): Promise<void> => {
    const json = await window.imAgent.profiles.exportAll()
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'im-agent-profiles.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  const importFile = async (file: File): Promise<void> => {
    try {
      const count = await window.imAgent.profiles.importAll(await file.text())
      await reload()
      setMessage(`已导入 ${count} 条画像`)
    } catch (error) {
      setMessage(`导入失败：${(error as Error).message}`)
    }
  }

  return (
    <div className="page two-col">
      <section className="card list">
        <div className="row spread">
          <h2>联系人</h2>
          <div className="row">
            <button onClick={() => void exportAll()}>导出</button>
            <button onClick={() => fileRef.current?.click()}>导入</button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void importFile(file)
                e.target.value = ''
              }}
            />
          </div>
        </div>
        {profiles.length === 0 && <p className="muted">还没有画像，引擎运行并收到消息后会自动创建。</p>}
        {profiles.map((p) => (
          <button key={p.id} className={p.id === selectedId ? 'item active' : 'item'} onClick={() => select(p)}>
            <strong>{p.name}</strong>
            <span className="muted">
              {p.chatType === 'group' ? '群聊' : '单聊'}　{p.messageCount} 条　{formatTime(p.lastSeen)}
            </span>
          </button>
        ))}
      </section>

      <section className="card">
        {!selected && <p className="muted">选择左侧联系人查看和编辑画像。{message}</p>}
        {selected && (
          <>
            <h2>{selected.name}</h2>
            <label className="field">
              <span>标签（用顿号或逗号分隔）</span>
              <input value={tags} onChange={(e) => setTags(e.target.value)} />
            </label>
            <label className="field">
              <span>已知信息（每行一条）</span>
              <textarea rows={6} value={facts} onChange={(e) => setFacts(e.target.value)} />
            </label>
            <label className="field">
              <span>沟通偏好（每行一条）</span>
              <textarea rows={4} value={preferences} onChange={(e) => setPreferences(e.target.value)} />
            </label>
            <label className="field">
              <span>往来摘要</span>
              <textarea rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} />
            </label>
            <div className="row">
              <button className="primary" onClick={() => void save()}>
                保存
              </button>
              <button onClick={() => void remove()}>删除</button>
              {message && <span className={message.includes('失败') ? 'error' : 'ok'}>{message}</span>}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
