// profileStore 的单元测试：落盘、合并去重、字数预算与导入导出。
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  applyUpdate,
  emptyProfile,
  PROFILE_LIMITS,
  ProfileStore,
  profileId,
  renderProfileForPrompt
} from './profileStore'

function withStore(run: (store: ProfileStore, dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'im-agent-profiles-'))
  try {
    run(new ProfileStore(dir), dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('同名同类型得到相同 id，忽略群人数后缀', () => {
  assert.equal(profileId('项目群（8）', 'group'), profileId('项目群', 'group'))
  assert.notEqual(profileId('张三', 'single'), profileId('张三', 'group'))
})

test('touch 自动创建并累计消息数，重新打开后仍在', () => {
  withStore((store, dir) => {
    store.touch('张三', 'single', 2, 1000)
    store.touch('张三', 'single', 3, 2000)
    const found = store.find('张三', 'single')
    assert.equal(found?.messageCount, 5)
    assert.equal(found?.firstSeen, 1000)
    assert.equal(found?.lastSeen, 2000)
    assert.equal(new ProfileStore(dir).list().length, 1)
  })
})

test('合并去重并受数量上限约束', () => {
  const base = emptyProfile('张三', 'single', 0)
  const updated = applyUpdate(base, {
    tags: ['客户', '客户', ' VIP '],
    facts: Array.from({ length: 50 }, (_, i) => `事实${i}`)
  })
  assert.deepEqual(updated.tags, ['客户', 'VIP'])
  assert.equal(updated.facts.length, PROFILE_LIMITS.facts)
  assert.equal(updated.facts[updated.facts.length - 1], '事实49')
})

test('摘要超长时被截断，空摘要保持原值', () => {
  const base = { ...emptyProfile('张三', 'single', 0), summary: '旧摘要' }
  assert.equal(applyUpdate(base, { summary: 'x'.repeat(1000) }).summary.length, PROFILE_LIMITS.summaryChars)
  assert.equal(applyUpdate(base, { summary: '' }).summary, '旧摘要')
})

test('提示词片段不超过字数预算', () => {
  const profile = applyUpdate(emptyProfile('张三', 'single', 0), {
    tags: ['a', 'b'],
    facts: Array.from({ length: 20 }, (_, i) => `这是第 ${i} 条比较长的已知信息内容`),
    summary: '摘要'.repeat(100)
  })
  assert.ok(renderProfileForPrompt(profile, 200).length <= 200)
  assert.ok(renderProfileForPrompt(profile, 200).includes('张三'))
})

test('导出再导入可还原，损坏条目被跳过', () => {
  withStore((store) => {
    store.touch('张三', 'single', 1, 1)
    store.touch('项目群', 'group', 1, 2)
    const json = store.exportAll()
    store.delete(profileId('张三', 'single'))
    assert.equal(store.list().length, 1)
    const broken = JSON.stringify({ profiles: [...JSON.parse(json).profiles, { nonsense: true }] })
    assert.equal(store.importAll(broken), 2)
    assert.equal(store.list().length, 2)
  })
})
