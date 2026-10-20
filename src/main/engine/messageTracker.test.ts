// messageTracker 与 titleMatch 的单元测试：新消息识别与会话名称匹配。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ObservedMessage } from '../../shared/types'
import { findNewMessages, MessageTracker, normalizeTitle } from './messageTracker'
import { pickSearchResult, titleMatches } from './titleMatch'

const m = (role: ObservedMessage['role'], text: string): ObservedMessage => ({ role, text, box: null })

test('后缀与前缀重叠之后的才是新消息', () => {
  const prev = [m('peer', 'A'), m('self', 'B'), m('peer', 'C')]
  const cur = [m('self', 'B'), m('peer', 'C'), m('peer', 'D')]
  assert.deepEqual(findNewMessages(prev, cur).map((x) => x.text), ['D'])
})

test('列表完全相同时没有新消息', () => {
  const list = [m('peer', 'A'), m('peer', 'A')]
  assert.deepEqual(findNewMessages(list, list), [])
})

test('完全没有重叠时全部算新消息', () => {
  assert.equal(findNewMessages([m('peer', 'A')], [m('peer', 'X'), m('peer', 'Y')]).length, 2)
})

test('文字空白差异不影响比对', () => {
  assert.deepEqual(findNewMessages([m('peer', '你 好')], [m('peer', '你  好'), m('peer', 'Z')]).map((x) => x.text), ['Z'])
})

test('首次见到的会话只记基线，不产生新消息', () => {
  const tracker = new MessageTracker()
  assert.deepEqual(tracker.update('Alice', [m('peer', 'hi')]), [])
  assert.deepEqual(tracker.update('Alice', [m('peer', 'hi'), m('peer', 'yo')]).map((x) => x.text), ['yo'])
})

test('切换未读后首次见到的会话可把全部消息视为新消息', () => {
  const tracker = new MessageTracker()
  assert.equal(tracker.update('Bob', [m('peer', 'a'), m('peer', 'b')], true).length, 2)
})

test('重置后该会话重新记基线', () => {
  const tracker = new MessageTracker()
  tracker.update('Alice', [m('peer', 'hi')])
  tracker.reset('Alice')
  assert.equal(tracker.has('Alice'), false)
})

test('会话名称归一化：去掉人数后缀、空白与大小写', () => {
  assert.equal(normalizeTitle('项目 群（12）'), '项目群')
  assert.equal(normalizeTitle('Alice (3)'), 'alice')
})

test('名称匹配允许互相包含', () => {
  assert.equal(titleMatches('张三 - 销售部', '张三'), true)
  assert.equal(titleMatches('李四', '张三'), false)
  assert.equal(titleMatches('', '张三'), false)
})

test('搜索结果优先选完全相同的一项', () => {
  const results = [
    { title: '张三丰', box: [0, 0, 1, 1] as [number, number, number, number] },
    { title: '张三', box: [0, 2, 1, 3] as [number, number, number, number] }
  ]
  assert.equal(pickSearchResult(results, '张三')?.title, '张三')
  assert.equal(pickSearchResult(results, '李四'), null)
})
