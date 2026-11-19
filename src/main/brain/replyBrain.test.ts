// 验证回复决策区分有效正文、生成失败和显式跳过。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultSettings } from '../../shared/settings'
import { ReplyBrain } from './replyBrain'

const input = { contact: 'Alice', isGroup: false, messages: [], profile: null }

function replyBrain(value: object): ReplyBrain {
  return new ReplyBrain({
    ask: async () => ({ text: JSON.stringify(value), inputTokens: 0, outputTokens: 0, latencyMs: 0, finishReason: 'stop' })
  }, defaultSettings)
}

test('选择回复但正文缺失、类型错误或为空时，返回生成失败', async () => {
  for (const value of [{ action: 'reply' }, { action: 'reply', text: 1 }, { action: 'reply', text: '  ' }]) {
    await assert.rejects(replyBrain(value).decide(input), /text/)
  }
})

test('显式跳过不要求正文，有效回复去除正文两端空白', async () => {
  assert.equal((await replyBrain({ action: 'skip' }).decide(input)).action, 'skip')
  assert.equal((await replyBrain({ action: 'reply', text: ' 收到 ' }).decide(input)).text, '收到')
})
