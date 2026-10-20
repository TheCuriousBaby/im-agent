// coords 的单元测试：归一化框换算与安全点选取。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clampNormBox, isValidNormBox, normBoxToScreenPoint, normBoxToScreenRect, pickSafePoint } from './coords'

const screenRect = { x: 100, y: 50, width: 1000, height: 500 }

test('归一化框换算为屏幕矩形', () => {
  assert.deepEqual(normBoxToScreenRect([100, 200, 300, 400], screenRect), { x: 200, y: 150, width: 200, height: 100 })
})

test('超出范围的归一化框会被收进 0 到 1000', () => {
  assert.deepEqual(clampNormBox([-50, 0, 1200, 500]), [0, 0, 1000, 500])
})

test('框校验：长度、数值与方向', () => {
  assert.equal(isValidNormBox([1, 2, 3, 4]), true)
  assert.equal(isValidNormBox([3, 2, 1, 4]), false)
  assert.equal(isValidNormBox([1, 2, 3]), false)
  assert.equal(isValidNormBox([1, 2, 3, NaN]), false)
  assert.equal(isValidNormBox(null), false)
})

test('安全点落在内缩区域内', () => {
  const rect = { x: 0, y: 0, width: 400, height: 100 }
  const inset = { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4 }
  assert.deepEqual(pickSafePoint(rect, inset, () => 0), { x: 100, y: 40 })
  assert.deepEqual(pickSafePoint(rect, inset, () => 1), { x: 300, y: 60 })
  assert.deepEqual(pickSafePoint(rect, inset, () => 0.5), { x: 200, y: 50 })
})

test('内缩过大时退回中心点', () => {
  const rect = { x: 10, y: 10, width: 100, height: 100 }
  assert.deepEqual(pickSafePoint(rect, { left: 0.6, right: 0.6, top: 0.6, bottom: 0.6 }, () => 0.3), { x: 60, y: 60 })
})

test('归一化框直接换算为屏幕安全点', () => {
  const point = normBoxToScreenPoint([0, 0, 1000, 1000], screenRect, { left: 0, right: 0, top: 0, bottom: 0 }, () => 0.5)
  assert.deepEqual(point, { x: 600, y: 300 })
})
