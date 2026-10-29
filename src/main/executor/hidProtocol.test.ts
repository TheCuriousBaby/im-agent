// 硬件 HID 指令编码与坐标换算的单元测试。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HID_AXIS_MAX, HidUnsupportedError, hidCommands, hidKeyName, isAck, toHidAxis } from './hidProtocol'

const SCREEN = { x: 0, y: 0, width: 1920, height: 1080 }

test('toHidAxis 把屏幕两端映射到 0 和 65535', () => {
  assert.deepEqual(toHidAxis({ x: 0, y: 0 }, SCREEN), { x: 0, y: 0 })
  assert.deepEqual(toHidAxis({ x: 1919, y: 1079 }, SCREEN), { x: HID_AXIS_MAX, y: HID_AXIS_MAX })
})

test('toHidAxis 按比例换算中间点', () => {
  const axis = toHidAxis({ x: 960, y: 540 }, SCREEN)
  assert.equal(axis.x, Math.round((960 / 1919) * HID_AXIS_MAX))
  assert.equal(axis.y, Math.round((540 / 1079) * HID_AXIS_MAX))
})

test('toHidAxis 把主屏之外的点收进边缘', () => {
  assert.deepEqual(toHidAxis({ x: -50, y: 5000 }, SCREEN), { x: 0, y: HID_AXIS_MAX })
  assert.deepEqual(toHidAxis({ x: 2500, y: -1 }, SCREEN), { x: HID_AXIS_MAX, y: 0 })
})

test('hidKeyName 转换别名并拒绝不支持的键', () => {
  assert.equal(hidKeyName('Enter'), 'enter')
  assert.equal(hidKeyName('pagedown'), 'pagedn')
  assert.equal(hidKeyName('f12'), 'f12')
  assert.equal(hidKeyName('kp_5'), 'kp_5')
  assert.throws(() => hidKeyName('f13'), /不支持的按键/)
  assert.throws(() => hidKeyName('中'), /不支持的按键/)
})

test('指令编码', () => {
  assert.equal(hidCommands.move({ x: 100, y: 200 }), 'M006400C8')
  assert.equal(hidCommands.move({ x: HID_AXIS_MAX, y: 0 }), 'MFFFF0000')
  assert.equal(hidCommands.buttonDown('left'), 'DL')
  assert.equal(hidCommands.buttonUp('left'), 'UL')
  assert.equal(hidCommands.keyTap('v', ['control']), 'Kctrl+v')
  assert.equal(hidCommands.keyTap('enter'), 'Kenter')
  assert.equal(hidCommands.ping(), 'P')
})

test('移动坐标超出范围时收进 0 到 65535', () => {
  assert.equal(hidCommands.move({ x: -5, y: 70000 }), 'M0000FFFF')
  assert.equal(hidCommands.move({ x: 3.6, y: 4.4 }), 'M00040004')
})

test('模组还没搭的指令抛出 HidUnsupportedError', () => {
  assert.throws(() => hidCommands.buttonDown('right'), HidUnsupportedError)
  assert.throws(() => hidCommands.buttonUp('middle'), HidUnsupportedError)
  assert.throws(() => hidCommands.scroll(3), HidUnsupportedError)
  assert.throws(() => hidCommands.typeText('abc'), HidUnsupportedError)
})

test('不支持的修饰键会报错', () => {
  assert.throws(() => hidCommands.keyTap('a', ['command']), /不支持的修饰键/)
})

test('isAck 忽略大小写和空白', () => {
  assert.equal(isAck('OK'), true)
  assert.equal(isAck(' ok \r'), true)
  assert.equal(isAck('ERR'), false)
})
