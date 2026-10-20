// 窗口管理：创建主悬浮面板、设置窗口与选窗口浮层，并向所有窗口广播事件、处理窗口控制。
import { app, BrowserWindow, globalShortcut, screen } from 'electron'
import { join } from 'node:path'
import { EVENTS } from '../../shared/ipc'
import type { PickerWindow, SettingsSection, WindowControlAction } from '../../shared/types'
import { listWindows } from '../capture/windowProbe'
import { logger } from '../logger'

const MAIN_SIZE = { width: 420, height: 720 }
const SETTINGS_SIZE = { width: 1180, height: 780 }
const PICKER_TIMEOUT_MS = 60000

export type WindowRole = 'main' | 'settings' | 'picker'

export class WindowManager {
  private main: BrowserWindow | null = null
  private settings: BrowserWindow | null = null
  private readonly pickers = new Set<BrowserWindow>()
  private pickerOpening = false
  private pickerTimer: NodeJS.Timeout | null = null
  private pickerWindows: PickerWindow[] = []

  constructor(private readonly rendererEntry: string) {}

  private load(win: BrowserWindow, route: string): void {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) void win.loadURL(`${devUrl}#/${route}`)
    else void win.loadFile(this.rendererEntry, { hash: `/${route}` })
  }

  private baseOptions(): Electron.BrowserWindowConstructorOptions {
    return {
      show: false,
      frame: false,
      backgroundColor: '#f1f6fa',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    }
  }

  private harden(win: BrowserWindow): void {
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event) => {
      if (!event.url.startsWith(win.webContents.getURL().split('#')[0])) event.preventDefault()
    })
  }

  createMain(): BrowserWindow {
    const win = new BrowserWindow({
      ...this.baseOptions(),
      ...MAIN_SIZE,
      minWidth: MAIN_SIZE.width,
      maxWidth: MAIN_SIZE.width,
      minHeight: 560,
      title: 'IM Agent'
    })
    this.harden(win)
    win.once('ready-to-show', () => win.show())
    win.on('closed', () => {
      this.main = null
      this.settings?.close()
      this.closePicker()
      app.quit()
    })
    this.load(win, '')
    this.main = win
    return win
  }

  openSettings(section?: SettingsSection): void {
    if (this.settings && !this.settings.isDestroyed()) {
      if (this.settings.isMinimized()) this.settings.restore()
      this.settings.focus()
      if (section) this.settings.webContents.send(EVENTS.navigate, section)
      return
    }
    const win = new BrowserWindow({
      ...this.baseOptions(),
      ...SETTINGS_SIZE,
      minWidth: 900,
      minHeight: 600,
      title: 'IM Agent 设置',
      backgroundColor: '#ffffff'
    })
    this.harden(win)
    win.once('ready-to-show', () => win.show())
    win.on('closed', () => {
      this.settings = null
    })
    this.load(win, section ? `settings?section=${section}` : 'settings')
    this.settings = win
  }

  // 启动选窗口浮层：覆盖光标所在显示器，按层叠顺序给出候选窗口；已打开或正在打开时不重复创建
  async openPicker(): Promise<void> {
    const existing = [...this.pickers].find((w) => !w.isDestroyed())
    if (existing) {
      existing.focus()
      return
    }
    if (this.pickerOpening) return
    this.pickerOpening = true
    try {
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      const windows = await listWindows()
      this.pickerWindows = windows
        .map((w): PickerWindow | null => {
          const dip = screen.screenToDipRect(null, w.rect)
          const x = dip.x - display.bounds.x
          const y = dip.y - display.bounds.y
          if (x >= display.bounds.width || y >= display.bounds.height || x + dip.width <= 0 || y + dip.height <= 0) {
            return null
          }
          return {
            hwnd: w.hwnd,
            title: w.title,
            processName: w.processName,
            rect: { x, y, width: dip.width, height: dip.height }
          }
        })
        .filter((w): w is PickerWindow => w !== null)
      logger.info(`选窗口：当前显示器上有 ${this.pickerWindows.length} 个候选窗口`)

      const win = new BrowserWindow({
        ...this.baseOptions(),
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
        transparent: true,
        backgroundColor: '#00000000',
        resizable: false,
        movable: false,
        skipTaskbar: true,
        hasShadow: false,
        alwaysOnTop: true,
        fullscreenable: false
      })
      win.setAlwaysOnTop(true, 'screen-saver')
      this.harden(win)
      win.once('ready-to-show', () => {
        win.show()
        win.focus()
      })
      win.on('closed', () => {
        this.pickers.delete(win)
        if (this.pickers.size === 0) this.releasePickerResources()
      })
      this.pickers.add(win)
      this.load(win, 'picker')

      // 浮层没有键盘焦点时 Esc 也要能退出，并避免浮层被遗忘而一直占着屏幕
      globalShortcut.register('Escape', () => this.closePicker())
      this.pickerTimer = setTimeout(() => this.closePicker(), PICKER_TIMEOUT_MS)
    } finally {
      this.pickerOpening = false
    }
  }

  private releasePickerResources(): void {
    this.pickerWindows = []
    globalShortcut.unregister('Escape')
    if (this.pickerTimer) clearTimeout(this.pickerTimer)
    this.pickerTimer = null
  }

  getPickerWindows(): PickerWindow[] {
    return this.pickerWindows
  }

  closePicker(): void {
    for (const win of [...this.pickers]) {
      if (!win.isDestroyed()) win.close()
    }
    this.releasePickerResources()
  }

  // 选窗口确认后让主面板回到前台
  focusMain(): void {
    if (this.main && !this.main.isDestroyed()) {
      if (this.main.isMinimized()) this.main.restore()
      this.main.show()
    }
  }

  all(): BrowserWindow[] {
    return [this.main, this.settings, ...this.pickers].filter((w): w is BrowserWindow => w !== null && !w.isDestroyed())
  }

  broadcast(channel: string, payload: unknown): void {
    for (const win of this.all()) win.webContents.send(channel, payload)
  }

  control(sender: Electron.WebContents, action: WindowControlAction): void {
    const win = BrowserWindow.fromWebContents(sender)
    if (!win) return
    if (action === 'minimize') win.minimize()
    else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize()
    else win.close()
  }

  isOwn(sender: Electron.WebContents): boolean {
    return this.all().some((w) => w.webContents === sender)
  }

  roleOf(sender: Electron.WebContents): WindowRole | null {
    if (this.main?.webContents === sender) return 'main'
    if (this.settings?.webContents === sender) return 'settings'
    if ([...this.pickers].some((w) => !w.isDestroyed() && w.webContents === sender)) return 'picker'
    return null
  }

}
