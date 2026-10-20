// humanize 的单元测试：随机整数与贝塞尔轨迹。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bezierPath, DEFAULT_TRAJECTORY, randomInt } from './humanize'

test('随机整数落在闭区间内，参数顺序不影响结果', () => {
  assert.equal(randomInt(5, 9, () => 0), 5)
  assert.equal(randomInt(5, 9, () => 0.999999), 9)
  assert.equal(randomInt(9, 5, () => 0), 5)
})

test('轨迹最后一个点精确落在目标上', () => {
  const path = bezierPath({ x: 0, y: 0 }, { x: 640, y: 480 }, {}, () => 0.5)
  assert.deepEqual({ x: path[path.length - 1].x, y: path[path.length - 1].y }, { x: 640, y: 480 })
})

test('步数随距离增长并受上下限约束', () => {
  const near = bezierPath({ x: 0, y: 0 }, { x: 40, y: 0 }, {}, () => 0.5)
  const far = bezierPath({ x: 0, y: 0 }, { x: 3000, y: 2000 }, {}, () => 0.5)
  assert.equal(near.length, DEFAULT_TRAJECTORY.minSteps)
  assert.equal(far.length, DEFAULT_TRAJECTORY.maxSteps)
})

test('起点与终点重合时只返回一个点', () => {
  const path = bezierPath({ x: 10, y: 10 }, { x: 10, y: 10 })
  assert.equal(path.length, 1)
  assert.equal(path[0].delayMs, 0)
})

test('每一步的延迟非负且不超过上限加抖动', () => {
  const path = bezierPath({ x: 0, y: 0 }, { x: 500, y: 500 }, {}, Math.random)
  for (const point of path) {
    assert.ok(point.delayMs >= 0)
    assert.ok(point.delayMs <= DEFAULT_TRAJECTORY.maxDelayMs + 1)
  }
})
