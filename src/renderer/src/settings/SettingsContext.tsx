// 设置窗口共享的草稿状态：各页面读写同一份设置，密钥单独暂存，保存时合并。
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { EVENTS } from '../../../shared/ipc'
import { publicToInput, type PublicSettings } from '../../../shared/settings'
import type { ModelRole, TestResult } from '../../../shared/types'
import { cleanError } from '../hooks'

export interface Secrets {
  vision: string
  reply: string
  profile: string
  remote: string
}

const EMPTY_SECRETS: Secrets = { vision: '', reply: '', profile: '', remote: '' }

interface SettingsContextValue {
  draft: PublicSettings
  patch: (next: Partial<PublicSettings>) => void
  // 立即应用并保存，用于列表类操作（启停、删除智能体）
  commit: (next: Partial<PublicSettings>) => Promise<void>
  secrets: Secrets
  setSecret: (key: keyof Secrets, value: string) => void
  save: () => Promise<void>
  saveAndTest: (role: ModelRole) => Promise<void>
  busy: boolean
  message: string
  results: Partial<Record<ModelRole, TestResult>>
}

const Context = createContext<SettingsContextValue | null>(null)

export function useSettingsContext(): SettingsContextValue {
  const value = useContext(Context)
  if (!value) throw new Error('缺少设置上下文')
  return value
}

export function SettingsProvider(props: { children: ReactNode }): React.JSX.Element {
  const [draft, setDraft] = useState<PublicSettings | null>(null)
  const [secrets, setSecrets] = useState<Secrets>(EMPTY_SECRETS)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [results, setResults] = useState<Partial<Record<ModelRole, TestResult>>>({})

  useEffect(() => {
    void window.imAgent.settings.get().then(setDraft)
    // 主面板上调整回复方式与速度时，同步这三项，不覆盖设置窗口里尚未保存的其他修改
    return window.imAgent.on(EVENTS.settings, (incoming) => {
      setDraft((current) =>
        current
          ? {
              ...current,
              engine: {
                ...current.engine,
                replyMode: incoming.engine.replyMode,
                pollIntervalMs: incoming.engine.pollIntervalMs,
                afterReplyPollMs: incoming.engine.afterReplyPollMs
              }
            }
          : incoming
      )
    })
  }, [])

  if (!draft) return <div className="loading">读取中</div>

  const toInput = (source: PublicSettings): ReturnType<typeof publicToInput> => {
    const input = publicToInput(source)
    input.vision.apiKey = secrets.vision
    if (input.reply) input.reply.apiKey = secrets.reply
    if (input.profile) input.profile.apiKey = secrets.profile
    input.remote.token = secrets.remote
    return input
  }

  const persist = async (source: PublicSettings): Promise<void> => {
    const saved = await window.imAgent.settings.save(toInput(source))
    setDraft(saved)
    setSecrets(EMPTY_SECRETS)
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    setMessage('')
    try {
      await persist(draft)
      setMessage('已保存')
    } catch (error) {
      setMessage(`保存失败：${cleanError(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const commit = async (next: Partial<PublicSettings>): Promise<void> => {
    const merged = { ...draft, ...next }
    setDraft(merged)
    setBusy(true)
    setMessage('')
    try {
      await persist(merged)
    } catch (error) {
      setMessage(`保存失败：${cleanError(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const saveAndTest = async (role: ModelRole): Promise<void> => {
    setBusy(true)
    setMessage('')
    try {
      await persist(draft)
      const result = await window.imAgent.settings.testModel(role)
      setResults((prev) => ({ ...prev, [role]: result }))
    } catch (error) {
      setResults((prev) => ({ ...prev, [role]: { ok: false, message: cleanError(error) } }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Context.Provider
      value={{
        draft,
        patch: (next) => setDraft({ ...draft, ...next }),
        commit,
        secrets,
        setSecret: (key, value) => setSecrets({ ...secrets, [key]: value }),
        save,
        saveAndTest,
        busy,
        message,
        results
      }}
    >
      {props.children}
    </Context.Provider>
  )
}

export function SaveBar(): React.JSX.Element {
  const { save, busy, message } = useSettingsContext()
  return (
    <div className="savebar">
      <button className="primary" disabled={busy} onClick={() => void save()}>
        保存设置
      </button>
      {message && <span className={message.startsWith('保存失败') ? 'error' : 'ok'}>{message}</span>}
    </div>
  )
}
