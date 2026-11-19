// 设置的 schema、默认值与对渲染进程暴露的脱敏类型。
import { z } from 'zod'

export const DEFAULT_SYSTEM_PROMPT = [
  '你是用户的即时通讯助手，代替用户回复当前聊天窗口里对方的最新消息。',
  '要求：',
  '1. 只回复对方最新一条需要回应的消息，语气自然、简洁，使用对方所用的语言。',
  '2. 不编造事实；不确定时回复“我确认一下，稍后回复你”。',
  '3. 涉及金额、承诺、隐私、投诉时不要自行决定，返回 skip 交给用户处理。',
  '4. 不要透露自己是自动回复，除非对方明确询问。',
  '5. 群聊中只在消息明确与用户有关或在向用户提问时才回复，其余返回 skip。'
].join('\n')

export const AgentSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(60),
  description: z.string().max(500).default(''),
  prompt: z.string().min(1).max(8000),
  enabled: z.boolean().default(false),
  pinned: z.boolean().default(false)
})

export type Agent = z.infer<typeof AgentSchema>

export const DEFAULT_AGENT: Agent = {
  id: 'default',
  name: '默认智能体',
  description: '代替用户回复聊天窗口里对方的最新消息',
  prompt: DEFAULT_SYSTEM_PROMPT,
  enabled: true,
  pinned: false
}

function isJsonObject(text: string): boolean {
  if (text.trim() === '') return true
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  } catch {
    return false
  }
}

export const ModelConfigSchema = z.object({
  baseUrl: z.string().trim().default(''),
  apiKey: z.string().trim().default(''),
  model: z.string().trim().default(''),
  wire: z.enum(['responses', 'chat']).default('chat'),
  reasoningEffort: z.enum(['', 'low', 'medium', 'high']).default(''),
  timeoutMs: z.number().int().min(1000).max(300000).default(60000),
  maxImageSide: z.number().int().min(320).max(4096).default(1280),
  maxOutputTokens: z.number().int().min(64).max(64000).default(4096),
  extraBody: z.string().refine(isJsonObject, '额外请求参数必须是 JSON 对象').default(''),
  priceInPerM: z.number().min(0).default(0),
  priceOutPerM: z.number().min(0).default(0)
})

export const SettingsSchema = z.object({
  vision: ModelConfigSchema.prefault({}),
  reply: ModelConfigSchema.nullable().default(null),
  profile: ModelConfigSchema.nullable().default(null),
  input: z
    .object({
      humanize: z.boolean().default(true),
      sendKeys: z.enum(['enter', 'ctrl-enter', 'compat']).default('enter')
    })
    .prefault({}),
  engine: z
    .object({
      replyMode: z.enum(['auto', 'confirm']).default('confirm'),
      pollIntervalMs: z.number().int().min(1000).max(60000).default(5000),
      afterReplyPollMs: z.number().int().min(500).max(60000).default(1500),
      changeRatio: z.number().min(0).max(0.5).default(0.003),
      idleRefreshMs: z.number().int().min(0).max(600000).default(45000),
      unreadSwitch: z.enum(['hotkey', 'click']).default('click'),
      contextMessages: z.number().int().min(1).max(100).default(20)
    })
    .prefault({}),
  agents: z.array(AgentSchema).default([DEFAULT_AGENT]),
  profileMemory: z
    .object({
      enabled: z.boolean().default(true),
      injectMaxChars: z.number().int().min(200).max(8000).default(1200),
      extractEveryNMessages: z.number().int().min(1).max(100).default(6)
    })
    .prefault({}),
  localApi: z
    .object({
      enabled: z.boolean().default(false),
      port: z.number().int().min(1024).max(65535).default(17680),
      token: z.string().default('')
    })
    .prefault({}),
  remote: z
    .object({
      enabled: z.boolean().default(false),
      wsUrl: z.string().default(''),
      token: z.string().default('')
    })
    .prefault({})
})

export type ModelConfig = z.infer<typeof ModelConfigSchema>
export type Settings = z.infer<typeof SettingsSchema>

// 当前生效的智能体：已启用的里置顶优先，没有启用的就用内置默认智能体
export function activeAgent(settings: Pick<Settings, 'agents'>): Agent {
  const enabled = settings.agents.filter((a) => a.enabled)
  return enabled.find((a) => a.pinned) ?? enabled[0] ?? DEFAULT_AGENT
}

export const SPEED_PRESETS = {
  fast: { label: '极速', pollIntervalMs: 2000, afterReplyPollMs: 1000 },
  standard: { label: '标准', pollIntervalMs: 5000, afterReplyPollMs: 1500 },
  saver: { label: '省电', pollIntervalMs: 10000, afterReplyPollMs: 3000 }
} as const

export type SpeedKey = keyof typeof SPEED_PRESETS

// 根据当前轮询间隔反推所属档位，不在任何档位上时为自定义
export function speedOf(engine: Pick<Settings['engine'], 'pollIntervalMs' | 'afterReplyPollMs'>): SpeedKey | 'custom' {
  const key = (Object.keys(SPEED_PRESETS) as SpeedKey[]).find(
    (k) =>
      SPEED_PRESETS[k].pollIntervalMs === engine.pollIntervalMs &&
      SPEED_PRESETS[k].afterReplyPollMs === engine.afterReplyPollMs
  )
  return key ?? 'custom'
}

type ModelSettings = Pick<Settings, 'vision' | 'reply' | 'profile'>

export function normalizeModelEndpoint(raw: string): string {
  return raw.trim().replace(/\/+$/, '')
}

// 回复沿用识别端点，画像沿用回复端点；密钥只在使用同一端点时沿用。
export function resolveModelConfig(settings: ModelSettings, role: keyof ModelSettings): ModelConfig {
  const { vision, reply, profile } = settings
  const inherit = (own: ModelConfig, parent: ModelConfig): ModelConfig => {
    const baseUrl = own.baseUrl || parent.baseUrl
    const endpoint = normalizeModelEndpoint(baseUrl)
    const sharesEndpoint = endpoint !== '' && endpoint === normalizeModelEndpoint(parent.baseUrl)
    return { ...own, baseUrl, apiKey: own.apiKey || (sharesEndpoint ? parent.apiKey : '') }
  }
  if (role === 'vision') return vision
  const resolvedReply = reply ? inherit(reply, vision) : vision
  if (role === 'reply') return resolvedReply
  return profile ? inherit(profile, resolvedReply) : resolvedReply
}

const MODEL_LABELS = { vision: '识别模型', reply: '回复模型', profile: '画像模型' } as const

// 按生效端点保留已保存的密钥；变更端点时校验各角色能否取得对应密钥。
export function bindModelKeys(draft: ModelSettings, previous: ModelSettings): ModelSettings {
  const next = { vision: draft.vision, reply: draft.reply, profile: draft.profile }
  for (const role of ['vision', 'reply', 'profile'] as const) {
    const own = draft[role]
    if (!own) continue

    const before = resolveModelConfig(previous, role)
    const endpoint = normalizeModelEndpoint(resolveModelConfig(next, role).baseUrl)
    const changed = endpoint !== normalizeModelEndpoint(before.baseUrl)
    const previousKey = previous[role]?.apiKey ?? ''
    const missingKey = (): Error => new Error(`${MODEL_LABELS[role]}：请填写当前端点对应的密钥`)
    if (endpoint && changed && previousKey && !own.apiKey) throw missingKey()

    next[role] = { ...own, apiKey: own.apiKey || (changed ? '' : previousKey) }
    if (endpoint && !resolveModelConfig(next, role).apiKey && (changed || before.apiKey || !previous[role])) {
      throw missingKey()
    }
  }
  return next
}

// 主面板上可直接调整的引擎项
export type QuickEnginePatch = Partial<Pick<Settings['engine'], 'replyMode' | 'pollIntervalMs' | 'afterReplyPollMs'>>

export type PublicModelConfig = Omit<ModelConfig, 'apiKey'> & { apiKeySet: boolean }

// 渲染进程看到的设置：模型密钥与远程令牌不回传，只给出是否已设置
export type PublicSettings = Omit<Settings, 'vision' | 'reply' | 'profile' | 'remote'> & {
  vision: PublicModelConfig
  reply: PublicModelConfig | null
  profile: PublicModelConfig | null
  remote: Omit<Settings['remote'], 'token'> & { tokenSet: boolean }
}

// 保存设置时的输入：模型密钥按端点保留，远程令牌留空保留原值。
export type SettingsInput = Settings

export function defaultSettings(): Settings {
  return SettingsSchema.parse({})
}

export function toPublicModel(m: ModelConfig): PublicModelConfig {
  const { apiKey, ...rest } = m
  return { ...rest, apiKeySet: apiKey.length > 0 }
}

export function toPublicSettings(s: Settings): PublicSettings {
  const { remote, ...rest } = s
  const { token, ...remoteRest } = remote
  return {
    ...rest,
    vision: toPublicModel(s.vision),
    reply: s.reply ? toPublicModel(s.reply) : null,
    profile: s.profile ? toPublicModel(s.profile) : null,
    remote: { ...remoteRest, tokenSet: token.length > 0 }
  }
}

// 把脱敏设置还原成保存输入，未提供的新密钥和令牌以空串表示。
export function publicToInput(p: PublicSettings): SettingsInput {
  const toModel = (m: PublicModelConfig): ModelConfig => {
    const { apiKeySet: _ignored, ...rest } = m
    return { ...rest, apiKey: '' }
  }
  const { remote, ...rest } = p
  const { tokenSet: _unused, ...remoteRest } = remote
  return {
    ...rest,
    vision: toModel(p.vision),
    reply: p.reply ? toModel(p.reply) : null,
    profile: p.profile ? toModel(p.profile) : null,
    remote: { ...remoteRest, token: '' }
  }
}
