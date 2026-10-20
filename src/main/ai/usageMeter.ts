// 模型调用用量统计：按角色累计次数、token 与估算成本。
import type { ModelRole, UsageBucket, UsageSummary } from '../../shared/types'

function emptyBucket(): UsageBucket {
  return { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }
}

function addTo(bucket: UsageBucket, other: UsageBucket): void {
  bucket.calls += other.calls
  bucket.inputTokens += other.inputTokens
  bucket.outputTokens += other.outputTokens
  bucket.costUsd += other.costUsd
}

export class UsageMeter {
  private readonly byRole: Record<ModelRole, UsageBucket> = {
    vision: emptyBucket(),
    reply: emptyBucket(),
    profile: emptyBucket()
  }
  private readonly listeners = new Set<(summary: UsageSummary) => void>()

  record(role: ModelRole, inputTokens: number, outputTokens: number, priceInPerM: number, priceOutPerM: number): void {
    const costUsd = (inputTokens * priceInPerM + outputTokens * priceOutPerM) / 1_000_000
    addTo(this.byRole[role], { calls: 1, inputTokens, outputTokens, costUsd })
    const summary = this.summary()
    for (const listener of this.listeners) listener(summary)
  }

  summary(): UsageSummary {
    const total = emptyBucket()
    for (const bucket of Object.values(this.byRole)) addTo(total, bucket)
    return {
      total,
      byRole: {
        vision: { ...this.byRole.vision },
        reply: { ...this.byRole.reply },
        profile: { ...this.byRole.profile }
      }
    }
  }

  reset(): UsageSummary {
    for (const role of Object.keys(this.byRole) as ModelRole[]) this.byRole[role] = emptyBucket()
    const summary = this.summary()
    for (const listener of this.listeners) listener(summary)
    return summary
  }

  onChange(listener: (summary: UsageSummary) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
