// 设置存储：JSON 落盘，模型密钥与令牌经系统凭据加密，向渲染进程只提供脱敏视图。
import { app, safeStorage } from 'electron'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  activeAgent,
  resolveModelConfig,
  SettingsSchema,
  toPublicSettings,
  type QuickEnginePatch,
  type ModelConfig,
  type PublicSettings,
  type Settings,
  type SettingsInput
} from '../../shared/settings'
import type { ModelRole } from '../../shared/types'
import { logger } from '../logger'

const ENC_PREFIX = 'enc:'
const RAW_PREFIX = 'raw:'

function encodeSecret(plain: string): string {
  if (!plain) return ''
  if (safeStorage.isEncryptionAvailable()) {
    return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64')
  }
  logger.warn('系统凭据加密不可用，密钥将以明文保存')
  return RAW_PREFIX + plain
}

function decodeSecret(stored: string): string {
  if (!stored) return ''
  if (stored.startsWith(ENC_PREFIX)) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'))
    } catch {
      logger.error('密钥解密失败，需要重新填写')
      return ''
    }
  }
  if (stored.startsWith(RAW_PREFIX)) return stored.slice(RAW_PREFIX.length)
  return stored
}

function mapSecrets(settings: Settings, fn: (value: string) => string): Settings {
  const mapModel = (m: ModelConfig): ModelConfig => ({ ...m, apiKey: fn(m.apiKey) })
  return {
    ...settings,
    vision: mapModel(settings.vision),
    reply: settings.reply ? mapModel(settings.reply) : null,
    profile: settings.profile ? mapModel(settings.profile) : null,
    localApi: { ...settings.localApi, token: fn(settings.localApi.token) },
    remote: { ...settings.remote, token: fn(settings.remote.token) }
  }
}

type ChangeListener = (settings: Settings) => void

export class SettingsStore {
  private current: Settings
  private readonly listeners = new Set<ChangeListener>()

  constructor(private readonly file: string = join(app.getPath('userData'), 'settings.json')) {
    this.current = this.load()
  }

  private load(): Settings {
    let parsed: Settings
    try {
      const raw = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : {}
      parsed = SettingsSchema.parse(raw)
    } catch (error) {
      logger.warn(`设置文件无法解析，使用默认值: ${(error as Error).message}`)
      parsed = SettingsSchema.parse({})
    }
    const decoded = mapSecrets(parsed, decodeSecret)
    if (!decoded.localApi.token) {
      decoded.localApi.token = randomBytes(24).toString('hex')
      this.persist(decoded)
    }
    return decoded
  }

  private persist(settings: Settings): void {
    const dir = dirname(this.file)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(mapSecrets(settings, encodeSecret), null, 2), 'utf8')
    renameSync(tmp, this.file)
  }

  // 主进程内部使用，含明文密钥，不得发给渲染进程
  get(): Settings {
    return this.current
  }

  getPublic(): PublicSettings {
    return toPublicSettings(this.current)
  }

  // 指定角色的模型配置；reply 与 profile 未单独配置时沿用 vision
  resolveModel(role: ModelRole): ModelConfig {
    return resolveModelConfig(this.current, role)
  }

  save(input: SettingsInput): PublicSettings {
    const next = SettingsSchema.parse(input)
    const prev = this.current
    const keep = (incoming: string, previous: string | undefined): string =>
      incoming === '' ? (previous ?? '') : incoming
    next.vision.apiKey = keep(next.vision.apiKey, prev.vision.apiKey)
    if (next.reply) next.reply.apiKey = keep(next.reply.apiKey, prev.reply?.apiKey)
    if (next.profile) next.profile.apiKey = keep(next.profile.apiKey, prev.profile?.apiKey)
    next.remote.token = keep(next.remote.token, prev.remote.token)
    const chosen = activeAgent(next)
    next.agents = next.agents.map((a) => ({ ...a, enabled: next.agents.some((x) => x.enabled) ? a.id === chosen.id : false }))
    next.localApi.token = keep(next.localApi.token, prev.localApi.token) || randomBytes(24).toString('hex')

    this.persist(next)
    this.current = next
    for (const listener of this.listeners) listener(next)
    return toPublicSettings(next)
  }

  // 主面板上快速调整回复方式与速度档位，其余设置保持不变
  patchEngine(patch: QuickEnginePatch): PublicSettings {
    return this.save({ ...this.current, engine: { ...this.current.engine, ...patch } })
  }

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
