// modelClient 中纯函数的单元测试：额外请求参数解析与空输出提示。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyOutputMessage, parseExtraBody, validateModelConfig } from './modelClient'
import { ModelConfigSchema } from '../../shared/settings'

test('额外请求参数为空时返回空对象', () => {
  assert.deepEqual(parseExtraBody(''), {})
  assert.deepEqual(parseExtraBody('   '), {})
})

test('额外请求参数解析为对象', () => {
  assert.deepEqual(parseExtraBody('{"enable_thinking": false}'), { enable_thinking: false })
})

test('额外请求参数不是对象时抛出', () => {
  assert.throws(() => parseExtraBody('[1]'), /JSON 对象/)
  assert.throws(() => parseExtraBody('"x"'), /JSON 对象/)
  assert.throws(() => parseExtraBody('{bad'))
})

test('设置校验拒绝非法的额外请求参数', () => {
  assert.throws(() => ModelConfigSchema.parse({ extraBody: '[1]' }))
  assert.equal(ModelConfigSchema.parse({ extraBody: '{"a":1}' }).extraBody, '{"a":1}')
})

test('空输出提示包含 finish_reason 与处理办法', () => {
  const message = emptyOutputMessage('length', 4096)
  assert.match(message, /finish_reason=length/)
  assert.match(message, /最大输出 token/)
})

test('缺少端点、密钥、模型名时分别给出提示', () => {
  const base = ModelConfigSchema.parse({})
  assert.match(validateModelConfig(base) ?? '', /端点/)
  assert.match(validateModelConfig({ ...base, baseUrl: 'http://x/v1' }) ?? '', /密钥/)
  assert.match(validateModelConfig({ ...base, baseUrl: 'http://x/v1', apiKey: 'k' }) ?? '', /模型名称/)
  assert.equal(validateModelConfig({ ...base, baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' }), null)
})
