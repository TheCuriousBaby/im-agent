// 选窗口浮层：全屏半透明遮罩，鼠标移动时高亮光标下最上层的窗口，点击选中，Esc 或右键取消。
import { useEffect, useRef, useState } from 'react'
import type { PickerWindow } from '../../../shared/types'
import { cleanError } from '../hooks'

export function PickerOverlay(): React.JSX.Element {
  const [windows, setWindows] = useState<PickerWindow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [hover, setHover] = useState<PickerWindow | null>(null)
  const [error, setError] = useState('')
  const selecting = useRef(false)

  useEffect(() => {
    void window.imAgent.picker.windows().then((list) => {
      setWindows(list)
      setLoaded(true)
    })
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') void window.imAgent.picker.cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const hit = (x: number, y: number): PickerWindow | null =>
    windows.find((w) => x >= w.rect.x && x < w.rect.x + w.rect.width && y >= w.rect.y && y < w.rect.y + w.rect.height) ??
    null

  const choose = async (target: PickerWindow): Promise<void> => {
    if (selecting.current) return
    selecting.current = true
    try {
      await window.imAgent.picker.select(target.hwnd)
    } catch (cause) {
      selecting.current = false
      setError(cleanError(cause))
      setTimeout(() => void window.imAgent.picker.cancel(), 1500)
    }
  }

  return (
    <div
      className="picker"
      onMouseMove={(e) => setHover(hit(e.clientX, e.clientY))}
      onClick={(e) => {
        const target = hit(e.clientX, e.clientY)
        if (target) void choose(target)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        void window.imAgent.picker.cancel()
      }}
    >
      {hover ? (
        <div
          className="picker-hit"
          style={{ left: hover.rect.x, top: hover.rect.y, width: hover.rect.width, height: hover.rect.height }}
        >
          <div className="picker-label">
            {hover.title}　{Math.round(hover.rect.width)}×{Math.round(hover.rect.height)}
          </div>
        </div>
      ) : (
        <div className="picker-dim" />
      )}
      <div className="picker-tip">
        {error
          ? `选择失败：${error}`
          : loaded && windows.length === 0
            ? '没有找到可选择的窗口，按 Esc 或右键退出'
            : '移动鼠标选择聊天窗口，点击确认，Esc 或右键取消'}
      </div>
    </div>
  )
}
