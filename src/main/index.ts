// 主进程入口：装配设置、模型、引擎、调度、窗口与本机 API，并把状态事件广播给所有窗口。
import { app, clipboard, globalShortcut, nativeImage, session } from 'electron'
import { join } from 'node:path'
import { EVENTS } from '../shared/ipc'
import { toPublicSettings } from '../shared/settings'
import type { TaskMessage, TaskReport } from '../shared/types'
import { ModelClient } from './ai/modelClient'
import { UsageMeter } from './ai/usageMeter'
import { LocalApi } from './api/localApi'
import { ReplyBrain } from './brain/replyBrain'
import { captureWindowFrame } from './capture/screenshot'
import { focusWindow, getWindowInfo } from './capture/windowProbe'
import { Engine } from './engine/engine'
import { RobotInputBackend } from './executor/inputBackend'
import { InputController } from './executor/inputController'
import { registerIpc } from './ipc/register'
import { logger, onLog } from './logger'
import { ProfileExtractor } from './profile/profileExtractor'
import { ProfileStore } from './profile/profileStore'
import { LocalScheduler } from './scheduler/localScheduler'
import { WsTaskSource } from './scheduler/remote/wsTaskSource'
import type { TaskSource } from './scheduler/taskSource'
import { SettingsStore } from './settings/settingsStore'
import { VlmVision } from './vision/vlmVision'
import { TargetSelection } from './windows/targetSelection'
import { WindowManager } from './windows/windowManager'

const PAUSE_ACCELERATOR = 'CommandOrControl+Alt+P'
const PICK_ACCELERATOR = 'CommandOrControl+Alt+S'

function installContentSecurityPolicy(): void {
  if (!app.isPackaged) return
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
        ]
      }
    })
  })
}

function bootstrap(): void {
  const rendererEntry = join(__dirname, '../renderer/index.html')
  const userData = app.getPath('userData')

  const settings = new SettingsStore()
  const usage = new UsageMeter()
  const models = new ModelClient((role) => settings.resolveModel(role), usage)
  const profiles = new ProfileStore(join(userData, 'profiles'))
  const extractor = new ProfileExtractor(models, profiles, () => settings.get())
  const brain = new ReplyBrain(models, () => settings.get())
  const vision = new VlmVision(models)

  const windows = new WindowManager(rendererEntry)
  const target = new TargetSelection()

  const backend = new RobotInputBackend()
  const input = new InputController(
    backend,
    {
      readText: () => clipboard.readText(),
      writeText: (text) => clipboard.writeText(text),
      writeImageFromPath: (path) => {
        const image = nativeImage.createFromPath(path)
        if (image.isEmpty()) throw new Error(`无法读取图片：${path}`)
        clipboard.writeImage(image)
      }
    },
    () => settings.get().input.humanize
  )

  const scheduler = new LocalScheduler(join(userData, 'tasks.json'))
  const remote = new WsTaskSource(() => ({ url: settings.get().remote.wsUrl, token: settings.get().remote.token }))
  const sources: TaskSource[] = [scheduler, remote]
  const taskSources = new Map<string, string>()

  const engine = new Engine({
    settings: () => settings.get(),
    capture: captureWindowFrame,
    windows: { getInfo: getWindowInfo, focus: focusWindow },
    vision,
    brain,
    input,
    profiles,
    extractor,
    reportTask: (report: TaskReport) => {
      const sourceId = taskSources.get(report.taskId)
      for (const source of sources) {
        if (source.id === sourceId) void source.report?.(report)
      }
      if (report.status === 'succeeded' || report.status === 'failed' || report.status === 'cancelled') {
        taskSources.delete(report.taskId)
      }
    },
    onStatus: (status) => windows.broadcast(EVENTS.engineStatus, status)
  })

  const submit = (task: TaskMessage): void => {
    taskSources.set(task.id, task.source)
    engine.submitTask(task)
  }
  const api = new LocalApi(engine, submit)

  const applyConfig = (): void => {
    const s = settings.get()
    api.apply(s.localApi)
    remote.stop()
    if (s.remote.enabled) remote.start({ submit })
  }

  scheduler.start({ submit })
  applyConfig()
  settings.onChange(() => {
    applyConfig()
    windows.broadcast(EVENTS.settings, toPublicSettings(settings.get()))
  })

  usage.onChange((summary) => windows.broadcast(EVENTS.usage, summary))
  onLog((event) => windows.broadcast(EVENTS.engineEvent, event))
  target.onChange((selected) => windows.broadcast(EVENTS.target, selected))

  windows.createMain()
  registerIpc({ windows, rendererEntry, settings, usage, models, engine, profiles, scheduler, target })

  globalShortcut.register(PAUSE_ACCELERATOR, () => {
    const status = engine.status()
    if (!status.running) return
    if (status.paused) engine.resume()
    else engine.pause()
  })
  globalShortcut.register(PICK_ACCELERATOR, () => {
    if (engine.status().running) return
    windows.openPicker().catch((error: Error) => logger.error(`打开选窗口浮层失败：${error.message}`))
  })

  app.on('before-quit', () => {
    engine.stop()
    scheduler.stop()
    remote.stop()
    api.stop()
    backend.dispose()
    globalShortcut.unregisterAll()
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.whenReady().then(() => {
    installContentSecurityPolicy()
    bootstrap()
    logger.info('应用已启动')
  })
  app.on('window-all-closed', () => app.quit())
}
