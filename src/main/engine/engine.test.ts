// engine 的集成测试：用假的截图、视觉、回复、键鼠与窗口驱动状态机，覆盖回复、确认、任务发送与失败。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SettingsSchema, type Settings } from '../../shared/settings'
import type {
  EngineStatus,
  NormBox,
  Observation,
  ObservedMessage,
  TargetWindow,
  TaskMessage,
  TaskReport
} from '../../shared/types'
import type { CapturedFrame } from '../capture/screenshot'
import type { InputBackend } from '../executor/inputBackend'
import { InputController } from '../executor/inputController'
import { THUMBNAIL_HEIGHT, THUMBNAIL_WIDTH } from '../capture/frameDiff'
import { Engine } from './engine'

const TARGET: TargetWindow = {
  hwnd: '1',
  title: '微信',
  processName: 'WeChat',
  rect: { x: 0, y: 0, width: 1000, height: 500 }
}

const box = (l: number, t: number, r: number, b: number): NormBox => [l, t, r, b]
const msg = (role: ObservedMessage['role'], text: string): ObservedMessage => ({ role, text, box: null })

function observation(title: string, messages: ObservedMessage[], extra: Partial<Observation> = {}): Observation {
  return {
    conversationTitle: title,
    isGroup: false,
    searchBar: box(50, 20, 300, 60),
    inputArea: box(400, 850, 950, 980),
    chatArea: box(300, 80, 990, 840),
    sessionList: box(0, 80, 290, 990),
    unreadDots: [],
    searchResults: [],
    messages,
    ...extra
  }
}

class FakeBackend implements InputBackend {
  calls: string[] = []
  async moveTo(point: { x: number; y: number }): Promise<void> {
    this.calls.push(`move:${point.x},${point.y}`)
  }
  async click(): Promise<void> {
    this.calls.push('click')
  }
  async keyTap(key: string, modifiers: string[] = []): Promise<void> {
    this.calls.push(`key:${[...modifiers, key].join('+')}`)
  }
  async typeString(): Promise<void> {}
  async scroll(): Promise<void> {}
  async mousePosition(): Promise<{ x: number; y: number }> {
    return { x: 0, y: 0 }
  }
  dispose(): void {}
}

interface Harness {
  engine: Engine
  backend: FakeBackend
  clipboardWrites: string[]
  reports: TaskReport[]
  statuses: EngineStatus[]
  decideCalls: number
  visionCalls: number
}

// 与真实缩略图同尺寸的 BGRA 位图：右下角区域按 flip 交替，保证整帧检测能看到变化；会话列表区域随 listVersion 变化
function makeThumbnail(flip: boolean, listVersion: number): Uint8Array {
  const data = new Uint8Array(THUMBNAIL_WIDTH * THUMBNAIL_HEIGHT * 4).fill(120)
  const paint = (x0: number, x1: number, y0: number, y1: number, value: number): void => {
    for (let y = y0; y < y1; y++) data.fill(value, (y * THUMBNAIL_WIDTH + x0) * 4, (y * THUMBNAIL_WIDTH + x1) * 4)
  }
  if (flip) paint(100, THUMBNAIL_WIDTH, 96, THUMBNAIL_HEIGHT, 0)
  if (listVersion % 2 === 1) paint(0, 56, 10, 110, 30)
  return data
}

interface VisionCall {
  expectSearchResults: boolean
}

function harness(
  observations: Observation[],
  options: {
    replyMode?: 'auto' | 'confirm'
    reply?: string
    skip?: boolean
    staticFrames?: boolean
    idleRefreshMs?: number
    failDecideTimes?: number
    failVisionTimes?: number
    listState?: { version: number }
    visionFn?: (call: VisionCall, index: number) => Observation
  } = {}
): Harness {
  const settings: Settings = SettingsSchema.parse({})
  settings.engine.pollIntervalMs = 5
  settings.engine.afterReplyPollMs = 5
  settings.engine.replyMode = options.replyMode ?? 'confirm'
  settings.engine.idleRefreshMs = options.idleRefreshMs ?? 0
  settings.input.humanize = false

  const backend = new FakeBackend()
  const clipboardWrites: string[] = []
  const input = new InputController(
    backend,
    {
      readText: () => '',
      writeText: (text) => clipboardWrites.push(text),
      writeImageFromPath: () => undefined
    },
    () => false
  )

  const state: Harness = {
    engine: undefined as unknown as Engine,
    backend,
    clipboardWrites,
    reports: [],
    statuses: [],
    decideCalls: 0,
    visionCalls: 0
  }

  let frameNo = 0
  const capture = async (): Promise<CapturedFrame> => {
    frameNo++
    return {
      frame: {
        imageBase64: 'x',
        mime: 'image/jpeg',
        width: 1000,
        height: 500,
        screenRect: { ...TARGET.rect },
        takenAt: 0
      },
      thumbnail: makeThumbnail(!options.staticFrames && frameNo % 2 === 0, options.listState?.version ?? 0)
    }
  }

  state.engine = new Engine({
    settings: () => settings,
    capture,
    windows: { getInfo: async () => TARGET, focus: async () => true },
    vision: {
      observe: async (_frame, observeOptions) => {
        const callIndex = state.visionCalls
        state.visionCalls++
        if (callIndex < (options.failVisionTimes ?? 0)) throw new Error('模型输出无法解析')
        if (options.visionFn) {
          return options.visionFn({ expectSearchResults: observeOptions?.expectSearchResults === true }, callIndex)
        }
        return observations[Math.min(callIndex, observations.length - 1)]
      }
    },
    brain: {
      decide: async () => {
        state.decideCalls++
        if (state.decideCalls <= (options.failDecideTimes ?? 0)) throw new Error('模型输出无法解析')
        if (options.skip) return { action: 'skip', text: '', reason: '群聊闲聊' }
        return { action: 'reply', text: options.reply ?? '收到，稍后回复你', reason: '' }
      }
    },
    input,
    profiles: { find: () => null },
    extractor: { ingest: () => undefined },
    reportTask: (report) => state.reports.push(report),
    onStatus: (status) => state.statuses.push(status),
    errorBackoffMs: 5
  })
  return state
}

async function waitFor(condition: () => boolean, timeoutMs = 4000): Promise<void> {
  const started = Date.now()
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('等待条件超时')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const task = (name: string, texts: string[]): TaskMessage => ({
  id: 'task-1',
  source: 'test',
  target: { name, chatType: 'single' },
  actions: texts.map((text) => ({ type: 'text' as const, text })),
  createdAt: 0
})

test('启动时已有的消息视为基线，不会回复', async () => {
  const h = harness([observation('Alice', [msg('peer', '你好')])])
  h.engine.start(TARGET)
  await waitFor(() => h.visionCalls >= 4)
  h.engine.stop()
  assert.equal(h.decideCalls, 0)
  assert.equal(h.backend.calls.length, 0)
})

test('确认模式：新消息生成待确认回复，用户确认后才发送', async () => {
  const h = harness(
    [
      observation('Alice', [msg('peer', '你好')]),
      observation('Alice', [msg('peer', '你好'), msg('peer', '在吗？')])
    ],
    { replyMode: 'confirm', reply: '在的' }
  )
  h.engine.start(TARGET)
  await waitFor(() => h.engine.status().pendingReply !== null)
  const pending = h.engine.status().pendingReply
  assert.equal(pending?.contact, 'Alice')
  assert.equal(pending?.text, '在的')
  assert.equal(h.backend.calls.length, 0)

  h.engine.confirmReply(pending?.id ?? '', '好的，我看一下')
  await waitFor(() => h.backend.calls.includes('key:enter'))
  assert.equal(h.engine.status().pendingReply, null)
  h.engine.stop()
  assert.ok(h.clipboardWrites.includes('好的，我看一下'))
  assert.ok(h.backend.calls.includes('key:control+v'))
})

test('自动模式：新消息直接点击输入框、粘贴并发送', async () => {
  const h = harness(
    [
      observation('Alice', [msg('peer', '你好')]),
      observation('Alice', [msg('peer', '你好'), msg('peer', '在吗？')])
    ],
    { replyMode: 'auto', reply: '在的' }
  )
  h.engine.start(TARGET)
  await waitFor(() => h.backend.calls.includes('key:enter'))
  h.engine.stop()
  assert.equal(h.decideCalls, 1)
  assert.ok(h.clipboardWrites.includes('在的'))
  assert.ok(h.backend.calls.includes('click'))
  const clickIndex = h.backend.calls.indexOf('click')
  assert.ok(h.backend.calls[clickIndex - 1].startsWith('move:'))
})

test('最后一条是自己发的消息时不回复', async () => {
  const h = harness([
    observation('Alice', [msg('peer', '你好')]),
    observation('Alice', [msg('peer', '你好'), msg('self', '你好呀')])
  ])
  h.engine.start(TARGET)
  await waitFor(() => h.visionCalls >= 4)
  h.engine.stop()
  assert.equal(h.decideCalls, 0)
})

test('任务：搜索联系人、校验会话后发送内容并回报成功', async () => {
  const h = harness([
    observation('Alice', [msg('peer', '你好')]),
    observation('Alice', [msg('peer', '你好')], { searchResults: [{ title: 'Bob', box: box(0, 100, 280, 160) }] }),
    observation('Bob', [])
  ])
  h.engine.start(TARGET)
  h.engine.submitTask(task('Bob', ['你好，Bob']))
  await waitFor(() => h.reports.some((r) => r.status === 'succeeded'))
  h.engine.stop()
  assert.deepEqual(
    h.reports.map((r) => r.status),
    ['queued', 'running', 'succeeded']
  )
  assert.ok(h.clipboardWrites.includes('Bob'))
  assert.ok(h.clipboardWrites.includes('你好，Bob'))
  assert.ok(h.backend.calls.includes('key:control+a'))
  assert.ok(h.backend.calls.includes('key:enter'))
})

test('任务：当前就在目标会话时不再搜索', async () => {
  const h = harness([observation('Bob', [msg('peer', '早')])])
  h.engine.start(TARGET)
  h.engine.submitTask(task('Bob', ['提醒一下']))
  await waitFor(() => h.reports.some((r) => r.status === 'succeeded'))
  h.engine.stop()
  assert.ok(!h.clipboardWrites.includes('Bob'))
  assert.ok(h.clipboardWrites.includes('提醒一下'))
})

test('任务：搜索结果里没有目标时失败并说明原因', async () => {
  const h = harness([
    observation('Alice', [msg('peer', '你好')]),
    observation('Alice', [msg('peer', '你好')], { searchResults: [{ title: '别的人', box: box(0, 100, 280, 160) }] })
  ])
  h.engine.start(TARGET)
  h.engine.submitTask(task('Bob', ['你好']))
  await waitFor(() => h.reports.some((r) => r.status === 'failed'))
  h.engine.stop()
  const failed = h.reports.find((r) => r.status === 'failed')
  assert.match(failed?.error ?? '', /没有找到/)
  assert.ok(!h.backend.calls.includes('key:enter'))
})

test('暂停期间不执行任务，恢复后继续', async () => {
  const h = harness([observation('Bob', [msg('peer', '早')])])
  h.engine.start(TARGET)
  await waitFor(() => h.visionCalls >= 2)
  h.engine.pause()
  await new Promise((resolve) => setTimeout(resolve, 60))
  h.engine.submitTask(task('Bob', ['内容']))
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(h.reports.some((r) => r.status === 'running'), false)
  h.engine.resume()
  await waitFor(() => h.reports.some((r) => r.status === 'succeeded'))
  h.engine.stop()
})

test('未读红点：点击红点切换会话，新会话的未读消息会被回复', async () => {
  const h = harness(
    [
      observation('Alice', [msg('peer', '早')], { unreadDots: [box(0, 200, 280, 260)] }),
      observation('Bob', [msg('peer', '在吗？')])
    ],
    { replyMode: 'confirm', reply: '在' }
  )
  h.engine.start(TARGET)
  await waitFor(() => h.engine.status().pendingReply !== null)
  const contact = h.engine.status().pendingReply?.contact
  h.engine.stop()
  assert.equal(contact, 'Bob')
  assert.ok(h.backend.calls.includes('click'))
})

test('当前会话持续有新消息但被跳过时，仍会切换到其他会话的未读', async () => {
  const dot = box(0, 200, 280, 260)
  const h = harness([], {
    skip: true,
    visionFn: (_call, index) => {
      if (index === 0) return observation('热闹的群', [msg('peer', '甲')])
      if (index === 1) return observation('热闹的群', [msg('peer', '甲'), msg('peer', '乙')], { unreadDots: [dot] })
      return observation('热闹的群', [msg('peer', '甲'), msg('peer', '乙')])
    }
  })
  h.engine.start(TARGET)
  await waitFor(() => h.backend.calls.includes('click'))
  h.engine.stop()
  assert.equal(h.decideCalls >= 1, true)
  assert.equal(h.backend.calls.includes('key:enter'), false)
})

test('多个会话的待确认回复分别保留，同一联系人只保留最新的草稿', async () => {
  const world = { title: 'Alice', messages: [msg('peer', 'hi')] }
  const h = harness([], { replyMode: 'confirm', reply: '草稿', visionFn: () => observation(world.title, world.messages) })
  h.engine.start(TARGET)
  await waitFor(() => h.visionCalls >= 2)
  world.messages = [msg('peer', 'hi'), msg('peer', '第一句')]
  await waitFor(() => h.engine.status().pendingCount === 1)
  world.messages = [msg('peer', 'hi'), msg('peer', '第一句'), msg('peer', '第二句')]
  await waitFor(() => h.decideCalls >= 2)
  assert.equal(h.engine.status().pendingCount, 1)
  world.title = 'Bob'
  world.messages = [msg('peer', '早')]
  await waitFor(() => h.visionCalls >= 8)
  h.engine.stop()
})

test('确认草稿时当前打开的不是原会话，会先搜索切回再发送', async () => {
  const world = { title: 'Alice', messages: [msg('peer', 'hi')], searching: false }
  const h = harness([], {
    replyMode: 'confirm',
    reply: '给 Alice 的草稿',
    visionFn: (call) => {
      if (call.expectSearchResults) {
        world.searching = true
        return observation(world.title, world.messages, { searchResults: [{ title: 'Alice', box: box(0, 100, 280, 160) }] })
      }
      if (world.searching) {
        world.title = 'Alice'
        world.messages = [msg('peer', 'hi'), msg('peer', '在吗')]
        world.searching = false
      }
      return observation(world.title, world.messages)
    }
  })
  h.engine.start(TARGET)
  await waitFor(() => h.visionCalls >= 2)
  world.messages = [msg('peer', 'hi'), msg('peer', '在吗')]
  await waitFor(() => h.engine.status().pendingReply !== null)
  const draft = h.engine.status().pendingReply

  world.title = 'Bob'
  world.messages = [msg('peer', '早')]
  const before = h.visionCalls
  await waitFor(() => h.visionCalls >= before + 2)

  h.engine.confirmReply(draft?.id ?? '', '好的')
  await waitFor(() => h.backend.calls.includes('key:enter'))
  h.engine.stop()
  const searchWrite = h.clipboardWrites.indexOf('Alice')
  const draftWrite = h.clipboardWrites.indexOf('好的')
  assert.ok(searchWrite >= 0, '应当先在搜索框粘贴联系人名称')
  assert.ok(draftWrite > searchWrite, '草稿必须在切回原会话之后才粘贴')
  assert.ok(h.backend.calls.includes('key:control+a'))
})

test('画面完全不变时，开启兜底刷新会按间隔重新识别', async () => {
  const h = harness([observation('Alice', [msg('peer', 'hi')])], { staticFrames: true, idleRefreshMs: 40 })
  h.engine.start(TARGET)
  await waitFor(() => h.visionCalls >= 3)
  h.engine.stop()
})

test('画面完全不变且关闭兜底刷新时，只在启动时识别一次', async () => {
  const h = harness([observation('Alice', [msg('peer', 'hi')])], { staticFrames: true, idleRefreshMs: 0 })
  h.engine.start(TARGET)
  await new Promise((resolve) => setTimeout(resolve, 250))
  h.engine.stop()
  assert.equal(h.visionCalls, 1)
})

test('识别失败后即使画面完全不变，也会在下一轮重新识别', async () => {
  const h = harness([observation('Alice', [msg('peer', 'hi')])], {
    staticFrames: true,
    idleRefreshMs: 0,
    failVisionTimes: 2
  })
  h.engine.start(TARGET)
  await waitFor(() => h.visionCalls >= 4)
  h.engine.stop()
  assert.equal(h.visionCalls >= 3, true)
})

test('回复决策失败后，新消息不会被当作已处理，重试后仍能生成回复', async () => {
  const world = { messages: [msg('peer', 'hi')] }
  const h = harness([], {
    replyMode: 'confirm',
    reply: '重试后的回复',
    failDecideTimes: 1,
    visionFn: () => observation('Alice', world.messages)
  })
  h.engine.start(TARGET)
  await waitFor(() => h.visionCalls >= 2)
  world.messages = [msg('peer', 'hi'), msg('peer', '在吗')]
  await waitFor(() => h.engine.status().pendingReply !== null)
  const pending = h.engine.status().pendingReply
  h.engine.stop()
  assert.equal(h.decideCalls >= 2, true)
  assert.equal(pending?.text, '重试后的回复')
})

test('点击未读前会话列表已被重排，会重新识别并按新位置点击', async () => {
  const list = { version: 0 }
  const oldDot = box(0, 200, 280, 260)
  const newDot = box(0, 600, 280, 660)
  const h = harness([], {
    skip: true,
    listState: list,
    visionFn: (_call, index) => {
      if (index === 0) return observation('群', [msg('peer', '甲')])
      if (index === 1) {
        list.version++
        return observation('群', [msg('peer', '甲'), msg('peer', '乙')], { unreadDots: [oldDot] })
      }
      if (index === 2) return observation('群', [msg('peer', '甲'), msg('peer', '乙')], { unreadDots: [newDot] })
      return observation('Bob', [msg('peer', '丙')])
    }
  })
  h.engine.start(TARGET)
  await waitFor(() => h.backend.calls.some((c) => c.startsWith('move:')))
  h.engine.stop()
  const firstMove = h.backend.calls.find((c) => c.startsWith('move:')) ?? ''
  const y = Number(firstMove.split(',')[1])
  assert.equal(y >= 250, true, `应点在新位置（y≥250），实际 ${firstMove}`)
  assert.equal(h.visionCalls >= 3, true)
})

test('会话列表已变化且重新识别后没有红点，则放弃这次点击', async () => {
  const list = { version: 0 }
  const h = harness([], {
    skip: true,
    listState: list,
    visionFn: (_call, index) => {
      if (index === 0) return observation('群', [msg('peer', '甲')])
      if (index === 1) {
        list.version++
        return observation('群', [msg('peer', '甲'), msg('peer', '乙')], { unreadDots: [box(0, 200, 280, 260)] })
      }
      return observation('群', [msg('peer', '甲'), msg('peer', '乙')])
    }
  })
  h.engine.start(TARGET)
  await waitFor(() => h.visionCalls >= 5)
  h.engine.stop()
  assert.equal(h.backend.calls.includes('click'), false)
})
