// 声明预加载脚本暴露在 window 上的 API 类型。
import type { ImAgentApi } from '../../shared/ipc'

declare global {
  interface Window {
    imAgent: ImAgentApi
  }
}

export {}
