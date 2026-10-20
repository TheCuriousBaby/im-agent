// 画像抽取：按累计消息数批量调用画像模型，把新信息合并进联系人画像，失败只记日志不影响主流程。
import { z } from 'zod'
import type { Settings } from '../../shared/settings'
import type { ObservedMessage } from '../../shared/types'
import type { ModelClient } from '../ai/modelClient'
import { extractJson } from '../ai/jsonExtract'
import { logger } from '../logger'
import { formatConversation } from '../brain/replyBrain'
import { applyUpdate, emptyProfile, PROFILE_LIMITS, renderProfileForPrompt, type ProfileStore } from './profileStore'

const UpdateSchema = z.object({
  tags: z.array(z.string()).catch([]),
  facts: z.array(z.string()).catch([]),
  preferences: z.array(z.string()).catch([]),
  summary: z.string().catch('')
})

const SYSTEM_PROMPT = [
  '你负责维护聊天联系人的本地画像。根据新增对话，补充联系人的标签、已知信息、沟通偏好，并更新往来摘要。',
  '只记录对话中明确出现的信息，不要推测；不要记录身份证号、银行卡号、密码、验证码等敏感信息。',
  `标签不超过 ${PROFILE_LIMITS.tags} 个，每条信息一句话。摘要不超过 ${PROFILE_LIMITS.summaryChars} 字，用来替换旧摘要。`,
  '只输出一个 JSON 对象：{"tags": [], "facts": [], "preferences": [], "summary": ""}。没有新信息的字段留空。'
].join('\n')

interface Buffer {
  chatType: 'single' | 'group'
  messages: ObservedMessage[]
  pending: number
}

export class ProfileExtractor {
  private readonly buffers = new Map<string, Buffer>()
  private running = false
  private readonly queue: string[] = []

  constructor(
    private readonly client: ModelClient,
    private readonly store: ProfileStore,
    private readonly settings: () => Settings,
    private readonly now: () => number = Date.now
  ) {}

  // 登记某会话的新消息，累计到阈值后排队抽取
  ingest(contact: string, chatType: 'single' | 'group', newMessages: ObservedMessage[]): void {
    const cfg = this.settings().profileMemory
    if (!cfg.enabled || !contact || newMessages.length === 0) return
    const usable = newMessages.filter((m) => m.role !== 'system' && m.text.trim())
    if (usable.length === 0) return

    this.store.touch(contact, chatType, usable.length, this.now())
    const buffer = this.buffers.get(contact) ?? { chatType, messages: [], pending: 0 }
    buffer.chatType = chatType
    buffer.messages = [...buffer.messages, ...usable].slice(-60)
    buffer.pending += usable.length
    this.buffers.set(contact, buffer)

    if (buffer.pending >= cfg.extractEveryNMessages && !this.queue.includes(contact)) {
      this.queue.push(contact)
      void this.drain()
    }
  }

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.queue.length > 0) {
        const contact = this.queue.shift() as string
        const buffer = this.buffers.get(contact)
        if (!buffer || buffer.pending === 0) continue
        const batch = buffer.messages
        buffer.pending = 0
        try {
          await this.extract(contact, buffer.chatType, batch)
        } catch (error) {
          logger.warn(`画像抽取失败（${contact}）: ${(error as Error).message}`)
        }
      }
    } finally {
      this.running = false
    }
  }

  private async extract(contact: string, chatType: 'single' | 'group', messages: ObservedMessage[]): Promise<void> {
    const settings = this.settings()
    const profile = this.store.find(contact, chatType) ?? emptyProfile(contact, chatType, this.now())
    const user = [
      '现有画像：',
      renderProfileForPrompt(profile, settings.profileMemory.injectMaxChars),
      '',
      '新增对话（从旧到新）：',
      formatConversation(messages, 40)
    ].join('\n')
    const result = await this.client.ask({ role: 'profile', system: SYSTEM_PROMPT, user })
    const update = UpdateSchema.parse(extractJson(result.text))
    this.store.upsert(applyUpdate(profile, update))
    logger.info(`已更新联系人画像：${contact}`)
  }
}
