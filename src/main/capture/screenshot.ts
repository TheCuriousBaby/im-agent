// 窗口截图：截取所在显示器整屏，按窗口物理边界裁剪，缩放后编码为 JPEG，并给出用于差异比较的缩略位图。
import { desktopCapturer, screen } from 'electron'
import type { Frame, Rect, TargetWindow } from '../../shared/types'
import { clamp } from './coords'

export interface CapturedFrame {
  frame: Frame
  thumbnail: Uint8Array
}

const THUMBNAIL_WIDTH = 192
const THUMBNAIL_HEIGHT = 120
const JPEG_QUALITY = 85

function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null
}

export async function captureWindowFrame(target: TargetWindow, maxImageSide: number): Promise<CapturedFrame> {
  const physical = target.rect
  const dipRect = screen.screenToDipRect(null, {
    x: physical.x,
    y: physical.y,
    width: physical.width,
    height: physical.height
  })
  const display = screen.getDisplayMatching(dipRect)
  const origin = screen.dipToScreenPoint({ x: display.bounds.x, y: display.bounds.y })
  const displayRect: Rect = {
    x: origin.x,
    y: origin.y,
    width: Math.round(display.size.width * display.scaleFactor),
    height: Math.round(display.size.height * display.scaleFactor)
  }

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: displayRect.width, height: displayRect.height }
  })
  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
  if (!source) throw new Error('未找到可用的屏幕源')

  const visible = intersect(physical, displayRect)
  if (!visible) throw new Error('目标窗口不在任何显示器范围内')

  const image = source.thumbnail
  const imageSize = image.getSize()
  const cropRect = {
    x: clamp(Math.round(visible.x - displayRect.x), 0, imageSize.width - 1),
    y: clamp(Math.round(visible.y - displayRect.y), 0, imageSize.height - 1),
    width: Math.round(visible.width),
    height: Math.round(visible.height)
  }
  cropRect.width = Math.min(cropRect.width, imageSize.width - cropRect.x)
  cropRect.height = Math.min(cropRect.height, imageSize.height - cropRect.y)
  const cropped = image.crop(cropRect)

  const croppedSize = cropped.getSize()
  const longest = Math.max(croppedSize.width, croppedSize.height)
  const scaled =
    longest > maxImageSide
      ? cropped.resize({
          width: Math.round((croppedSize.width * maxImageSide) / longest),
          height: Math.round((croppedSize.height * maxImageSide) / longest),
          quality: 'good'
        })
      : cropped
  const scaledSize = scaled.getSize()
  const thumbnail = cropped.resize({ width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT, quality: 'good' }).toBitmap()

  return {
    frame: {
      imageBase64: scaled.toJPEG(JPEG_QUALITY).toString('base64'),
      mime: 'image/jpeg',
      width: scaledSize.width,
      height: scaledSize.height,
      screenRect: { x: visible.x, y: visible.y, width: visible.width, height: visible.height },
      takenAt: Date.now()
    },
    thumbnail: new Uint8Array(thumbnail)
  }
}
