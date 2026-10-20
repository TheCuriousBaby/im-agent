// 订阅主进程推送的引擎状态、日志、用量、目标窗口与设置，并解析当前窗口的路由。
import { useEffect, useState } from 'react'
import { EVENTS } from '../../shared/ipc'
import type { PublicSettings } from '../../shared/settings'
import type { EngineEvent, EngineStatus, TargetWindow, UsageSummary } from '../../shared/types'

export function useEngineStatus(): EngineStatus | null {
  const [status, setStatus] = useState<EngineStatus | null>(null)
  useEffect(() => {
    void window.imAgent.engine.status().then(setStatus)
    return window.imAgent.on(EVENTS.engineStatus, setStatus)
  }, [])
  return status
}

export function useUsage(): UsageSummary | null {
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  useEffect(() => {
    void window.imAgent.usage.get().then(setUsage)
    return window.imAgent.on(EVENTS.usage, setUsage)
  }, [])
  return usage
}

// 先取主进程缓存的最近日志，再追加新推送的事件
export function useEngineEvents(limit = 300): EngineEvent[] {
  const [events, setEvents] = useState<EngineEvent[]>([])
  useEffect(() => {
    let cancelled = false
    const off = window.imAgent.on(EVENTS.engineEvent, (event) => {
      setEvents((prev) => [...prev.slice(-(limit - 1)), event])
    })
    void window.imAgent.logs.recent().then((history) => {
      if (cancelled) return
      setEvents((prev) => [...history, ...prev.filter((p) => !history.some((h) => h.ts === p.ts && h.message === p.message))].slice(-limit))
    })
    return () => {
      cancelled = true
      off()
    }
  }, [limit])
  return events
}

export function useTarget(): TargetWindow | null {
  const [target, setTarget] = useState<TargetWindow | null>(null)
  useEffect(() => {
    void window.imAgent.target.get().then(setTarget)
    return window.imAgent.on(EVENTS.target, setTarget)
  }, [])
  return target
}

export function usePublicSettings(): PublicSettings | null {
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  useEffect(() => {
    void window.imAgent.settings.get().then(setSettings)
    return window.imAgent.on(EVENTS.settings, setSettings)
  }, [])
  return settings
}

export interface Route {
  name: 'main' | 'settings' | 'picker'
  query: URLSearchParams
}

// 路由形如 #/settings?section=log，空表示主面板
export function parseRoute(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?')
  const name = path === 'settings' || path === 'picker' ? path : 'main'
  return { name, query: new URLSearchParams(query) }
}

export function cleanError(error: unknown): string {
  return (error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
