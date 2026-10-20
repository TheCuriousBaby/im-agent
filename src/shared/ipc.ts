// 渲染进程与主进程之间的 IPC 通道白名单与类型化 API。
import type {
  ContactProfile,
  EngineEvent,
  EngineStatus,
  ModelRole,
  PickerWindow,
  ScheduledTask,
  SettingsSection,
  TargetWindow,
  TestResult,
  UsageSummary,
  WindowControlAction
} from './types'
import type { PublicSettings, QuickEnginePatch, SettingsInput } from './settings'

export const IPC = {
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  settingsPatchEngine: 'settings:patch-engine',
  modelTest: 'model:test',
  engineStart: 'engine:start',
  enginePause: 'engine:pause',
  engineResume: 'engine:resume',
  engineStop: 'engine:stop',
  engineStatus: 'engine:status',
  engineConfirmReply: 'engine:confirm-reply',
  engineDiscardReply: 'engine:discard-reply',
  targetGet: 'target:get',
  targetPick: 'target:pick',
  targetClear: 'target:clear',
  pickerWindows: 'picker:windows',
  pickerSelect: 'picker:select',
  pickerCancel: 'picker:cancel',
  appOpenSettings: 'app:open-settings',
  appWindowControl: 'app:window-control',
  usageGet: 'usage:get',
  usageReset: 'usage:reset',
  profilesList: 'profiles:list',
  profilesSave: 'profiles:save',
  profilesDelete: 'profiles:delete',
  profilesExport: 'profiles:export',
  profilesImport: 'profiles:import',
  tasksList: 'tasks:list',
  tasksSave: 'tasks:save',
  tasksDelete: 'tasks:delete',
  logsRecent: 'logs:recent',
  openExternal: 'shell:open-external'
} as const

export const EVENTS = {
  engineStatus: 'event:engine-status',
  engineEvent: 'event:engine-event',
  usage: 'event:usage',
  target: 'event:target',
  settings: 'event:settings',
  navigate: 'event:navigate'
} as const

export type EventName = (typeof EVENTS)[keyof typeof EVENTS]

export interface EventPayloads {
  [EVENTS.engineStatus]: EngineStatus
  [EVENTS.engineEvent]: EngineEvent
  [EVENTS.usage]: UsageSummary
  [EVENTS.target]: TargetWindow | null
  [EVENTS.settings]: PublicSettings
  [EVENTS.navigate]: SettingsSection
}

export interface ImAgentApi {
  settings: {
    get(): Promise<PublicSettings>
    save(input: SettingsInput): Promise<PublicSettings>
    patchEngine(patch: QuickEnginePatch): Promise<PublicSettings>
    testModel(role: ModelRole): Promise<TestResult>
  }
  engine: {
    start(): Promise<EngineStatus>
    pause(): Promise<EngineStatus>
    resume(): Promise<EngineStatus>
    stop(): Promise<EngineStatus>
    status(): Promise<EngineStatus>
    confirmReply(id: string, text: string): Promise<EngineStatus>
    discardReply(id: string): Promise<EngineStatus>
  }
  target: {
    get(): Promise<TargetWindow | null>
    pick(): Promise<void>
    clear(): Promise<void>
  }
  picker: {
    windows(): Promise<PickerWindow[]>
    select(hwnd: string): Promise<void>
    cancel(): Promise<void>
  }
  app: {
    openSettings(section?: SettingsSection): Promise<void>
    windowControl(action: WindowControlAction): Promise<void>
  }
  usage: {
    get(): Promise<UsageSummary>
    reset(): Promise<UsageSummary>
  }
  profiles: {
    list(): Promise<ContactProfile[]>
    save(profile: ContactProfile): Promise<ContactProfile>
    delete(id: string): Promise<void>
    exportAll(): Promise<string>
    importAll(json: string): Promise<number>
  }
  tasks: {
    list(): Promise<ScheduledTask[]>
    save(task: ScheduledTask): Promise<ScheduledTask>
    delete(id: string): Promise<void>
  }
  logs: {
    recent(): Promise<EngineEvent[]>
  }
  openExternal(url: string): Promise<boolean>
  on<E extends EventName>(event: E, listener: (payload: EventPayloads[E]) => void): () => void
}
