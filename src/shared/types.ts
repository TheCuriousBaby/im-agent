// 跨进程共享的数据类型：几何、识别结果、任务、画像、引擎状态与用量。

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

// 归一化框 [left, top, right, bottom]，取值 0~1000，相对于截图左上角
export type NormBox = [number, number, number, number]

export type MessageRole = 'self' | 'peer' | 'system'

export interface ObservedMessage {
  role: MessageRole
  text: string
  box: NormBox | null
}

export interface SearchResultItem {
  title: string
  box: NormBox
}

// 视觉模型对一帧截图的识别结果
export interface Observation {
  conversationTitle: string
  isGroup: boolean
  searchBar: NormBox | null
  inputArea: NormBox | null
  chatArea: NormBox | null
  sessionList: NormBox | null
  unreadDots: NormBox[]
  searchResults: SearchResultItem[]
  messages: ObservedMessage[]
}

// 一帧窗口截图；screenRect 是截图在屏幕上的物理像素矩形，图像可能为上传而缩小，识别结果用归一化坐标
export interface Frame {
  imageBase64: string
  mime: 'image/jpeg' | 'image/png'
  width: number
  height: number
  screenRect: Rect
  takenAt: number
}

export interface TargetWindow {
  hwnd: string
  title: string
  processName: string
  rect: Rect
}

export type TaskAction = { type: 'text'; text: string } | { type: 'image'; path: string }

export interface TaskTarget {
  name: string
  chatType: 'single' | 'group'
}

// 任务源下发给引擎的统一任务消息
export interface TaskMessage {
  id: string
  source: string
  target: TaskTarget
  actions: TaskAction[]
  createdAt: number
}

export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface TaskReport {
  taskId: string
  status: TaskStatus
  error?: string
  finishedAt: number
}

// 本地定时任务：cron 与 runAt 二选一
export interface ScheduledTask {
  id: string
  name: string
  enabled: boolean
  cron: string | null
  runAt: number | null
  target: TaskTarget
  actions: TaskAction[]
  lastRunAt: number | null
  lastStatus: TaskStatus | null
  nextRunAt: number | null
}

export interface ContactProfile {
  id: string
  name: string
  chatType: 'single' | 'group'
  tags: string[]
  facts: string[]
  preferences: string[]
  summary: string
  firstSeen: number
  lastSeen: number
  messageCount: number
}

export type EnginePhase =
  | 'STOPPED'
  | 'STARTING'
  | 'CAPTURING'
  | 'RESPONDING'
  | 'EXECUTING'
  | 'POLLING'
  | 'SWITCHING_UNREAD'

export interface PendingReply {
  id: string
  contact: string
  chatType: 'single' | 'group'
  text: string
  createdAt: number
}

export interface EngineStatus {
  phase: EnginePhase
  phaseSince: number
  running: boolean
  paused: boolean
  target: TargetWindow | null
  pendingReply: PendingReply | null
  pendingCount: number
  queuedTasks: number
  lastError: string | null
}

export interface EngineEvent {
  ts: number
  level: 'info' | 'warn' | 'error'
  message: string
}

export type ModelRole = 'vision' | 'reply' | 'profile'

export interface UsageBucket {
  calls: number
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export interface UsageSummary {
  total: UsageBucket
  byRole: Record<ModelRole, UsageBucket>
}

export interface TestResult {
  ok: boolean
  message: string
  latencyMs?: number
}

// 选窗口浮层里的一个候选窗口；rect 已换算为相对浮层窗口左上角的 DIP 坐标，列表按从上到下的层叠顺序排列
export interface PickerWindow {
  hwnd: string
  title: string
  processName: string
  rect: Rect
}

export type SettingsSection =
  | 'log'
  | 'usage'
  | 'agents'
  | 'tasks'
  | 'profiles'
  | 'models'
  | 'engine'
  | 'api'
  | 'remote'
  | 'about'

export type WindowControlAction = 'minimize' | 'maximize' | 'close'
