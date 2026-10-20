// 设置窗口：左侧三个分组页签加对应的菜单，右侧是内容；顶部自绘标题栏与窗口控制按钮。
import { useEffect, useState } from 'react'
import { EVENTS } from '../../../shared/ipc'
import type { SettingsSection } from '../../../shared/types'
import { ProfilesPage } from '../pages/ProfilesPage'
import { TasksPage } from '../pages/TasksPage'
import {
  IconBot,
  IconChart,
  IconClock,
  IconClose,
  IconCpu,
  IconGlobe,
  IconInfo,
  IconList,
  IconMinus,
  IconPlug,
  IconSliders,
  IconSquare,
  IconUsers
} from '../icons'
import { AgentsSection } from '../settings/AgentsSection'
import { SettingsProvider } from '../settings/SettingsContext'
import {
  AboutSection,
  ApiSection,
  EngineSection,
  LogSection,
  ModelsSection,
  RemoteSection,
  UsageSection
} from '../settings/sections'
import type { Route } from '../hooks'

interface MenuItem {
  key: SettingsSection
  label: string
  icon: React.JSX.Element
}

interface Group {
  key: 'chat' | 'agent' | 'func'
  label: string
  items: MenuItem[]
}

const GROUPS: Group[] = [
  {
    key: 'chat',
    label: '对话',
    items: [
      { key: 'log', label: '运行日志', icon: <IconList size={18} /> },
      { key: 'usage', label: '模型用量', icon: <IconChart size={18} /> }
    ]
  },
  {
    key: 'agent',
    label: '智能体',
    items: [
      { key: 'agents', label: '智能体', icon: <IconBot size={18} /> },
      { key: 'tasks', label: '特定任务', icon: <IconClock size={18} /> },
      { key: 'profiles', label: '联系人画像', icon: <IconUsers size={18} /> }
    ]
  },
  {
    key: 'func',
    label: '功能',
    items: [
      { key: 'models', label: '模型', icon: <IconCpu size={18} /> },
      { key: 'engine', label: '引擎与输入', icon: <IconSliders size={18} /> },
      { key: 'api', label: '本机 API', icon: <IconPlug size={18} /> },
      { key: 'remote', label: '远程任务源', icon: <IconGlobe size={18} /> }
    ]
  }
]

const ABOUT: MenuItem = { key: 'about', label: '关于', icon: <IconInfo size={18} /> }

function groupOf(section: SettingsSection): Group['key'] {
  return GROUPS.find((g) => g.items.some((i) => i.key === section))?.key ?? 'chat'
}

function titleOf(section: SettingsSection): string {
  return [...GROUPS.flatMap((g) => g.items), ABOUT].find((i) => i.key === section)?.label ?? ''
}

const KNOWN = new Set<string>([...GROUPS.flatMap((g) => g.items.map((i) => i.key)), ABOUT.key])

function renderSection(section: SettingsSection): React.JSX.Element {
  switch (section) {
    case 'log':
      return <LogSection />
    case 'usage':
      return <UsageSection />
    case 'agents':
      return <AgentsSection />
    case 'tasks':
      return <TasksPage />
    case 'profiles':
      return <ProfilesPage />
    case 'models':
      return <ModelsSection />
    case 'engine':
      return <EngineSection />
    case 'api':
      return <ApiSection />
    case 'remote':
      return <RemoteSection />
    case 'about':
      return <AboutSection />
  }
}

export function SettingsWindow(props: { route: Route }): React.JSX.Element {
  const initial = props.route.query.get('section') ?? ''
  const [section, setSection] = useState<SettingsSection>(KNOWN.has(initial) ? (initial as SettingsSection) : 'agents')
  const [group, setGroup] = useState<Group['key']>(groupOf(section))

  useEffect(() => {
    return window.imAgent.on(EVENTS.navigate, (target) => {
      setSection(target)
      setGroup(groupOf(target))
    })
  }, [])

  const select = (next: SettingsSection): void => {
    setSection(next)
    setGroup(groupOf(next))
  }

  const current = GROUPS.find((g) => g.key === group) ?? GROUPS[0]

  return (
    <SettingsProvider>
      <div className="settings-window">
        <aside className="side">
          <div className="segment">
            {GROUPS.map((g) => (
              <button
                key={g.key}
                className={g.key === group ? 'segment-item active' : 'segment-item'}
                onClick={() => {
                  setGroup(g.key)
                  if (!g.items.some((i) => i.key === section)) setSection(g.items[0].key)
                }}
              >
                {g.label}
              </button>
            ))}
          </div>
          <nav className="menu">
            {current.items.map((item) => (
              <button
                key={item.key}
                className={item.key === section ? 'menu-row active' : 'menu-row'}
                onClick={() => select(item.key)}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="side-foot">
            <button className={section === 'about' ? 'menu-row active' : 'menu-row'} onClick={() => select('about')}>
              {ABOUT.icon}
              <span>{ABOUT.label}</span>
            </button>
          </div>
        </aside>

        <section className="main">
          <header className="titlebar">
            <h1>{titleOf(section)}</h1>
            <div className="window-controls">
              <button onClick={() => void window.imAgent.app.windowControl('minimize')}>
                <IconMinus size={18} />
              </button>
              <button onClick={() => void window.imAgent.app.windowControl('maximize')}>
                <IconSquare size={16} />
              </button>
              <button className="close" onClick={() => void window.imAgent.app.windowControl('close')}>
                <IconClose size={18} />
              </button>
            </div>
          </header>
          <div className="main-content">{renderSection(section)}</div>
        </section>
      </div>
    </SettingsProvider>
  )
}
