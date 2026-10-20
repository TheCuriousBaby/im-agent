// 会话名称匹配：忽略空白、大小写与群聊人数后缀，并从搜索结果中选出最匹配的一项。
import type { SearchResultItem } from '../../shared/types'
import { normalizeTitle } from './messageTracker'

export function titleMatches(actual: string, expected: string): boolean {
  const a = normalizeTitle(actual)
  const b = normalizeTitle(expected)
  if (!a || !b) return false
  return a === b || a.includes(b) || b.includes(a)
}

// 完全相同优先，其次互相包含
export function pickSearchResult(results: SearchResultItem[], name: string): SearchResultItem | null {
  const wanted = normalizeTitle(name)
  const exact = results.find((r) => normalizeTitle(r.title) === wanted)
  if (exact) return exact
  return results.find((r) => titleMatches(r.title, name)) ?? null
}
