// 硬件 HID 后端的单元测试：用假链路模拟模组，验证指令序列、回执等待与错误处理。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HidInputBackend, type HidLink } from './hidBackend'

class FakeLink implements HidLink {
  written: string[] = []
  closed = false
  hangWrite = false
  private lineListener: (line: string) => void = () => {}
  private closeListener: (error?: Error) => void = () => {}

  // 模组行为：收到指令后回 OK，reply 为 false 时装作模组没有响应
  constructor(private reply: boolean = true) {}

  async write(line: string): Promise<void> {
    this.written.push(line)
    if (this.hangWrite) return new Promise<void>(() => undefined)
    if (this.reply) queueMicrotask(() => this.lineListener('OK'))
  }
  onLine(listener: (line: string) => void): void {
    this.lineListener = listener
  }
  onClose(listener: (error?: Error) => void): void {
    this.closeListener = listener
  }
  close(): void {
    this.closed = true
  }
  drop(error?: Error): void {
    this.closeListener(error)
  }
}

const SCREEN = { x: 0, y: 0, width: 1920, height: 1080 }

function makeBackend(link: FakeLink, options: { ack?: boolean; ackTimeoutMs?: number; sleeps?: number[] } = {}) {
  let connects = 0
  const backend = new HidInputBackend({
    connect: async () => {
      connects++
      return link
    },
    screen: () => SCREEN,
    cursor: () => ({ x: 0, y: 0 }),
    ack: () => options.ack ?? true,
    ackTimeoutMs: options.ackTimeoutMs ?? 50,
    sleep: async (ms) => void options.sleeps?.push(ms),
    rand: () => 0.5
  })
  return { backend, connects: () => connects }
}

test('keyTap 发送组合键指令并等待回执', async () => {
  const link = new FakeLink()
  const { backend } = makeBackend(link)
  await backend.keyTap('v', ['control'])
  assert.deepEqual(link.written, ['Kctrl+v'])
})

test('非拟人化移动只发一条定位指令', async () => {
  const link = new FakeLink()
  const { backend } = makeBackend(link)
  await backend.moveTo({ x: 1919, y: 1079 }, false)
  assert.deepEqual(link.written, ['MFFFFFFFF'])
})

test('拟人化移动沿轨迹发送多条定位指令，最后落在目标点', async () => {
  const link = new FakeLink()
  const { backend } = makeBackend(link)
  await backend.moveTo({ x: 960, y: 540 }, true)
  assert.ok(link.written.length > 5)
  assert.ok(link.written.every((line) => /^M[0-9A-F]{8}$/.test(line)))
  assert.equal(
    link.written.at(-1),
    `M${Math.round((960 / 1919) * 65535).toString(16).toUpperCase().padStart(4, '0')}${Math.round((540 / 1079) * 65535).toString(16).toUpperCase().padStart(4, '0')}`
  )
})

test('点击是按下、停顿、松开；双击重复一次', async () => {
  const link = new FakeLink()
  const sleeps: number[] = []
  const { backend } = makeBackend(link, { sleeps })
  await backend.click('left', true)
  assert.deepEqual(link.written, ['DL', 'UL', 'DL', 'UL'])
  assert.equal(sleeps.length, 3)
})

test('连接只建立一次，多个并发操作按顺序发送', async () => {
  const link = new FakeLink()
  const { backend, connects } = makeBackend(link)
  await Promise.all([backend.keyTap('a'), backend.keyTap('b'), backend.keyTap('c')])
  assert.deepEqual(link.written, ['Ka', 'Kb', 'Kc'])
  assert.equal(connects(), 1)
})

test('模组没有回执时超时报错，并提示检查模组程序', async () => {
  const link = new FakeLink(false)
  const { backend } = makeBackend(link)
  await assert.rejects(backend.keyTap('a'), /没有回应/)
})

test('超时之后后续指令仍可正常发送', async () => {
  const link = new FakeLink(false)
  const { backend } = makeBackend(link)
  await assert.rejects(backend.keyTap('a'), /没有回应/)
  link['reply'] = true
  await backend.keyTap('b')
  assert.deepEqual(link.written, ['Ka', 'Kb'])
})

test('关闭回执后发送完即返回，不等待模组', async () => {
  const link = new FakeLink(false)
  const sleeps: number[] = []
  const { backend } = makeBackend(link, { ack: false, sleeps })
  await backend.keyTap('a')
  assert.deepEqual(link.written, ['Ka'])
  assert.equal(sleeps.length, 1)
})

test('串口断开时正在等待的指令报错，下一次操作会重新连接', async () => {
  const link = new FakeLink(false)
  const { backend, connects } = makeBackend(link, { ackTimeoutMs: 1000 })
  const pending = backend.keyTap('a')
  await new Promise((resolve) => setTimeout(resolve, 10))
  link.drop(new Error('unplugged'))
  await assert.rejects(pending, /unplugged/)
  link['reply'] = true
  await backend.keyTap('b')
  assert.equal(connects(), 2)
})

test('不支持的按键在发送前就报错，不触碰串口', async () => {
  const link = new FakeLink()
  const { backend } = makeBackend(link)
  await assert.rejects(backend.keyTap('f13'), /不支持的按键/)
  assert.deepEqual(link.written, [])
})

test('ping 即使关闭了回执也要等模组回应', async () => {
  const link = new FakeLink(false)
  const { backend } = makeBackend(link, { ack: false })
  await assert.rejects(backend.ping(30), /没有回应/)
  link['reply'] = true
  await backend.ping(30)
  assert.deepEqual(link.written, ['P', 'P'])
})

test('写入卡住时也会在超时后报错，不会挂起或产生未处理的异常', async () => {
  const link = new FakeLink(false)
  link.hangWrite = true
  const { backend } = makeBackend(link)
  await assert.rejects(backend.keyTap('a'), /没有回应/)
})

test('dispose 关闭链路', async () => {
  const link = new FakeLink()
  const { backend } = makeBackend(link)
  await backend.keyTap('a')
  backend.dispose()
  assert.equal(link.closed, true)
})
