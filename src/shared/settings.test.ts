// settings 的单元测试：默认值、智能体选择、速度档位与单独配置模型时的沿用规则。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  activeAgent,
  DEFAULT_AGENT,
  defaultSettings,
  ModelConfigSchema,
  resolveModelConfig,
  SettingsSchema,
  SPEED_PRESETS,
  speedOf,
  toPublicSettings
} from './settings'

const model = (over: Record<string, unknown>) => ModelConfigSchema.parse(over)

test('默认设置包含一个已开启的默认智能体，回复方式为确认', () => {
  const s = defaultSettings()
  assert.equal(s.agents.length, 1)
  assert.equal(activeAgent(s).id, DEFAULT_AGENT.id)
  assert.equal(s.engine.replyMode, 'confirm')
})

test('智能体：已启用的置顶优先，没有启用则回退到内置默认', () => {
  const base = defaultSettings()
  const a = { ...DEFAULT_AGENT, id: 'a', name: 'A', enabled: true, pinned: false }
  const b = { ...DEFAULT_AGENT, id: 'b', name: 'B', enabled: true, pinned: true }
  assert.equal(activeAgent({ agents: [a, b] }).id, 'b')
  assert.equal(activeAgent({ agents: [{ ...a, enabled: false }] }).id, DEFAULT_AGENT.id)
  assert.equal(activeAgent(base).id, DEFAULT_AGENT.id)
})

test('速度档位与轮询间隔互相换算，不在档位上时为自定义', () => {
  const fast = SPEED_PRESETS.fast
  assert.equal(speedOf({ pollIntervalMs: fast.pollIntervalMs, afterReplyPollMs: fast.afterReplyPollMs }), 'fast')
  assert.equal(speedOf(defaultSettings().engine), 'standard')
  assert.equal(speedOf({ pollIntervalMs: 3333, afterReplyPollMs: 1500 }), 'custom')
})

test('回复模型没填密钥与端点时沿用识别模型，其他字段保持自己的', () => {
  const vision = model({ baseUrl: 'https://v/v1', apiKey: 'key-v', model: 'vl' })
  const reply = model({ model: 'text-big', wire: 'responses' })
  const resolved = resolveModelConfig({ vision, reply, profile: null }, 'reply')
  assert.equal(resolved.baseUrl, 'https://v/v1')
  assert.equal(resolved.apiKey, 'key-v')
  assert.equal(resolved.model, 'text-big')
  assert.equal(resolved.wire, 'responses')
})

test('单独配置了密钥时不被覆盖；画像沿用回复再沿用识别', () => {
  const vision = model({ baseUrl: 'https://v/v1', apiKey: 'key-v', model: 'vl' })
  const reply = model({ apiKey: 'key-r', model: 'text' })
  const profile = model({ model: 'mini' })
  const resolved = resolveModelConfig({ vision, reply, profile }, 'profile')
  assert.equal(resolved.apiKey, 'key-r')
  assert.equal(resolved.baseUrl, 'https://v/v1')
  assert.equal(resolved.model, 'mini')
  assert.equal(resolveModelConfig({ vision, reply: null, profile: null }, 'profile').model, 'vl')
})

test('对界面暴露的设置不含密钥，只有是否已设置', () => {
  const s = SettingsSchema.parse({ vision: { apiKey: 'secret', model: 'm' }, remote: { token: 'tok' } })
  const json = JSON.stringify(toPublicSettings(s))
  assert.ok(!json.includes('secret'))
  assert.ok(!json.includes('tok'))
  assert.equal(toPublicSettings(s).vision.apiKeySet, true)
  assert.equal(toPublicSettings(s).remote.tokenSet, true)
})

test('端点、密钥、模型名两端的空白（如粘贴带入的制表符）会被去掉', () => {
  const parsed = ModelConfigSchema.parse({ baseUrl: ' https://v/v1 ', apiKey: '\tkey\n', model: '\tqwen3.7-plus ' })
  assert.equal(parsed.baseUrl, 'https://v/v1')
  assert.equal(parsed.apiKey, 'key')
  assert.equal(parsed.model, 'qwen3.7-plus')
})
