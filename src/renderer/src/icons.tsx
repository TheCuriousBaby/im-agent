// 图标集：统一 24×24 视口、圆角描边（实心图标除外），颜色跟随 currentColor。
import type { ReactNode } from 'react'

interface IconProps {
  size?: number
  className?: string
}

function Svg(props: IconProps & { children: ReactNode; fill?: boolean }): React.JSX.Element {
  const { size = 20, className, children, fill = false } = props
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      fill={fill ? 'currentColor' : 'none'}
      stroke={fill ? 'none' : 'currentColor'}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const IconGear = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <circle cx="12" cy="12" r="6.6" />
    <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.35 5.35l1.55 1.55M17.1 17.1l1.55 1.55M18.65 5.35 17.1 6.9M6.9 17.1l-1.55 1.55" />
  </Svg>
)

export const IconClipboard = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <rect x="5" y="4.5" width="14" height="16.5" rx="2.4" />
    <rect x="9" y="2.6" width="6" height="3.6" rx="1.2" />
    <path d="M8.6 11.2h6.8M8.6 15.2h4.6" />
  </Svg>
)

export const IconClose = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </Svg>
)

export const IconMinus = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M5.5 12h13" />
  </Svg>
)

export const IconSquare = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <rect x="5.5" y="5.5" width="13" height="13" rx="1.8" />
  </Svg>
)

export const IconPlay = (p: IconProps): React.JSX.Element => (
  <Svg {...p} fill>
    <path d="M8 5.2v13.6a.9.9 0 0 0 1.35.78l11-6.8a.9.9 0 0 0 0-1.56l-11-6.8A.9.9 0 0 0 8 5.2Z" />
  </Svg>
)

export const IconPause = (p: IconProps): React.JSX.Element => (
  <Svg {...p} fill>
    <rect x="6.5" y="5" width="4" height="14" rx="1.2" />
    <rect x="13.5" y="5" width="4" height="14" rx="1.2" />
  </Svg>
)

export const IconStop = (p: IconProps): React.JSX.Element => (
  <Svg {...p} fill>
    <rect x="6" y="6" width="12" height="12" rx="2.4" />
  </Svg>
)

export const IconBolt = (p: IconProps): React.JSX.Element => (
  <Svg {...p} fill>
    <path d="M13.4 2.4 5.1 13.2a.7.7 0 0 0 .55 1.13h4.9l-1 6.5a.5.5 0 0 0 .9.36l8.35-10.9a.7.7 0 0 0-.55-1.13h-4.85l.95-6.4a.5.5 0 0 0-.9-.36Z" />
  </Svg>
)

export const IconInfinity = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M7.2 8c-2.2 0-4 1.8-4 4s1.8 4 4 4c3.4 0 5.3-8 9.6-8 2.2 0 4 1.8 4 4s-1.8 4-4 4c-4.3 0-6.2-8-9.6-8Z" />
  </Svg>
)

export const IconMonitor = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="12.5" rx="2.4" />
    <path d="M8.5 20.5h7M12 16.5v4" />
  </Svg>
)

export const IconChevronUp = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M6.5 14.5 12 9l5.5 5.5" />
  </Svg>
)

export const IconChevronDown = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M6.5 9.5 12 15l5.5-5.5" />
  </Svg>
)

export const IconPlus = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)

export const IconBot = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <rect x="4" y="8" width="16" height="11.5" rx="3.4" />
    <path d="M12 8V5" />
    <circle cx="12" cy="4" r="1.2" />
    <circle cx="9" cy="13.5" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="13.5" r="1.1" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconClock = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 7.2V12l3.2 2" />
  </Svg>
)

export const IconList = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M9 6.5h11M9 12h11M9 17.5h11" />
    <circle cx="4.6" cy="6.5" r=".9" fill="currentColor" stroke="none" />
    <circle cx="4.6" cy="12" r=".9" fill="currentColor" stroke="none" />
    <circle cx="4.6" cy="17.5" r=".9" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconChart = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M5 20V11M12 20V4.5M19 20v-6.5M3 20.5h18" />
  </Svg>
)

export const IconUsers = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="9" cy="8.2" r="3.2" />
    <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    <path d="M16 5.3a3.2 3.2 0 0 1 0 5.8M18.2 14.5c1.7.9 2.8 2.7 2.8 5.5" />
  </Svg>
)

export const IconCpu = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2.4" />
    <rect x="9.6" y="9.6" width="4.8" height="4.8" rx="1" />
    <path d="M9 2.8v3.2M15 2.8v3.2M9 18v3.2M15 18v3.2M2.8 9h3.2M2.8 15h3.2M18 9h3.2M18 15h3.2" />
  </Svg>
)

export const IconSliders = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4 7h9.5M18.5 7H20M4 17h3.5M12.5 17H20" />
    <circle cx="16" cy="7" r="2.5" />
    <circle cx="10" cy="17" r="2.5" />
  </Svg>
)

export const IconPlug = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M9 3v4.5M15 3v4.5M6 7.5h12v3.2a6 6 0 0 1-12 0Z" />
    <path d="M12 16.7V21" />
  </Svg>
)

export const IconGlobe = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.8" />
    <path d="M3.4 12h17.2" />
    <path d="M12 3.2c3.2 3.1 3.2 14.5 0 17.6M12 3.2c-3.2 3.1-3.2 14.5 0 17.6" />
  </Svg>
)

export const IconInfo = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.8" />
    <path d="M12 11v5.5" />
    <circle cx="12" cy="7.8" r=".9" fill="currentColor" stroke="none" />
  </Svg>
)

// 应用标识：蓝紫渐变圆底，中间是带高光的对话气泡
export function Logo(props: { size?: number }): React.JSX.Element {
  const size = props.size ?? 28
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="logo-bg" x1="4" y1="3" x2="28" y2="29" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2b6df5" />
          <stop offset="1" stopColor="#7a3df0" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill="url(#logo-bg)" />
      <path
        d="M9.6 10.4h12.8a2.4 2.4 0 0 1 2.4 2.4v6.4a2.4 2.4 0 0 1-2.4 2.4h-5.2l-4.2 3.2v-3.2H9.6a2.4 2.4 0 0 1-2.4-2.4v-6.4a2.4 2.4 0 0 1 2.4-2.4Z"
        fill="#ffffff"
      />
      <circle cx="12.4" cy="16" r="1.3" fill="#3b5bf0" />
      <circle cx="16" cy="16" r="1.3" fill="#3b5bf0" />
      <circle cx="19.6" cy="16" r="1.3" fill="#3b5bf0" />
      <path d="M24.6 5.6l.7 1.7 1.7.7-1.7.7-.7 1.7-.7-1.7-1.7-.7 1.7-.7Z" fill="#ffe27a" />
    </svg>
  )
}
