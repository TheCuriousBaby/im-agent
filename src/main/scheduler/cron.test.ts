// cron 的单元测试：校验与下一次触发时间。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isValidCron, nextCronRun } from './cron'

const at = (y: number, mo: number, d: number, h: number, mi: number): number => new Date(y, mo - 1, d, h, mi).getTime()

test('每 15 分钟：取下一个整刻', () => {
  const next = nextCronRun('*/15 * * * *', at(2026, 10, 20, 10, 7)) as number
  assert.equal(new Date(next).getHours(), 10)
  assert.equal(new Date(next).getMinutes(), 15)
})

test('触发时间严格晚于起点', () => {
  const next = nextCronRun('30 10 * * *', at(2026, 10, 20, 10, 30)) as number
  assert.equal(new Date(next).getDate(), 21)
})

test('工作日 9 点：周五之后跳到下周一', () => {
  const friday = new Date(2026, 9, 23, 10, 0)
  assert.equal(friday.getDay(), 5)
  const next = new Date(nextCronRun('0 9 * * 1-5', friday.getTime()) as number)
  assert.equal(next.getDay(), 1)
  assert.equal(next.getHours(), 9)
  assert.equal(next.getMinutes(), 0)
})

test('每月 31 日：跳过没有 31 日的月份', () => {
  const next = new Date(nextCronRun('30 2 31 * *', at(2026, 2, 1, 0, 0)) as number)
  assert.equal(next.getMonth(), 2)
  assert.equal(next.getDate(), 31)
  assert.equal(next.getHours(), 2)
})

test('日与周同时限定时任一满足即可', () => {
  const next = new Date(nextCronRun('0 8 15 * 1', at(2026, 10, 20, 0, 0)) as number)
  assert.ok(next.getDate() === 15 || next.getDay() === 1)
})

test('非法表达式被拒绝', () => {
  assert.equal(isValidCron('61 * * * *'), false)
  assert.equal(isValidCron('* * *'), false)
  assert.equal(isValidCron('*/0 * * * *'), false)
  assert.equal(isValidCron('0 9 * * 1-5'), true)
})
