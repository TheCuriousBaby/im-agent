// 界面展示用的格式化函数。
import type { EnginePhase } from '../../shared/types'

const PHASE_LABELS: Record<EnginePhase, string> = {
  STOPPED: '已停止',
  STARTING: '启动中',
  CAPTURING: '截图中',
  RESPONDING: '识别与决策中',
  EXECUTING: '执行中',
  POLLING: '等待新消息',
  SWITCHING_UNREAD: '切换未读会话'
}

export function phaseLabel(phase: EnginePhase): string {
  return PHASE_LABELS[phase]
}

export function formatTime(ts: number | null): string {
  if (ts === null) return '无'
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

export function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
}

export function formatCost(usd: number): string {
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`
}

// 把时间戳转成 datetime-local 控件需要的本地时间字符串
export function toLocalInput(ts: number | null): string {
  if (ts === null) return ''
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromLocalInput(value: string): number | null {
  if (!value) return null
  const ts = new Date(value).getTime()
  return Number.isFinite(ts) ? ts : null
}
