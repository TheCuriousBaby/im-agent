// 硬件 HID 模组的串口文本协议：把键鼠原子操作编码成一行 ASCII 指令，纯函数，不依赖 Electron。
// 指令格式与模组侧 cyStudio 工程的约定见 docs/hid-module.md。
import type { Point, Rect } from '../../shared/types'
import type { MouseButtonName } from './protocol'

// HID 绝对定位坐标的取值范围，模组侧 HID 组件的屏宽、屏高也要设成这个值
export const HID_AXIS_MAX = 65535

// 硬件 HID 无法表达的输入（键名、修饰键或文字不支持），自动模式下据此回退到软件模拟，不代表硬件故障
export class HidUnsupportedError extends Error {}

const MODIFIER_NAMES: Record<string, string> = {
  control: 'ctrl',
  ctrl: 'ctrl',
  shift: 'shift',
  alt: 'alt'
}

// robotjs 键名到模组键名的别名，其余键名两边一致
const KEY_ALIASES: Record<string, string> = {
  pagedown: 'pagedn',
  return: 'enter',
  esc: 'escape'
}

const NAMED_KEYS = new Set([
  'up',
  'down',
  'left',
  'right',
  'enter',
  'pause',
  'space',
  'power',
  'pageup',
  'pagedn',
  'escape',
  'printscr',
  'backspace',
  'delete',
  'capslk',
  'home',
  'numlock',
  'kp_+',
  'kp_-',
  'kp_*',
  'kp_/',
  'kp_.',
  'kp_enter'
])

function isSupportedKey(key: string): boolean {
  if (/^[a-z0-9.]$/.test(key)) return true
  if (/^f([1-9]|1[0-2])$/.test(key)) return true
  if (/^kp_[0-9]$/.test(key)) return true
  return NAMED_KEYS.has(key)
}

export function hidKeyName(key: string): string {
  const lower = key.toLowerCase()
  const name = KEY_ALIASES[lower] ?? lower
  if (!isSupportedKey(name)) throw new HidUnsupportedError(`硬件 HID 不支持的按键：${key}`)
  return name
}

export function hidModifierName(modifier: string): string {
  const name = MODIFIER_NAMES[modifier.toLowerCase()]
  if (!name) throw new HidUnsupportedError(`硬件 HID 不支持的修饰键：${modifier}`)
  return name
}

// 屏幕物理像素坐标换算成 0~65535 的绝对坐标，超出主屏范围的点收进边缘
export function toHidAxis(point: Point, screen: Rect): Point {
  const norm = (value: number, origin: number, size: number): number => {
    if (size <= 1) return 0
    const ratio = (value - origin) / (size - 1)
    return Math.round(Math.max(0, Math.min(1, ratio)) * HID_AXIS_MAX)
  }
  return { x: norm(point.x, screen.x, screen.width), y: norm(point.y, screen.y, screen.height) }
}

const hex4 = (value: number): string =>
  Math.max(0, Math.min(HID_AXIS_MAX, Math.round(value)))
    .toString(16)
    .toUpperCase()
    .padStart(4, '0')

// 模组里目前只搭了左键按下、松开；其他按键、滚轮和直接输入字符串都还没有对应的模组程序，
// 抛出 HidUnsupportedError，自动模式下这些操作会走软件模拟
export const hidCommands = {
  move: (axis: Point): string => `M${hex4(axis.x)}${hex4(axis.y)}`,
  buttonDown: (button: MouseButtonName): string => {
    if (button !== 'left') throw new HidUnsupportedError(`模组暂不支持${button === 'right' ? '右' : '中'}键`)
    return 'DL'
  },
  buttonUp: (button: MouseButtonName): string => {
    if (button !== 'left') throw new HidUnsupportedError(`模组暂不支持${button === 'right' ? '右' : '中'}键`)
    return 'UL'
  },
  scroll: (_dy: number): string => {
    throw new HidUnsupportedError('模组暂不支持鼠标滚轮')
  },
  keyTap: (key: string, modifiers: string[] = []): string =>
    `K${[...modifiers.map(hidModifierName), hidKeyName(key)].join('+')}`,
  typeText: (_text: string): string => {
    throw new HidUnsupportedError('模组暂不支持直接输入字符串，文字请走剪贴板粘贴')
  },
  ping: (): string => 'P'
} as const

// 模组处理完一条指令后回一行 OK
export function isAck(line: string): boolean {
  return line.trim().toUpperCase() === 'OK'
}
