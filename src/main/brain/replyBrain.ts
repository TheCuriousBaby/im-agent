// 回复决策：结合联系人画像与最近对话，用设置里的回复模型决定回复内容或跳过。
import { z } from 'zod'
import { activeAgent, type Settings } from '../../shared/settings'
import type { ContactProfile, ObservedMessage } from '../../shared/types'
import type { ModelClient } from '../ai/modelClient'
import { describeOutput, extractJson } from '../ai/jsonExtract'
import { renderProfileForPrompt } from '../profile/profileStore'

export interface ReplyInput {
  contact: string
  isGroup: boolean
  messages: ObservedMessage[]
  profile: ContactProfile | null
}

export interface ReplyDecision {
  action: 'reply' | 'skip'
  text: string
  reason: string
}

const DecisionSchema = z.object({
  action: z.enum(['reply', 'skip']),
  text: z.string().catch(''),
  reason: z.string().catch('')
})

const FORMAT_INSTRUCTION = [
  '只输出一个 JSON 对象，格式：{"action": "reply" 或 "skip", "text": 回复内容, "reason": 简短理由}。',
  'action 为 skip 时 text 留空。回复内容是可以直接发送的纯文本，不要带称呼前缀或引号。'
].join('\n')

export function formatConversation(messages: ObservedMessage[], limit: number): string {
  return messages
    .filter((m) => m.role !== 'system' && m.text.trim())
    .slice(-limit)
    .map((m) => `${m.role === 'self' ? '[我]' : '[对方]'} ${m.text.trim()}`)
    .join('\n')
}

export function buildReplyUserPrompt(input: ReplyInput, settings: Settings): string {
  const parts: string[] = []
  if (settings.profileMemory.enabled && input.profile) {
    parts.push('联系人画像：', renderProfileForPrompt(input.profile, settings.profileMemory.injectMaxChars), '')
  }
  parts.push(
    `当前会话：${input.contact}（${input.isGroup ? '群聊' : '单聊'}）`,
    '最近对话（从旧到新）：',
    formatConversation(input.messages, settings.engine.contextMessages),
    '',
    FORMAT_INSTRUCTION
  )
  return parts.join('\n')
}

export class ReplyBrain {
  constructor(
    private readonly client: ModelClient,
    private readonly settings: () => Settings
  ) {}

  async decide(input: ReplyInput, signal?: AbortSignal): Promise<ReplyDecision> {
    const settings = this.settings()
    const result = await this.client.ask({
      role: 'reply',
      system: activeAgent(settings).prompt,
      user: buildReplyUserPrompt(input, settings),
      signal
    })
    let decision: z.infer<typeof DecisionSchema>
    try {
      decision = DecisionSchema.parse(extractJson(result.text))
    } catch (error) {
      throw new Error(`${(error as Error).message}${describeOutput(result.text)}`)
    }
    const text = decision.text.trim()
    if (decision.action === 'reply' && !text) return { action: 'skip', text: '', reason: '模型未给出回复内容' }
    return { action: decision.action, text: decision.action === 'reply' ? text : '', reason: decision.reason }
  }
}
