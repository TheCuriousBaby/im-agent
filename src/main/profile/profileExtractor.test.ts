// 验证画像抽取的批次边界与异步写回。
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { SettingsSchema } from '../../shared/settings'
import type { ObservedMessage } from '../../shared/types'
import type { AskResult, ModelClient } from '../ai/modelClient'
import { ProfileExtractor } from './profileExtractor'
import { ProfileStore } from './profileStore'

const contact = '张三'
const result: AskResult = {
  text: '{"facts":["已确认事实"]}',
  inputTokens: 0,
  outputTokens: 0,
  latencyMs: 0,
  finishReason: 'stop'
}

function messages(...texts: string[]): ObservedMessage[] {
  return texts.map((text) => ({ role: 'peer', text, box: null }))
}

function pendingExtraction(): { promise: Promise<AskResult>; resolve: (value: AskResult) => void } {
  let resolve!: (value: AskResult) => void
  const promise = new Promise<AskResult>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

async function withExtractor(
  ask: ModelClient['ask'],
  run: (extractor: ProfileExtractor, dir: string) => Promise<void>,
  now?: () => number
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'im-agent-profile-extractor-'))
  const settings = SettingsSchema.parse({ profileMemory: { extractEveryNMessages: 2 } })
  try {
    await run(new ProfileExtractor({ ask }, new ProfileStore(dir), () => settings, now), dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('再次抽取时只提交上一批开始后收到的新消息', async () => {
  const prompts: string[] = []
  const first = pendingExtraction()
  await withExtractor(
    async ({ user }) => {
      prompts.push(user)
      return prompts.length === 1 ? first.promise : result
    },
    async (extractor) => {
      extractor.ingest(contact, 'single', messages('首批甲', '首批乙'))
      extractor.ingest(contact, 'single', messages('次批甲', '次批乙'))
      assert.equal(prompts.length, 1)
      first.resolve(result)
      await setImmediate()

      assert.equal(prompts.length, 2)
      assert.match(prompts[0], /首批甲.*\n.*首批乙/)
      assert.match(prompts[1], /次批甲.*\n.*次批乙/)
      assert.doesNotMatch(prompts[1], /首批[甲乙]/)
    }
  )
})

test('抽取写回保留模型调用期间新增的计数和最近互动时间', async () => {
  let now = 100
  const extraction = pendingExtraction()
  await withExtractor(
    () => extraction.promise,
    async (extractor, dir) => {
      extractor.ingest(contact, 'single', messages('首批甲', '首批乙'))
      now = 200
      extractor.ingest(contact, 'single', messages('等待期间新增'))
      extraction.resolve(result)
      await setImmediate()

      const profile = new ProfileStore(dir).find(contact, 'single')
      assert.deepEqual(profile?.facts, ['已确认事实'])
      assert.equal(profile?.messageCount, 3)
      assert.equal(profile?.lastSeen, 200)
    },
    () => now
  )
})

test('抽取失败后保留该批消息，等新的消息达到阈值再抽取', async () => {
  const prompts: string[] = []
  await withExtractor(
    async ({ user }) => {
      prompts.push(user)
      if (prompts.length === 1) throw new Error('抽取失败')
      return result
    },
    async (extractor) => {
      extractor.ingest(contact, 'single', messages('待重试甲', '待重试乙'))
      await setImmediate()
      extractor.ingest(contact, 'single', messages('新增甲'))
      assert.equal(prompts.length, 1)
      extractor.ingest(contact, 'single', messages('新增乙'))
      await setImmediate()

      assert.equal(prompts.length, 2)
      assert.match(prompts[1], /待重试甲.*\n.*待重试乙.*\n.*新增甲.*\n.*新增乙/)
    }
  )
})
