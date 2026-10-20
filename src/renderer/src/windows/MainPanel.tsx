// 主悬浮面板：状态胶囊、提示与待确认回复、运行动态，以及底部的启动、速度、方式与选窗口按钮。
import { useEffect, useState } from 'react'
import { SPEED_PRESETS, speedOf, type SpeedKey } from '../../../shared/settings'
import type { EngineStatus, TargetWindow } from '../../../shared/types'
import { Dropdown } from '../components/Dropdown'
import { formatClock } from '../format'
import { cleanError, useEngineEvents, useEngineStatus, usePublicSettings, useTarget } from '../hooks'
import {
  IconBolt,
  IconClipboard,
  IconClose,
  IconGear,
  IconInfinity,
  IconMonitor,
  IconPause,
  IconPlay,
  IconStop,
  Logo
} from '../icons'

type Tone = 'idle' | 'wait' | 'busy' | 'paused' | 'error'

function deriveStatus(status: EngineStatus | null, target: TargetWindow | null): { text: string; tone: Tone } {
  if (!status || !status.running) return { text: target ? '待启动' : '未选窗口', tone: 'idle' }
  if (status.paused) return { text: '已暂停', tone: 'paused' }
  if (status.lastError) return { text: '出错', tone: 'error' }
  switch (status.phase) {
    case 'POLLING':
      return { text: '等待中', tone: 'wait' }
    case 'SWITCHING_UNREAD':
      return { text: '切换会话', tone: 'busy' }
    case 'EXECUTING':
      return { text: '发送中', tone: 'busy' }
    case 'RESPONDING':
      return { text: '识别中', tone: 'busy' }
    default:
      return { text: '处理中', tone: 'busy' }
  }
}

const HINTS = {
  auto: '已开启自动模式，AI 将阅读对方消息并自动打字回复。自动模式期间请不要移动鼠标或操作键盘，避免打断 AI 操作。',
  confirm:
    '已开启确认模式，AI 将阅读对方消息并生成回复，确认后才会发送。运行期间请不要移动鼠标或操作键盘，避免打断 AI 操作。'
}

export function MainPanel(): React.JSX.Element {
  const status = useEngineStatus()
  const target = useTarget()
  const settings = usePublicSettings()
  const events = useEngineEvents(60)
  const [message, setMessage] = useState('')
  const [draft, setDraft] = useState('')
  const [draftFor, setDraftFor] = useState('')

  const pending = status?.pendingReply ?? null
  useEffect(() => {
    if (pending && pending.id !== draftFor) {
      setDraft(pending.text)
      setDraftFor(pending.id)
    }
  }, [pending, draftFor])

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setMessage('')
    try {
      await action()
    } catch (error) {
      setMessage(cleanError(error))
    }
  }

  const running = status?.running ?? false
  const paused = status?.paused ?? false
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running || paused) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running, paused])
  const baseView = deriveStatus(status, target)
  const waited = status && running && !paused && baseView.tone === 'busy' ? Math.round((now - status.phaseSince) / 1000) : 0
  const view = waited >= 5 ? { ...baseView, text: `${baseView.text} ${waited}s` } : baseView
  const replyMode = settings?.engine.replyMode ?? 'confirm'
  const speed = settings ? speedOf(settings.engine) : 'standard'
  const modelReady = Boolean(settings?.vision.apiKeySet && settings.vision.baseUrl && settings.vision.model)

  const start = (): Promise<void> =>
    run(async () => {
      if (!modelReady) {
        await window.imAgent.app.openSettings('models')
        throw new Error('请先在设置里配置识别模型')
      }
      await window.imAgent.engine.start()
    })

  return (
    <div className="panel">
      <header className="panel-top">
        <div className="status-pill">
          <Logo size={26} />
          <span className="status-text">{view.text}</span>
          <i className={`dot ${view.tone}`} />
        </div>
        <div className="top-actions">
          <button className="round" onClick={() => void window.imAgent.app.openSettings(modelReady ? 'agents' : 'models')}>
            <IconGear size={20} />
          </button>
          <button className="round" onClick={() => void window.imAgent.app.openSettings('log')}>
            <IconClipboard size={20} />
          </button>
          <button className="round" onClick={() => void window.imAgent.app.windowControl('close')}>
            <IconClose size={20} />
          </button>
        </div>
      </header>

      <section className="panel-body">
        <p className="hint">{HINTS[replyMode]}</p>

        {target && (
          <div className="target-line">
            <IconMonitor size={16} />
            <span className="target-name">{target.title}</span>
            {!running && (
              <button className="link" onClick={() => void run(() => window.imAgent.target.clear())}>
                移除
              </button>
            )}
          </div>
        )}
        {message && <p className="error">{message}</p>}
        {status?.lastError && running && <p className="error">{status.lastError}</p>}

        {pending && (
          <div className="pending">
            <div className="pending-title">
              待确认回复 · {pending.contact}
              {(status?.pendingCount ?? 0) > 1 && <span className="muted">　还有 {(status?.pendingCount ?? 1) - 1} 条</span>}
            </div>
            <textarea rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div className="pending-actions">
              <button
                className="primary small"
                disabled={!draft.trim()}
                onClick={() => void run(() => window.imAgent.engine.confirmReply(pending.id, draft))}
              >
                确认发送
              </button>
              <button className="small" onClick={() => void run(() => window.imAgent.engine.discardReply(pending.id))}>
                丢弃
              </button>
            </div>
          </div>
        )}

        <div className="feed">
          {[...events].reverse().map((e, i) => (
            <div key={`${e.ts}-${i}`} className={`feed-line ${e.level}`}>
              <span className="time">{formatClock(e.ts)}</span>
              <span>{e.message}</span>
            </div>
          ))}
        </div>
      </section>

      <footer className="panel-bottom">
        {!target && !running && (
          <div className="guide">
            <span>点击框选任意聊天软件界面</span>
            <kbd>Ctrl+Alt+S</kbd>
          </div>
        )}
        <div className="bar">
          {!running && (
            <button className="pill start" onClick={() => void start()}>
              <IconPlay size={18} />
              <span>启动</span>
            </button>
          )}
          {running && (
            <>
              <button
                className="pill start"
                onClick={() => void run(() => (paused ? window.imAgent.engine.resume() : window.imAgent.engine.pause()))}
              >
                {paused ? <IconPlay size={18} /> : <IconPause size={18} />}
                <span>{paused ? '恢复' : '暂停'}</span>
              </button>
              <button className="pill icon-only stop" onClick={() => void run(() => window.imAgent.engine.stop())}>
                <IconStop size={18} />
              </button>
            </>
          )}
          <Dropdown<SpeedKey>
            icon={<IconBolt size={14} />}
            tone="amber"
            value={speed}
            options={(Object.keys(SPEED_PRESETS) as SpeedKey[]).map((key) => ({
              value: key,
              label: SPEED_PRESETS[key].label,
              hint: `每 ${SPEED_PRESETS[key].pollIntervalMs / 1000} 秒检查`
            }))}
            onChange={(key) =>
              void run(() =>
                window.imAgent.settings.patchEngine({
                  pollIntervalMs: SPEED_PRESETS[key].pollIntervalMs,
                  afterReplyPollMs: SPEED_PRESETS[key].afterReplyPollMs
                })
              )
            }
          />
          <Dropdown<'auto' | 'confirm'>
            icon={<IconInfinity size={14} />}
            tone="blue"
            value={replyMode}
            options={[
              { value: 'auto', label: '自动', hint: '生成后直接发送' },
              { value: 'confirm', label: '确认', hint: '生成后由我确认' }
            ]}
            onChange={(mode) => void run(() => window.imAgent.settings.patchEngine({ replyMode: mode }))}
          />
          {!running && (
            <button className="pill icon-only monitor" onClick={() => void run(() => window.imAgent.target.pick())}>
              <IconMonitor size={22} />
            </button>
          )}
        </div>
      </footer>
    </div>
  )
}
