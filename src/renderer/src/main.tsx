// 渲染进程入口：按 URL 里的路由挂载主面板、设置窗口或选窗口浮层。
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { parseRoute } from './hooks'
import './styles.css'
import { MainPanel } from './windows/MainPanel'
import { PickerOverlay } from './windows/PickerOverlay'
import { SettingsWindow } from './windows/SettingsWindow'

const route = parseRoute(window.location.hash)
document.documentElement.dataset.view = route.name

function View(): React.JSX.Element {
  if (route.name === 'settings') return <SettingsWindow route={route} />
  if (route.name === 'picker') return <PickerOverlay />
  return <MainPanel />
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <View />
  </StrictMode>
)
