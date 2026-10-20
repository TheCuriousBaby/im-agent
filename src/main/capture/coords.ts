// 坐标换算：归一化框到屏幕物理像素，以及框内随机安全点的选取。
import type { NormBox, Point, Rect } from '../../shared/types'

export interface InsetRange {
  left: number
  right: number
  top: number
  bottom: number
}

// 各类目标在框内允许点击的区域，数值是四边向内收缩的比例
export const SAFE_RANGES = {
  messageInput: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4 },
  searchInput: { left: 0.25, right: 0.42, top: 0.35, bottom: 0.35 },
  searchResult: { left: 0.25, right: 0.25, top: 0.25, bottom: 0.25 },
  sessionItem: { left: 0.2, right: 0.2, top: 0.25, bottom: 0.25 },
  unreadDot: { left: 0.1, right: 0.1, top: 0.1, bottom: 0.1 }
} as const satisfies Record<string, InsetRange>

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function isValidNormBox(value: unknown): value is NormBox {
  if (!Array.isArray(value) || value.length !== 4) return false
  if (!value.every((n) => typeof n === 'number' && Number.isFinite(n))) return false
  const [l, t, r, b] = value as number[]
  return r > l && b > t
}

// 把模型返回的框收进 0~1000 范围
export function clampNormBox(box: NormBox): NormBox {
  return [clamp(box[0], 0, 1000), clamp(box[1], 0, 1000), clamp(box[2], 0, 1000), clamp(box[3], 0, 1000)]
}

export function normBoxToScreenRect(box: NormBox, screenRect: Rect): Rect {
  const [l, t, r, b] = clampNormBox(box)
  return {
    x: screenRect.x + (l / 1000) * screenRect.width,
    y: screenRect.y + (t / 1000) * screenRect.height,
    width: ((r - l) / 1000) * screenRect.width,
    height: ((b - t) / 1000) * screenRect.height
  }
}

export function rectCenter(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

export function pickSafePoint(rect: Rect, inset: InsetRange, rand: () => number = Math.random): Point {
  const left = rect.x + rect.width * inset.left
  const right = rect.x + rect.width * (1 - inset.right)
  const top = rect.y + rect.height * inset.top
  const bottom = rect.y + rect.height * (1 - inset.bottom)
  const x = right > left ? left + (right - left) * clamp(rand(), 0, 1) : rect.x + rect.width / 2
  const y = bottom > top ? top + (bottom - top) * clamp(rand(), 0, 1) : rect.y + rect.height / 2
  return { x: Math.round(x), y: Math.round(y) }
}

// 归一化框直接换算成屏幕上的随机安全点
export function normBoxToScreenPoint(
  box: NormBox,
  screenRect: Rect,
  inset: InsetRange,
  rand: () => number = Math.random
): Point {
  return pickSafePoint(normBoxToScreenRect(box, screenRect), inset, rand)
}
