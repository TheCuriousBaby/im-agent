// IPC 注册：只响应白名单通道，并校验调用方是本应用自己的窗口，且该窗口有权调用这个通道。
import { ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { IPC } from '../../shared/ipc'
import type { SettingsInput } from '../../shared/settings'
import type {
  ContactProfile,
  ModelRole,
  ScheduledTask,
  SettingsSection,
  TestResult,
  WindowControlAction
} from '../../shared/types'
import type { ModelClient } from '../ai/modelClient'
import type { UsageMeter } from '../ai/usageMeter'
import { getWindowInfo } from '../capture/windowProbe'
import type { Engine } from '../engine/engine'
import { logger, recentLogs } from '../logger'
import type { ProfileStore } from '../profile/profileStore'
import type { LocalScheduler } from '../scheduler/localScheduler'
import type { SettingsStore } from '../settings/settingsStore'
import type { TargetSelection } from '../windows/targetSelection'
import type { WindowManager, WindowRole } from '../windows/windowManager'

export interface IpcServices {
  windows: WindowManager
  rendererEntry: string
  settings: SettingsStore
  usage: UsageMeter
  models: ModelClient
  engine: Engine
  profiles: ProfileStore
  scheduler: LocalScheduler
  target: TargetSelection
}

const PANEL_ROLES: WindowRole[] = ['main', 'settings']
const ALL_ROLES: WindowRole[] = ['main', 'settings', 'picker']

const SECTIONS: SettingsSection[] = [
  'log',
  'usage',
  'agents',
  'tasks',
  'profiles',
  'models',
  'engine',
  'api',
  'remote',
  'about'
]

const QuickPatchSchema = z.object({
  replyMode: z.enum(['auto', 'confirm']).optional(),
  pollIntervalMs: z.number().int().min(1000).max(60000).optional(),
  afterReplyPollMs: z.number().int().min(500).max(60000).optional()
})

function isTrustedUrl(url: string, rendererEntry: string): boolean {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) return url.startsWith(devUrl)
  return url.startsWith(pathToFileURL(rendererEntry).href)
}

function handle<A extends unknown[], R>(
  channel: string,
  services: IpcServices,
  roles: WindowRole[],
  fn: (event: IpcMainInvokeEvent, ...args: A) => R | Promise<R>
): void {
  ipcMain.handle(channel, (event, ...args) => {
    const role = services.windows.roleOf(event.sender)
    const url = event.senderFrame?.url ?? ''
    if (!role || !roles.includes(role) || !isTrustedUrl(url, services.rendererEntry)) {
      throw new Error('拒绝来自未知页面的调用')
    }
    return fn(event, ...(args as A))
  })
}

async function testModel(services: IpcServices, role: ModelRole): Promise<TestResult> {
  const startedAt = Date.now()
  try {
    const result = await services.models.ask({
      role,
      system: '你是连通性测试助手。',
      user: '请只回复 OK 两个字母。',
      maxOutputTokens: 200
    })
    const note = role === 'vision' ? '（只测试了文本连通，未测试识图）' : ''
    return {
      ok: true,
      message: `调用成功${note}，返回：${result.text.trim().slice(0, 40) || '空'}`,
      latencyMs: Date.now() - startedAt
    }
  } catch (error) {
    return { ok: false, message: (error as Error).message.slice(0, 300), latencyMs: Date.now() - startedAt }
  }
}

export function registerIpc(services: IpcServices): void {
  const { windows, settings, usage, engine, profiles, scheduler, target } = services

  handle(IPC.settingsGet, services, PANEL_ROLES, () => settings.getPublic())
  handle(IPC.settingsSave, services, PANEL_ROLES, (_e, input: SettingsInput) => settings.save(input))
  handle(IPC.settingsPatchEngine, services, PANEL_ROLES, (_e, patch: unknown) =>
    settings.patchEngine(QuickPatchSchema.parse(patch))
  )
  handle(IPC.modelTest, services, PANEL_ROLES, (_e, role: ModelRole) => testModel(services, role))

  handle(IPC.engineStart, services, PANEL_ROLES, async () => {
    const selected = target.get()
    if (!selected) throw new Error('请先选择目标窗口')
    const verified = await getWindowInfo(selected.hwnd)
    if (!verified) throw new Error('目标窗口不存在或已最小化，请重新选择')
    target.set(verified)
    return engine.start(verified)
  })
  handle(IPC.enginePause, services, PANEL_ROLES, () => engine.pause())
  handle(IPC.engineResume, services, PANEL_ROLES, () => engine.resume())
  handle(IPC.engineStop, services, PANEL_ROLES, () => engine.stop())
  handle(IPC.engineStatus, services, PANEL_ROLES, () => engine.status())
  handle(IPC.engineConfirmReply, services, PANEL_ROLES, (_e, id: string, text: string) =>
    engine.confirmReply(String(id), String(text))
  )
  handle(IPC.engineDiscardReply, services, PANEL_ROLES, (_e, id: string) => engine.discardReply(String(id)))

  handle(IPC.targetGet, services, PANEL_ROLES, () => target.get())
  handle(IPC.targetPick, services, PANEL_ROLES, async () => {
    if (engine.status().running) throw new Error('引擎运行中，请先停止再更换目标窗口')
    await windows.openPicker()
  })
  handle(IPC.targetClear, services, PANEL_ROLES, () => {
    if (engine.status().running) throw new Error('引擎运行中，请先停止再更换目标窗口')
    target.set(null)
  })

  handle(IPC.pickerWindows, services, ['picker'], () => windows.getPickerWindows())
  handle(IPC.pickerSelect, services, ['picker'], async (_e, hwnd: string) => {
    const candidate = windows.getPickerWindows().find((w) => w.hwnd === String(hwnd))
    if (!candidate) {
      windows.closePicker()
      throw new Error('所选窗口不在候选列表中')
    }
    const info = await getWindowInfo(candidate.hwnd)
    windows.closePicker()
    if (!info) throw new Error('所选窗口已关闭或最小化')
    target.set(info)
    logger.info(`已选择目标窗口：${info.title}（${info.processName}，${info.rect.width}×${info.rect.height}）`)
    windows.focusMain()
  })
  handle(IPC.pickerCancel, services, ['picker'], () => {
    windows.closePicker()
    windows.focusMain()
  })

  handle(IPC.appOpenSettings, services, PANEL_ROLES, (_e, section?: SettingsSection) => {
    windows.openSettings(section && SECTIONS.includes(section) ? section : undefined)
  })
  handle(IPC.appWindowControl, services, PANEL_ROLES, (event, action: WindowControlAction) => {
    if (action !== 'minimize' && action !== 'maximize' && action !== 'close') throw new Error('不支持的窗口操作')
    windows.control(event.sender, action)
  })

  handle(IPC.usageGet, services, PANEL_ROLES, () => usage.summary())
  handle(IPC.usageReset, services, PANEL_ROLES, () => usage.reset())
  handle(IPC.logsRecent, services, PANEL_ROLES, () => recentLogs())

  handle(IPC.profilesList, services, PANEL_ROLES, () => profiles.list())
  handle(IPC.profilesSave, services, PANEL_ROLES, (_e, profile: ContactProfile) => profiles.upsert(profile))
  handle(IPC.profilesDelete, services, PANEL_ROLES, (_e, id: string) => profiles.delete(String(id)))
  handle(IPC.profilesExport, services, PANEL_ROLES, () => profiles.exportAll())
  handle(IPC.profilesImport, services, PANEL_ROLES, (_e, json: string) => profiles.importAll(String(json)))

  handle(IPC.tasksList, services, PANEL_ROLES, () => scheduler.list())
  handle(IPC.tasksSave, services, PANEL_ROLES, (_e, task: ScheduledTask) => scheduler.save(task))
  handle(IPC.tasksDelete, services, PANEL_ROLES, (_e, id: string) => scheduler.delete(String(id)))

  handle(IPC.openExternal, services, ALL_ROLES, async (_e, url: string) => {
    const parsed = new URL(String(url))
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
    await shell.openExternal(parsed.href)
    return true
  })
}
