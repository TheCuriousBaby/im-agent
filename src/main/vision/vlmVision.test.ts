// vlmVision 的单元测试：模型输出到识别结果的解析与容错。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseObservation } from './vlmVision'

const sample = {
  conversation_title: '张三',
  is_group: false,
  search_bar: [10, 20, 300, 60],
  input_area: [300, 850, 990, 990],
  chat_area: [300, 80, 990, 840],
  session_list: [0, 80, 290, 990],
  unread_dots: [
    [0, 100, 280, 160],
    [5, 5, 5, 5]
  ],
  search_results: [
    { title: '张三', box: [0, 100, 280, 160] },
    { title: '无框', box: null }
  ],
  messages: [
    { role: 'peer', text: '在吗', box: [320, 100, 500, 140] },
    { role: 'self', text: '在', box: null },
    { role: 'system', text: '', box: null }
  ]
}

test('完整结果被解析，非法框与空系统消息被过滤', () => {
  const obs = parseObservation(JSON.stringify(sample))
  assert.equal(obs.conversationTitle, '张三')
  assert.deepEqual(obs.inputArea, [300, 850, 990, 990])
  assert.equal(obs.unreadDots.length, 1)
  assert.equal(obs.searchResults.length, 1)
  assert.deepEqual(obs.messages.map((x) => x.text), ['在吗', '在'])
})

test('代码块包裹与前后说明文字可以容忍', () => {
  const fence = '```'
  const obs = parseObservation(`分析结果：\n${fence}json\n${JSON.stringify(sample)}\n${fence}`)
  assert.equal(obs.messages.length, 2)
})

test('缺失字段使用默认值', () => {
  const obs = parseObservation('{"conversation_title":"A"}')
  assert.equal(obs.inputArea, null)
  assert.deepEqual(obs.messages, [])
  assert.equal(obs.isGroup, false)
})

test('框越界时被收进 0 到 1000', () => {
  const obs = parseObservation('{"input_area":[-20,900,1300,1200]}')
  assert.deepEqual(obs.inputArea, [0, 900, 1000, 1000])
})

test('没有 JSON 时抛出', () => {
  assert.throws(() => parseObservation('无法识别'))
})
