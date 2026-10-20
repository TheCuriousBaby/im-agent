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
