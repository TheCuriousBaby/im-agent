// 输入后端路由的单元测试：手动模式、自动探测、失败回退与探测缓存。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Settings } from '../../shared/settings'
import { HidUnsupportedError } from './hidProtocol'
import type { InputBackend } from './inputBackend'
import { RoutingInputBackend, type BackendKind } from './routingBackend'

class FakeBackend implements InputBackend {
  calls: string[] = []
  failWith: Error | null = null
  constructor(private readonly name: string) {}
  private record(call: string): void {
    this.calls.push(call)
    if (this.failWith) throw this.failWith
  }
  async moveTo(): Promise<void> {
    this.record(`${this.name}:move`)
  }
  async click(): Promise<void> {
    this.record(`${this.name}:click`)
  }
  async keyTap(key: string): Promise<void> {
    this.record(`${this.name}:key:${key}`)
  }
  async typeString(): Promise<void> {
    this.record(`${this.name}:type`)
  }
  async scroll(): Promise<void> {
    this.record(`${this.name}:scroll`)
  }
  async mousePosition(): Promise<{ x: number; y: number }> {
    return { x: 0, y: 0 }
  }
  dispose(): void {}
}

function setup(mode: Settings['input']['backend'], probeResults: boolean[] = [true]) {
  const software = new FakeBackend('soft')
  const hardware = new FakeBackend('hard')
  let currentMode = mode
  let clock = 0
  let probes = 0
  const switches: Array<[BackendKind, string]> = []
  const router = new RoutingInputBackend(software, hardware, () => currentMode, {
    probe: async () => probeResults[Math.min(probes++, probeResults.length - 1)],
    onSwitch: (kind, reason) => switches.push([kind, reason]),
    now: () => clock,
    okTtlMs: 1000,
    failTtlMs: 500
  })
  return {
    router,
    software,
    hardware,
    switches,
    probes: () => probes,
    setMode: (m: Settings['input']['backend']) => void (currentMode = m),
    advance: (ms: number) => void (clock += ms)
  }
}

test('手动指定软件：不探测硬件', async () => {
  const t = setup('software')
  await t.router.keyTap('a')
  assert.deepEqual(t.software.calls, ['soft:key:a'])
  assert.equal(t.probes(), 0)
})

test('手动指定硬件：不探测，失败也直接报错，不回退', async () => {
  const t = setup('hardware')
  t.hardware.failWith = new Error('串口断开')
  await assert.rejects(t.router.keyTap('a'), /串口断开/)
  assert.deepEqual(t.software.calls, [])
  assert.equal(t.probes(), 0)
})

test('自动：识别到硬件就走硬件', async () => {
  const t = setup('auto', [true])
  await t.router.keyTap('a')
  assert.deepEqual(t.hardware.calls, ['hard:key:a'])
  assert.deepEqual(t.software.calls, [])
  assert.deepEqual(t.switches, [['hardware', '键盘：自动识别到硬件 HID 模组']])
})

test('自动：没有硬件就走软件，并给出原因', async () => {
  const t = setup('auto', [false])
  await t.router.keyTap('a')
  assert.deepEqual(t.software.calls, ['soft:key:a'])
  assert.deepEqual(t.hardware.calls, [])
  assert.equal(t.switches[0][0], 'software')
  assert.match(t.switches[0][1], /没有识别到/)
})

test('自动：探测结果在有效期内复用，过期后重新探测', async () => {
  const t = setup('auto', [true])
  await t.router.keyTap('a')
  await t.router.keyTap('b')
  assert.equal(t.probes(), 1)
  t.advance(1500)
  await t.router.keyTap('c')
  assert.equal(t.probes(), 2)
})

test('自动：探测失败的缓存更短，模组后来插上能走硬件', async () => {
  const t = setup('auto', [false, true])
  await t.router.keyTap('a')
  t.advance(600)
  await t.router.keyTap('b')
  assert.deepEqual(t.software.calls, ['soft:key:a'])
  assert.deepEqual(t.hardware.calls, ['hard:key:b'])
})

test('自动：硬件操作失败时本次回退到软件，同一类操作暂时不再尝试硬件', async () => {
  const t = setup('auto', [true])
  t.hardware.failWith = new Error('模组没有回应')
  await t.router.keyTap('a')
  await t.router.keyTap('b')
  assert.deepEqual(t.hardware.calls, ['hard:key:a'])
  assert.deepEqual(t.software.calls, ['soft:key:a', 'soft:key:b'])
  assert.match(t.switches.at(-1)![1], /回退到软件模拟/)
})

test('自动：鼠标指令失败不影响键盘继续走硬件', async () => {
  const t = setup('auto', [true])
  const mouseFailure = new Error('模组没有回应')
  t.hardware.failWith = mouseFailure
  await t.router.moveTo({ x: 1, y: 1 }, false)
  t.hardware.failWith = null
  await t.router.keyTap('a')
  await t.router.moveTo({ x: 2, y: 2 }, false)
  assert.deepEqual(t.hardware.calls, ['hard:move', 'hard:key:a'])
  assert.deepEqual(t.software.calls, ['soft:move', 'soft:move'])
})

test('自动：某一类操作失败的暂停期过后会再试硬件', async () => {
  const t = setup('auto', [true])
  t.hardware.failWith = new Error('模组没有回应')
  await t.router.moveTo({ x: 1, y: 1 }, false)
  t.hardware.failWith = null
  t.advance(61_000)
  await t.router.moveTo({ x: 2, y: 2 }, false)
  assert.deepEqual(t.hardware.calls, ['hard:move', 'hard:move'])
})

test('自动：硬件表达不了的输入只回退这一次，硬件仍可用', async () => {
  const t = setup('auto', [true])
  t.hardware.failWith = new HidUnsupportedError('不支持的按键')
  await t.router.keyTap('f13')
  t.hardware.failWith = null
  await t.router.keyTap('a')
  assert.deepEqual(t.software.calls, ['soft:key:f13'])
  assert.deepEqual(t.hardware.calls, ['hard:key:f13', 'hard:key:a'])
  assert.equal(t.probes(), 1)
})

test('并发操作共用同一次探测', async () => {
  const t = setup('auto', [true])
  await Promise.all([t.router.keyTap('a'), t.router.keyTap('b'), t.router.moveTo({ x: 1, y: 1 }, false)])
  assert.equal(t.probes(), 1)
})

test('设置切换立即生效，reset 会丢掉探测缓存', async () => {
  const t = setup('auto', [true, false])
  await t.router.keyTap('a')
  t.setMode('software')
  await t.router.keyTap('b')
  t.setMode('auto')
  t.router.reset()
  await t.router.keyTap('c')
  assert.deepEqual(t.hardware.calls, ['hard:key:a'])
  assert.deepEqual(t.software.calls, ['soft:key:b', 'soft:key:c'])
  assert.equal(t.probes(), 2)
})
