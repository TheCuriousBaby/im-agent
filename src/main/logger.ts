// 本地日志：写入 userData/logs/app.log 并向订阅者广播事件，不含任何网络上报。
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { EngineEvent } from '../shared/types'

type Listener = (event: EngineEvent) => void

const MAX_FILE_BYTES = 2 * 1024 * 1024
const RECENT_LIMIT = 300
const listeners = new Set<Listener>()
const recent: EngineEvent[] = []
let logFile: string | null = null

function resolveLogFile(): string {
  if (logFile) return logFile
  // 运行在 Electron 之外（如单元测试）时没有 app 对象，此时只广播不落盘
  const electron = require('electron') as typeof import('electron')
  const dir = join(electron.app.getPath('userData'), 'logs')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  logFile = join(dir, 'app.log')
  return logFile
}

function rotateIfNeeded(file: string): void {
  try {
    if (statSync(file).size > MAX_FILE_BYTES) renameSync(file, `${file}.1`)
  } catch {
    // 文件尚不存在时无需轮转
  }
}

export function recentLogs(): EngineEvent[] {
  return [...recent]
}

export function onLog(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function log(level: EngineEvent['level'], message: string): void {
  const event: EngineEvent = { ts: Date.now(), level, message }
  recent.push(event)
  if (recent.length > RECENT_LIMIT) recent.shift()
  try {
    const file = resolveLogFile()
    rotateIfNeeded(file)
    appendFileSync(file, `${new Date(event.ts).toISOString()} [${level}] ${message}\n`, 'utf8')
  } catch {
    // 日志写入失败不影响主流程
  }
  for (const listener of listeners) listener(event)
}

export const logger = {
  info: (message: string): void => log('info', message),
  warn: (message: string): void => log('warn', message),
  error: (message: string): void => log('error', message)
}
