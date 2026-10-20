// 联系人画像存储：每个联系人一个 JSON 文件，全部保存在本机，并支持整体导出与导入。
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { ContactProfile } from '../../shared/types'
import { normalizeTitle } from '../engine/messageTracker'

const ProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  chatType: z.enum(['single', 'group']).catch('single'),
  tags: z.array(z.string()).catch([]),
  facts: z.array(z.string()).catch([]),
  preferences: z.array(z.string()).catch([]),
  summary: z.string().catch(''),
  firstSeen: z.number().catch(0),
  lastSeen: z.number().catch(0),
  messageCount: z.number().int().catch(0)
})

export const PROFILE_LIMITS = { tags: 12, facts: 30, preferences: 20, summaryChars: 400 } as const

export function profileId(name: string, chatType: 'single' | 'group'): string {
  return createHash('sha1').update(`${chatType}:${normalizeTitle(name)}`).digest('hex').slice(0, 16)
}

export function emptyProfile(name: string, chatType: 'single' | 'group', now: number): ContactProfile {
  return {
    id: profileId(name, chatType),
    name,
    chatType,
    tags: [],
    facts: [],
    preferences: [],
    summary: '',
    firstSeen: now,
    lastSeen: now,
    messageCount: 0
  }
}

function mergeUnique(existing: string[], incoming: string[], limit: number): string[] {
  const seen = new Set(existing.map((s) => s.trim()))
  const merged = [...existing]
  for (const item of incoming) {
    const text = item.trim()
    if (text && !seen.has(text)) {
      seen.add(text)
      merged.push(text)
    }
  }
  return merged.slice(-limit)
}

export interface ProfileUpdate {
  tags?: string[]
  facts?: string[]
  preferences?: string[]
  summary?: string
}

export function applyUpdate(profile: ContactProfile, update: ProfileUpdate): ContactProfile {
  return {
    ...profile,
    tags: mergeUnique(profile.tags, update.tags ?? [], PROFILE_LIMITS.tags),
    facts: mergeUnique(profile.facts, update.facts ?? [], PROFILE_LIMITS.facts),
    preferences: mergeUnique(profile.preferences, update.preferences ?? [], PROFILE_LIMITS.preferences),
    summary: update.summary ? update.summary.trim().slice(0, PROFILE_LIMITS.summaryChars) : profile.summary
  }
}

// 渲染成提示词片段，超出字数预算时按摘要、偏好、事实、标签的顺序依次缩减
export function renderProfileForPrompt(profile: ContactProfile, maxChars: number): string {
  const build = (p: { tags: string[]; facts: string[]; preferences: string[]; summary: string }): string => {
    const lines = [`联系人：${profile.name}（${profile.chatType === 'group' ? '群聊' : '单聊'}）`]
    if (p.tags.length) lines.push(`标签：${p.tags.join('、')}`)
    if (p.facts.length) lines.push(`已知信息：${p.facts.join('；')}`)
    if (p.preferences.length) lines.push(`沟通偏好：${p.preferences.join('；')}`)
    if (p.summary) lines.push(`往来摘要：${p.summary}`)
    return lines.join('\n')
  }
  const work = {
    tags: [...profile.tags],
    facts: [...profile.facts],
    preferences: [...profile.preferences],
    summary: profile.summary
  }
  let text = build(work)
  const order: Array<'summary' | 'preferences' | 'facts' | 'tags'> = ['summary', 'preferences', 'facts', 'tags']
  while (text.length > maxChars) {
    const target = order.find((k) => (k === 'summary' ? work.summary.length > 0 : work[k].length > 0))
    if (!target) break
    if (target === 'summary') work.summary = work.summary.slice(0, Math.max(0, Math.floor(work.summary.length / 2)))
    else work[target].shift()
    text = build(work)
  }
  return text.length > maxChars ? text.slice(0, maxChars) : text
}

export class ProfileStore {
  private readonly profiles = new Map<string, ContactProfile>()

  constructor(private readonly dir: string) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.loadAll()
  }

  private loadAll(): void {
    for (const file of readdirSync(this.dir)) {
      if (!file.endsWith('.json')) continue
      try {
        const parsed = ProfileSchema.parse(JSON.parse(readFileSync(join(this.dir, file), 'utf8')))
        this.profiles.set(parsed.id, parsed)
      } catch {
        // 损坏的画像文件跳过，不影响其他联系人
      }
    }
  }

  private write(profile: ContactProfile): void {
    const file = join(this.dir, `${profile.id}.json`)
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(profile, null, 2), 'utf8')
    renameSync(tmp, file)
  }

  list(): ContactProfile[] {
    return [...this.profiles.values()].sort((a, b) => b.lastSeen - a.lastSeen)
  }

  get(id: string): ContactProfile | null {
    return this.profiles.get(id) ?? null
  }

  find(name: string, chatType: 'single' | 'group'): ContactProfile | null {
    return this.get(profileId(name, chatType))
  }

  upsert(profile: ContactProfile): ContactProfile {
    const clean = ProfileSchema.parse(profile)
    this.profiles.set(clean.id, clean)
    this.write(clean)
    return clean
  }

  // 记录与某联系人的新消息数并刷新最近互动时间，没有画像时自动创建
  touch(name: string, chatType: 'single' | 'group', newMessages: number, now: number): ContactProfile {
    const base = this.find(name, chatType) ?? emptyProfile(name, chatType, now)
    return this.upsert({ ...base, lastSeen: now, messageCount: base.messageCount + newMessages })
  }

  delete(id: string): void {
    this.profiles.delete(id)
    rmSync(join(this.dir, `${id}.json`), { force: true })
  }

  exportAll(): string {
    return JSON.stringify({ version: 1, profiles: this.list() }, null, 2)
  }

  // 导入 exportAll 生成的 JSON，返回成功导入的条数
  importAll(json: string): number {
    const data = z.object({ profiles: z.array(z.unknown()) }).parse(JSON.parse(json))
    let count = 0
    for (const item of data.profiles) {
      const parsed = ProfileSchema.safeParse(item)
      if (parsed.success) {
        this.upsert(parsed.data)
        count++
      }
    }
    return count
  }
}
