// 两帧缩略位图的差异判断：统计亮度明显变化的像素占比，小面积的新增内容也能被发现。

const PIXEL_DELTA = 24

// 输入为等长的 BGRA 字节数组，返回亮度差超过阈值的像素占比（0~1）；长度不一致视为完全不同
export function changedPixelFraction(a: Uint8Array, b: Uint8Array, delta: number = PIXEL_DELTA): number {
  if (a.length !== b.length || a.length === 0) return 1
  let changed = 0
  const pixels = a.length / 4
  for (let i = 0; i < a.length; i += 4) {
    const lumaA = 0.114 * a[i] + 0.587 * a[i + 1] + 0.299 * a[i + 2]
    const lumaB = 0.114 * b[i] + 0.587 * b[i + 1] + 0.299 * b[i + 2]
    if (Math.abs(lumaA - lumaB) > delta) changed++
  }
  return changed / pixels
}

// 变化像素占比超过 ratio 就算界面有变化，没有上一帧时一定算变化
export function hasFrameChanged(previous: Uint8Array | null, current: Uint8Array, ratio: number): boolean {
  if (!previous) return true
  return changedPixelFraction(previous, current) > ratio
}

export const THUMBNAIL_WIDTH = 192
export const THUMBNAIL_HEIGHT = 120

// 只比较缩略图中归一化框（0~1000）所在的区域，返回区域内亮度明显变化的像素占比；缩略图尺寸不符视为完全不同
export function changedFractionInBox(
  a: Uint8Array,
  b: Uint8Array,
  box: readonly [number, number, number, number],
  width: number = THUMBNAIL_WIDTH,
  height: number = THUMBNAIL_HEIGHT,
  delta: number = PIXEL_DELTA
): number {
  const expected = width * height * 4
  if (a.length !== expected || b.length !== expected) return 1
  const x0 = Math.max(0, Math.min(width - 1, Math.floor((box[0] / 1000) * width)))
  const x1 = Math.max(x0 + 1, Math.min(width, Math.ceil((box[2] / 1000) * width)))
  const y0 = Math.max(0, Math.min(height - 1, Math.floor((box[1] / 1000) * height)))
  const y1 = Math.max(y0 + 1, Math.min(height, Math.ceil((box[3] / 1000) * height)))
  let changed = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4
      const lumaA = 0.114 * a[i] + 0.587 * a[i + 1] + 0.299 * a[i + 2]
      const lumaB = 0.114 * b[i] + 0.587 * b[i + 1] + 0.299 * b[i + 2]
      if (Math.abs(lumaA - lumaB) > delta) changed++
    }
  }
  return changed / ((x1 - x0) * (y1 - y0))
}
