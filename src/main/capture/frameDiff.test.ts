// frameDiff 的单元测试：变化像素占比与小面积新增内容的可检测性。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { changedPixelFraction, hasFrameChanged } from './frameDiff'

const W = 100
const H = 100

// 纯色 BGRA 帧
const solid = (value: number, pixels = W * H): Uint8Array => new Uint8Array(pixels * 4).fill(value)

// 在帧里把前 count 个像素涂成指定亮度，模拟新增了一小块内容
function withPatch(base: Uint8Array, count: number, value: number): Uint8Array {
  const copy = new Uint8Array(base)
  for (let i = 0; i < count; i++) copy.fill(value, i * 4, i * 4 + 4)
  return copy
}

test('完全相同的帧变化占比为 0', () => {
  assert.equal(changedPixelFraction(solid(200), solid(200)), 0)
})

test('黑白相反的帧变化占比为 1', () => {
  assert.equal(changedPixelFraction(solid(0), solid(255)), 1)
})

test('长度不同或为空视为完全不同', () => {
  assert.equal(changedPixelFraction(solid(0, 10), solid(0, 20)), 1)
  assert.equal(changedPixelFraction(new Uint8Array(0), new Uint8Array(0)), 1)
})

test('亮度只有轻微抖动的像素不算变化', () => {
  assert.equal(changedPixelFraction(solid(200), solid(210)), 0)
})

test('占比等于变化的像素数除以总像素数', () => {
  const before = solid(255)
  assert.equal(changedPixelFraction(before, withPatch(before, 500, 0)), 0.05)
})

test('一条新消息大小的变化（约 0.5% 像素）能被检测到，光标闪烁（约 0.05%）不会', () => {
  const before = solid(255)
  const newMessage = withPatch(before, 50, 0)
  const caretBlink = withPatch(before, 5, 0)
  assert.equal(hasFrameChanged(before, newMessage, 0.003), true)
  assert.equal(hasFrameChanged(before, caretBlink, 0.003), false)
})

test('没有上一帧时一定算变化', () => {
  assert.equal(hasFrameChanged(null, solid(0), 0.5), true)
})
