// 引擎：监控目标窗口的新消息并回复，切换未读会话，按任务消息向指定联系人发送内容。
import { randomUUID } from 'node:crypto'
import type { Settings } from '../../shared/settings'
import type {
  EnginePhase,
  EngineStatus,
  Frame,
  NormBox,
  Observation,
  PendingReply,
  TargetWindow,
  TaskAction,
  TaskMessage,
  TaskReport,
  TaskStatus
} from '../../shared/types'
import { normBoxToScreenPoint, SAFE_RANGES } from '../capture/coords'
import { changedFractionInBox, hasFrameChanged } from '../capture/frameDiff'
import type { CapturedFrame } from '../capture/screenshot'
import { isAborted } from '../abort'
import type { InputController } from '../executor/inputController'
import { logger } from '../logger'
import type { ReplyBrain } from '../brain/replyBrain'
import type { ProfileExtractor } from '../profile/profileExtractor'
import type { ProfileStore } from '../profile/profileStore'
import type { VisionProvider } from '../vision/vlmVision'
import { MessageTracker, normalizeTitle } from './messageTracker'
import { pickSearchResult, titleMatches } from './titleMatch'

export interface WindowPort {
  getInfo(hwnd: string): Promise<TargetWindow | null>
  focus(hwnd: string): Promise<boolean>
}

export interface EngineDeps {
  settings: () => Settings
  capture: (target: TargetWindow, maxImageSide: number) => Promise<CapturedFrame>
  windows: WindowPort
  vision: VisionProvider
  brain: Pick<ReplyBrain, 'decide'>
  input: InputController
  profiles: Pick<ProfileStore, 'find'>
  extractor: Pick<ProfileExtractor, 'ingest'>
  reportTask: (report: TaskReport) => void
  onStatus: (status: EngineStatus) => void
  now?: () => number
  errorBackoffMs?: number
}

const MAX_QUEUED_TASKS = 100
const OBSERVATION_MAX_AGE_MS = 20000
const UNREAD_EMPTY_SWITCH_LIMIT = 3
const UNREAD_COOLDOWN_MS = 60000
const UNREAD_IGNORE_MS = 90000
const UNREAD_ROW_HALF_HEIGHT = 40
const MAX_PENDING_REPLIES = 20
const MAX_RESPOND_FAILURES = 3
const SESSION_LIST_CHANGE_RATIO = 0.01
const DEFAULT_SESSION_LIST: [number, number, number, number] = [0, 0, 350, 1000]

interface OutboxItem {
  text: string
  contact: string
  chatType: 'single' | 'group'
}

type RespondOutcome = 'none' | 'skipped' | 'pending' | 'sent'

interface CachedObservation {
  observation: Observation
  frame: Frame
  thumbnail: Uint8Array
  at: number
}

export class Engine {
  private phase: EnginePhase = 'STOPPED'
  private phaseSince = 0
  private target: TargetWindow | null = null
  private running = false
  private paused = false
  private lastError: string | null = null
  private pendings: PendingReply[] = []

  private stopController: AbortController | null = null
  private pauseController = new AbortController()

  private readonly queue: TaskMessage[] = []
  private readonly outbox: OutboxItem[] = []
  private readonly tracker = new MessageTracker()
  private lastThumbnail: Uint8Array | null = null
  private cached: CachedObservation | null = null
  private forceObserve = false
  private lastObservedAt = 0
  private treatNextAsNew = false
  private currentTitle = ''
  private emptySwitches = 0
  private justSwitched = false
  private respondFailures = 0
  private unreadCooldownUntil = 0
  private ignoredRows: { y: number; until: number }[] = []
  private lastClickedY: number | null = null

  constructor(private readonly deps: EngineDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  status(): EngineStatus {
    return {
      phase: this.phase,
      phaseSince: this.phaseSince,
      running: this.running,
      paused: this.paused,
      target: this.target,
      pendingReply: this.pendings[0] ?? null,
      pendingCount: this.pendings.length,
      queuedTasks: this.queue.length,
      lastError: this.lastError
    }
  }

  private emit(): void {
    this.deps.onStatus(this.status())
  }

  private setPhase(phase: EnginePhase): void {
    if (this.phase === phase) return
    this.phase = phase
    this.phaseSince = this.now()
    this.emit()
  }

  private opSignal(): AbortSignal {
    const signals = [this.pauseController.signal]
    if (this.stopController) signals.push(this.stopController.signal)
    return AbortSignal.any(signals)
  }

  start(target: TargetWindow): EngineStatus {
    if (this.running) throw new Error('引擎已在运行')
    this.target = target
    this.running = true
    this.paused = false
    this.lastError = null
    this.pendings = []
    this.outbox.length = 0
    this.tracker.clear()
    this.lastThumbnail = null
    this.cached = null
    this.forceObserve = true
    this.lastObservedAt = 0
    this.treatNextAsNew = false
    this.currentTitle = ''
    this.emptySwitches = 0
    this.justSwitched = false
    this.unreadCooldownUntil = 0
    this.ignoredRows = []
    this.lastClickedY = null
    this.stopController = new AbortController()
    this.pauseController = new AbortController()
    this.setPhase('STARTING')
    logger.info(`引擎启动，目标窗口：${target.title}`)
    void this.loop(this.stopController.signal)
    return this.status()
  }

  stop(): EngineStatus {
    if (!this.running) return this.status()
    this.running = false
    this.paused = false
    this.pendings = []
    this.outbox.length = 0
    this.stopController?.abort()
    this.pauseController.abort()
    this.setPhase('STOPPED')
    logger.info('引擎已停止')
    return this.status()
  }

  pause(): EngineStatus {
    if (this.running && !this.paused) {
      this.paused = true
      this.pauseController.abort()
      logger.info('引擎已暂停')
      this.emit()
    }
    return this.status()
  }

  resume(): EngineStatus {
    if (this.running && this.paused) {
      this.paused = false
      this.pauseController = new AbortController()
      this.forceObserve = true
      logger.info('引擎已恢复')
      this.emit()
    }
    return this.status()
  }

  submitTask(task: TaskMessage): void {
    if (this.queue.length >= MAX_QUEUED_TASKS) {
      this.deps.reportTask({ taskId: task.id, status: 'failed', error: '任务队列已满', finishedAt: this.now() })
      return
    }
    this.queue.push(task)
    this.report(task, 'queued')
    logger.info(`收到任务：发送给「${task.target.name}」，共 ${task.actions.length} 项`)
    this.emit()
  }

  confirmReply(id: string, text: string): EngineStatus {
    const draft = this.pendings.find((p) => p.id === id)
    if (draft && text.trim()) {
      this.pendings = this.pendings.filter((p) => p.id !== id)
      this.outbox.push({ text: text.trim(), contact: draft.contact, chatType: draft.chatType })
      this.emit()
    }
    return this.status()
  }

  discardReply(id: string): EngineStatus {
    if (this.pendings.some((p) => p.id === id)) {
      this.pendings = this.pendings.filter((p) => p.id !== id)
      this.emit()
    }
    return this.status()
  }

  // 同一联系人只保留最新的草稿，队列满时丢弃最早的
  private addPending(contact: string, chatType: 'single' | 'group', text: string): void {
    this.pendings = this.pendings.filter((p) => normalizeTitle(p.contact) !== normalizeTitle(contact))
    this.pendings.push({ id: randomUUID(), contact, chatType, text, createdAt: this.now() })
    if (this.pendings.length > MAX_PENDING_REPLIES) this.pendings.shift()
    this.emit()
  }

  private report(task: TaskMessage, status: TaskStatus, error?: string): void {
    this.deps.reportTask({
      taskId: task.id,
      status,
      ...(error ? { error } : {}),
      finishedAt: this.now()
    })
  }

  private async wait(ms: number, signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve) => {
      if (signal.aborted) return resolve()
      const timer = setTimeout(resolve, ms)
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true }
      )
    })
  }

  private async loop(stopSignal: AbortSignal): Promise<void> {
    while (this.running && !stopSignal.aborted) {
      let delay = this.deps.settings().engine.pollIntervalMs
      try {
        if (this.paused) {
          await this.wait(300, stopSignal)
          continue
        }
        const item = this.outbox.shift()
        if (item !== undefined) {
          try {
            await this.sendText(item.text, item)
          } catch (error) {
            if (!isAborted(error)) this.addPending(item.contact, item.chatType, item.text)
            throw error
          }
          delay = this.deps.settings().engine.afterReplyPollMs
        } else {
          const task = this.queue.shift()
          if (task) {
            await this.runTask(task)
            delay = this.deps.settings().engine.afterReplyPollMs
          } else {
            delay = (await this.tick()) ?? delay
          }
        }
        this.lastError = null
      } catch (error) {
        if (isAborted(error)) {
          if (this.paused) continue
        } else {
          this.lastError = (error as Error).message
          logger.error(`引擎出错：${this.lastError}`)
          this.setPhase('POLLING')
          this.emit()
          delay = Math.max(delay, this.deps.errorBackoffMs ?? 3000)
        }
      }
      await this.wait(delay, stopSignal)
    }
  }

  // 一轮监控：截图，界面有变化才调用视觉模型；返回下一轮等待时长，undefined 表示用默认值
  private async tick(): Promise<number | undefined> {
    const settings = this.deps.settings()
    const target = this.target
    if (!target) throw new Error('未选择目标窗口')

    this.setPhase('CAPTURING')
    const info = await this.deps.windows.getInfo(target.hwnd)
    if (!info) throw new Error('目标窗口已关闭或最小化')
    this.target = info

    const { frame, thumbnail } = await this.deps.capture(info, settings.vision.maxImageSide)
    // 界面没有明显变化时，隔一段时间仍强制识别一次，防止变化检测漏掉小面积的新消息
    const refresh = settings.engine.idleRefreshMs
    const stale = refresh > 0 && this.now() - this.lastObservedAt >= refresh
    const changed = this.forceObserve || stale || hasFrameChanged(this.lastThumbnail, thumbnail, settings.engine.changeRatio)
    this.lastThumbnail = thumbnail
    if (!changed) {
      this.setPhase('POLLING')
      return undefined
    }
    this.forceObserve = false

    this.setPhase('RESPONDING')
    let observation: Observation
    try {
      observation = await this.deps.vision.observe(frame, { signal: this.opSignal() })
    } catch (error) {
      // 这一帧没有识别成功，下一轮必须重新识别，否则画面不变时会一直等到兜底刷新
      this.forceObserve = true
      throw error
    }
    this.cached = { observation, frame, thumbnail, at: this.now() }
    this.lastObservedAt = this.now()
    logger.info(
      `识别结果：会话「${observation.conversationTitle || '未识别'}」，消息 ${observation.messages.length} 条，未读红点 ${observation.unreadDots.length} 个，输入框${observation.inputArea ? '已识别' : '未识别'}`
    )
    return this.handleObservation(observation)
  }

  private async handleObservation(observation: Observation): Promise<number | undefined> {
    const settings = this.deps.settings()
    const title = observation.conversationTitle || this.currentTitle || '未命名会话'
    const chatType = observation.isGroup ? 'group' : 'single'
    this.currentTitle = title

    const before = this.tracker.snapshot(title)
    const firstSight = !this.tracker.has(title)
    const treatAllAsNew = this.treatNextAsNew && firstSight
    // 没有识别到任何消息的画面（如打开了不含聊天内容的页面）不更新追踪记录，避免清空该会话已见消息
    const hasMessages = observation.messages.length > 0
    const newMessages = hasMessages ? this.tracker.update(title, observation.messages, treatAllAsNew) : []
    if (hasMessages) this.treatNextAsNew = false
    const hasPeerNew = newMessages.some((m) => m.role === 'peer')
    if (this.justSwitched) {
      this.justSwitched = false
      this.recordSwitchOutcome(hasPeerNew)
    }

    const spoken = observation.messages.filter((m) => m.role !== 'system')
    const last = spoken[spoken.length - 1]
    let outcome: RespondOutcome = 'none'
    if (hasPeerNew && last?.role === 'peer') {
      try {
        outcome = await this.respond(title, observation)
        this.respondFailures = 0
      } catch (error) {
        // 回复没有处理成功，把这批消息退回成“未见过”，下一轮重新处理；连续失败多次才放弃
        this.respondFailures++
        if (isAborted(error) || this.respondFailures < MAX_RESPOND_FAILURES) {
          this.tracker.restore(title, before)
          this.treatNextAsNew = this.treatNextAsNew || treatAllAsNew
          this.forceObserve = true
        } else {
          this.respondFailures = 0
          logger.warn(`「${title}」的回复连续失败，放弃这批消息`)
        }
        throw error
      }
    }
    if (newMessages.length > 0) this.deps.extractor.ingest(title, chatType, newMessages)

    // 当前会话处理完（回复、跳过或生成草稿）后继续看其他会话的未读，否则一个持续有新消息的会话会占满引擎
    if (outcome === 'sent') return settings.engine.afterReplyPollMs
    if (this.pickUnreadDot(observation.unreadDots) && this.now() >= this.unreadCooldownUntil) {
      await this.switchToUnread(observation)
      return settings.engine.afterReplyPollMs
    }
    this.setPhase('POLLING')
    if (outcome !== 'none') return settings.engine.afterReplyPollMs
    return undefined
  }

  // 切换到未读会话后的第一次识别：没有新的对方消息就算一次空切换，连续多次则暂停切换一段时间
  private recordSwitchOutcome(hasPeerNew: boolean): void {
    if (hasPeerNew) {
      this.emptySwitches = 0
      return
    }
    // 点击的那一行没有带来新消息（如置顶会话的红点一直不消失），短时间内不再点这个位置
    if (this.lastClickedY !== null) {
      this.ignoredRows.push({ y: this.lastClickedY, until: this.now() + UNREAD_IGNORE_MS })
    }
    this.emptySwitches++
    if (this.emptySwitches >= UNREAD_EMPTY_SWITCH_LIMIT) {
      this.unreadCooldownUntil = this.now() + UNREAD_COOLDOWN_MS
      this.emptySwitches = 0
      logger.warn('连续多次切换未读会话后没有新消息，暂停切换 60 秒')
    }
  }

  private async respond(title: string, observation: Observation): Promise<RespondOutcome> {
    const settings = this.deps.settings()
    const chatType = observation.isGroup ? 'group' : 'single'
    const decision = await this.deps.brain.decide(
      {
        contact: title,
        isGroup: observation.isGroup,
        messages: observation.messages,
        profile: this.deps.profiles.find(title, chatType)
      },
      this.opSignal()
    )
    if (decision.action === 'skip') {
      logger.info(`跳过回复「${title}」：${decision.reason || '无需回复'}`)
      return 'skipped'
    }
    if (settings.engine.replyMode === 'confirm') {
      this.addPending(title, chatType, decision.text)
      logger.info(`已生成待确认回复「${title}」（${decision.text.length} 字）`)
      return 'pending'
    }
    logger.info(`自动回复「${title}」（${decision.text.length} 字）`)
    await this.sendText(decision.text)
    return 'sent'
  }

  // 取第一个不在“已忽略行”内的红点；红点的纵向位置用 0 到 1000 的归一化坐标比较
  private pickUnreadDot(dots: NormBox[]): NormBox | null {
    const now = this.now()
    this.ignoredRows = this.ignoredRows.filter((row) => row.until > now)
    return (
      dots.find((dot) => {
        const y = (dot[1] + dot[3]) / 2
        return !this.ignoredRows.some((row) => Math.abs(row.y - y) <= UNREAD_ROW_HALF_HEIGHT)
      }) ?? null
    )
  }

  private async switchToUnread(observation: Observation): Promise<void> {
    const settings = this.deps.settings()
    const target = this.target
    const cached = this.cached
    if (!target || !cached) return
    this.setPhase('SWITCHING_UNREAD')
    const signal = this.opSignal()
    await this.deps.windows.focus(target.hwnd)
    await this.deps.input.pause(150, 300, signal)

    this.lastClickedY = null
    if (settings.engine.unreadSwitch === 'hotkey') {
      await this.deps.input.hotkey('g', ['control'], signal)
    } else {
      const point = await this.locateUnreadDot(observation, cached, signal)
      if (!point) {
        this.forceObserve = true
        this.setPhase('POLLING')
        return
      }
      await this.deps.input.clickAt(point, signal)
    }
    await this.deps.input.pause(800, 1100, signal)
    logger.info(`切换到未读会话（当前会话「${this.currentTitle}」，红点 ${observation.unreadDots.length} 个）`)

    this.justSwitched = true
    this.forceObserve = true
    this.treatNextAsNew = true
    this.cached = null
  }

  // 点击前核对会话列表：识别之后列表可能已经变化（新消息会让会话跳到顶部），位置变了就重新识别再取坐标
  private async locateUnreadDot(
    observation: Observation,
    cached: CachedObservation,
    signal: AbortSignal
  ): Promise<{ x: number; y: number } | null> {
    const target = this.target
    if (!target) return null
    const info = await this.deps.windows.getInfo(target.hwnd)
    if (!info) throw new Error('目标窗口已关闭或最小化')
    this.target = info
    const fresh = await this.deps.capture(info, this.deps.settings().vision.maxImageSide)

    const listBox = observation.sessionList ?? DEFAULT_SESSION_LIST
    const moved = changedFractionInBox(cached.thumbnail, fresh.thumbnail, listBox) > SESSION_LIST_CHANGE_RATIO
    if (!moved) {
      const dot = this.pickUnreadDot(observation.unreadDots)
      if (!dot) return null
      this.lastClickedY = (dot[1] + dot[3]) / 2
      return normBoxToScreenPoint(dot, fresh.frame.screenRect, SAFE_RANGES.sessionItem)
    }

    logger.info('会话列表在识别之后发生了变化，重新识别后再点击')
    const again = await this.deps.vision.observe(fresh.frame, { signal })
    this.cached = { observation: again, frame: fresh.frame, thumbnail: fresh.thumbnail, at: this.now() }
    const dot = this.pickUnreadDot(again.unreadDots)
    if (!dot) {
      logger.info('重新识别后没有可点击的未读红点，放弃这次切换')
      return null
    }
    this.lastClickedY = (dot[1] + dot[3]) / 2
    return normBoxToScreenPoint(dot, fresh.frame.screenRect, SAFE_RANGES.sessionItem)
  }

  // 取一份足够新的识别结果；窗口尺寸变化或结果过旧时重新截图识别
  private async freshObservation(signal: AbortSignal, expectSearchResults = false): Promise<CachedObservation> {
    const target = this.target
    if (!target) throw new Error('未选择目标窗口')
    const info = await this.deps.windows.getInfo(target.hwnd)
    if (!info) throw new Error('目标窗口已关闭或最小化')
    this.target = info

    const cached = this.cached
    const sameSize =
      cached !== null &&
      Math.abs(cached.frame.screenRect.width - info.rect.width) <= 2 &&
      Math.abs(cached.frame.screenRect.height - info.rect.height) <= 2 &&
      Math.abs(cached.frame.screenRect.x - info.rect.x) <= 2 &&
      Math.abs(cached.frame.screenRect.y - info.rect.y) <= 2
    if (cached && sameSize && !expectSearchResults && this.now() - cached.at < OBSERVATION_MAX_AGE_MS) {
      return cached
    }
    const { frame, thumbnail } = await this.deps.capture(info, this.deps.settings().vision.maxImageSide)
    const observation = await this.deps.vision.observe(frame, { signal, expectSearchResults })
    this.cached = { observation, frame, thumbnail, at: this.now() }
    return this.cached
  }

  private async focusTarget(signal: AbortSignal): Promise<void> {
    if (!this.target) throw new Error('未选择目标窗口')
    await this.deps.windows.focus(this.target.hwnd)
    await this.deps.input.pause(200, 350, signal)
  }

  // contact 不为空时先确认当前打开的就是该会话，不是就通过搜索切过去，避免草稿发到别的会话
  private async sendText(text: string, contact?: { contact: string }): Promise<void> {
    this.setPhase('EXECUTING')
    const signal = this.opSignal()
    await this.focusTarget(signal)
    if (contact) await this.openConversation(contact.contact, signal)
    await this.typeIntoInput(signal, async () => this.deps.input.paste(text, signal))
    this.afterSend()
  }

  private async typeIntoInput(signal: AbortSignal, fill: () => Promise<void>): Promise<void> {
    const { observation, frame } = await this.freshObservation(signal)
    if (!observation.inputArea) throw new Error('未识别到消息输入框')
    const point = normBoxToScreenPoint(observation.inputArea, frame.screenRect, SAFE_RANGES.messageInput)
    await this.deps.input.clickAt(point, signal)
    await fill()
    await this.deps.input.pause(250, 400, signal)
    await this.deps.input.sendKeys(this.deps.settings().input.sendKeys, signal)
    await this.deps.input.pause(500, 800, signal)
  }

  private afterSend(): void {
    this.forceObserve = true
    this.cached = null
    this.setPhase('POLLING')
  }

  private async runTask(task: TaskMessage): Promise<void> {
    this.setPhase('EXECUTING')
    this.report(task, 'running')
    const signal = this.opSignal()
    try {
      await this.focusTarget(signal)
      await this.openConversation(task.target.name, signal)
      for (const action of task.actions) {
        await this.performAction(action, signal)
        await this.deps.input.pause(600, 1200, signal)
      }
      this.report(task, 'succeeded')
      logger.info(`任务完成：「${task.target.name}」`)
    } catch (error) {
      if (isAborted(error)) {
        this.report(task, 'cancelled', '被暂停或停止中断')
        logger.warn(`任务被中断：「${task.target.name}」`)
      } else {
        const message = (error as Error).message
        this.report(task, 'failed', message)
        logger.error(`任务失败：「${task.target.name}」${message}`)
      }
    } finally {
      this.tracker.reset(task.target.name)
      this.afterSend()
    }
  }

  private async openConversation(name: string, signal: AbortSignal): Promise<void> {
    const current = await this.freshObservation(signal)
    if (titleMatches(current.observation.conversationTitle, name)) return

    const searchBar = current.observation.searchBar
    if (!searchBar) throw new Error('未识别到搜索框')
    await this.deps.input.clickAt(normBoxToScreenPoint(searchBar, current.frame.screenRect, SAFE_RANGES.searchInput), signal)
    await this.deps.input.clearInput(signal)
    await this.deps.input.paste(name, signal)
    await this.deps.input.pause(900, 1300, signal)

    const searched = await this.freshObservation(signal, true)
    const match = pickSearchResult(searched.observation.searchResults, name)
    if (!match) throw new Error(`搜索结果中没有找到「${name}」`)
    await this.deps.input.clickAt(normBoxToScreenPoint(match.box, searched.frame.screenRect, SAFE_RANGES.searchResult), signal)
    await this.deps.input.pause(900, 1300, signal)

    this.cached = null
    const opened = await this.freshObservation(signal)
    if (!titleMatches(opened.observation.conversationTitle, name)) {
      throw new Error(`打开会话后校验失败，当前会话为「${opened.observation.conversationTitle || '未知'}」`)
    }
  }

  private async performAction(action: TaskAction, signal: AbortSignal): Promise<void> {
    if (action.type === 'text') {
      await this.typeIntoInput(signal, () => this.deps.input.paste(action.text, signal))
    } else {
      await this.typeIntoInput(signal, () => this.deps.input.pasteImage(action.path, signal))
    }
  }
}
