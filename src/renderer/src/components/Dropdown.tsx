// 向上展开的下拉按钮：底部操作栏用，点击外部或选中后关闭。
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { IconChevronUp } from '../icons'

export interface DropdownOption<T extends string> {
  value: T
  label: string
  hint?: string
}

interface Props<T extends string> {
  icon: ReactNode
  tone: 'amber' | 'blue'
  value: T | 'custom'
  options: Array<DropdownOption<T>>
  customLabel?: string
  disabled?: boolean
  onChange: (value: T) => void
}

export function Dropdown<T extends string>(props: Props<T>): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const current = props.options.find((o) => o.value === props.value)
  const label = current?.label ?? props.customLabel ?? '自定义'

  return (
    <div className="dropdown" ref={rootRef}>
      <button className="pill dropdown-trigger" disabled={props.disabled} onClick={() => setOpen(!open)}>
        <span className={`badge ${props.tone}`}>{props.icon}</span>
        <span className="dropdown-label">{label}</span>
        <IconChevronUp size={16} className={open ? 'chevron open' : 'chevron'} />
      </button>
      {open && (
        <div className="dropdown-menu">
          {props.options.map((option) => (
            <button
              key={option.value}
              className={option.value === props.value ? 'menu-item active' : 'menu-item'}
              onClick={() => {
                props.onChange(option.value)
                setOpen(false)
              }}
            >
              <span>{option.label}</span>
              {option.hint && <span className="menu-hint">{option.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
