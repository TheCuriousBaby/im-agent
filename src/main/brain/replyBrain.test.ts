// 验证回复决策区分正文有效的回复、生成失败和显式跳过。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultSettings } from '../../shared/settings'
import { ReplyBrain } from './replyBrain'

const input = { contact: 'Alice', isGroup: false, messages: [], profile: null }

function brainReturning(value: object): ReplyBrain {
  return new ReplyBrain({
    ask: async () => ({ text: JSON.stringify(value), inputTokens: 0, outputTokens: 0, latencyMs: 0, finishReason: 'stop' })
  }, defaultSettings)
}

test('回复正文缺失、类型错误或为空时视为生成失败', async () => {
  for (const value of [{ action: 'reply' }, { action: 'reply', text: 123 }, { action: 'reply', text: '  ' }]) {
    await assert.rejects(brainReturning(value).decide(input), /text/)
  }
})

test('有效回复去掉正文首尾空格，显式跳过不要求正文', async () => {
  assert.deepEqual(await brainReturning({ action: 'reply', text: ' 收到 ' }).decide(input), {
    action: 'reply', text: '收到', reason: ''
  })
  assert.deepEqual(await brainReturning({ action: 'skip', reason: '不需要回复' }).decide(input), {
    action: 'skip', text: '', reason: '不需要回复'
  })
})
