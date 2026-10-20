// 预加载脚本：只暴露类型化的白名单 API，渲染进程拿不到任意通道的调用能力。
import { contextBridge, ipcRenderer } from 'electron'
import { EVENTS, IPC, type EventName, type EventPayloads, type ImAgentApi } from '../shared/ipc'

const allowedEvents = new Set<string>(Object.values(EVENTS))

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>
}

const api: ImAgentApi = {
  settings: {
    get: () => invoke(IPC.settingsGet),
    save: (input) => invoke(IPC.settingsSave, input),
    patchEngine: (patch) => invoke(IPC.settingsPatchEngine, patch),
    testModel: (role) => invoke(IPC.modelTest, role)
  },
  engine: {
    start: () => invoke(IPC.engineStart),
    pause: () => invoke(IPC.enginePause),
    resume: () => invoke(IPC.engineResume),
    stop: () => invoke(IPC.engineStop),
    status: () => invoke(IPC.engineStatus),
    confirmReply: (id, text) => invoke(IPC.engineConfirmReply, id, text),
    discardReply: (id) => invoke(IPC.engineDiscardReply, id)
  },
  target: {
    get: () => invoke(IPC.targetGet),
    pick: () => invoke(IPC.targetPick),
    clear: () => invoke(IPC.targetClear)
  },
  picker: {
    windows: () => invoke(IPC.pickerWindows),
    select: (hwnd) => invoke(IPC.pickerSelect, hwnd),
    cancel: () => invoke(IPC.pickerCancel)
  },
  app: {
    openSettings: (section) => invoke(IPC.appOpenSettings, section),
    windowControl: (action) => invoke(IPC.appWindowControl, action)
  },
  usage: {
    get: () => invoke(IPC.usageGet),
    reset: () => invoke(IPC.usageReset)
  },
  profiles: {
    list: () => invoke(IPC.profilesList),
    save: (profile) => invoke(IPC.profilesSave, profile),
    delete: (id) => invoke(IPC.profilesDelete, id),
    exportAll: () => invoke(IPC.profilesExport),
    importAll: (json) => invoke(IPC.profilesImport, json)
  },
  tasks: {
    list: () => invoke(IPC.tasksList),
    save: (task) => invoke(IPC.tasksSave, task),
    delete: (id) => invoke(IPC.tasksDelete, id)
  },
  logs: {
    recent: () => invoke(IPC.logsRecent)
  },
  openExternal: (url) => invoke(IPC.openExternal, url),
  on<E extends EventName>(event: E, listener: (payload: EventPayloads[E]) => void): () => void {
    if (!allowedEvents.has(event)) throw new Error('不支持的事件')
    const wrapped = (_: unknown, payload: EventPayloads[E]): void => listener(payload)
    ipcRenderer.on(event, wrapped)
    return () => {
      ipcRenderer.removeListener(event, wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('imAgent', api)
