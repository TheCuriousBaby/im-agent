// 模型客户端：按设置里的 OpenAI 兼容端点发起文本或图文调用，支持 responses 与 chat 两种协议。
import OpenAI from 'openai'
import type { ModelConfig } from '../../shared/settings'
import type { ModelRole } from '../../shared/types'
import { AbortedError } from '../abort'
import { logger } from '../logger'
import type { UsageMeter } from './usageMeter'

export interface AskImage {
  base64: string
  mime: 'image/jpeg' | 'image/png'
}

export interface AskOptions {
  role: ModelRole
  system: string
  user: string
  images?: AskImage[]
  // 覆盖设置里的最大输出 token，连通性测试用
  maxOutputTokens?: number
  signal?: AbortSignal
}

export interface AskResult {
  text: string
  inputTokens: number
  outputTokens: number
  latencyMs: number
  finishReason: string
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])
const MAX_ATTEMPTS = 3
const BACKOFF_BASE_MS = 800
const HEARTBEAT_MS = 15000

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new AbortedError())
      },
      { once: true }
    )
  })
}

function isRetryable(error: unknown): boolean {
  // 超时重试只会重复同样的等待，交给调用方处理
  if (error instanceof OpenAI.APIConnectionTimeoutError) return false
  if (error instanceof OpenAI.APIError) {
    return error.status === undefined || RETRYABLE_STATUS.has(error.status)
  }
  return error instanceof Error && /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|timed? ?out/i.test(error.message)
}

// 解析设置里的额外请求参数，合并进请求体；空串表示没有
export function parseExtraBody(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}
  const value: unknown = JSON.parse(raw)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('额外请求参数必须是 JSON 对象')
  return value as Record<string, unknown>
}

export function emptyOutputMessage(finishReason: string, outputTokens: number): string {
  return `模型返回内容为空（finish_reason=${finishReason || '未知'}，输出 ${outputTokens} token）。推理模型可能把输出上限用在了思考上，可调大“最大输出 token”，或在“额外请求参数”里关闭思考`
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  return trimmed
}

export function validateModelConfig(config: ModelConfig): string | null {
  if (!config.baseUrl.trim()) return '未填写模型端点地址'
  if (!config.apiKey.trim()) return '未填写模型密钥'
  if (!config.model.trim()) return '未填写模型名称'
  return null
}

export class ModelClient {
  constructor(
    private readonly resolve: (role: ModelRole) => ModelConfig,
    private readonly meter: UsageMeter
  ) {}

  async ask(options: AskOptions): Promise<AskResult> {
    const config = this.resolve(options.role)
    const problem = validateModelConfig(config)
    if (problem) throw new Error(problem)

    const client = new OpenAI({
      baseURL: normalizeBaseUrl(config.baseUrl),
      apiKey: config.apiKey,
      timeout: config.timeoutMs,
      maxRetries: 0
    })

    const imageKb = Math.round(((options.images ?? []).reduce((n, i) => n + i.base64.length, 0) * 0.75) / 1024)
    let lastError: unknown
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const startedAt = Date.now()
      logger.info(
        `模型调用开始（${options.role}，${config.model}${attempt > 1 ? `，第 ${attempt} 次` : ''}）：${imageKb ? `图片约 ${imageKb} KB，` : ''}超时 ${Math.round(config.timeoutMs / 1000)} 秒`
      )
      const heartbeat = setInterval(
        () => logger.info(`仍在等待模型响应（${options.role}），已 ${Math.round((Date.now() - startedAt) / 1000)} 秒`),
        HEARTBEAT_MS
      )
      try {
        const result =
          config.wire === 'responses'
            ? await this.askResponses(client, config, options)
            : await this.askChat(client, config, options)
        const latencyMs = Date.now() - startedAt
        this.meter.record(options.role, result.inputTokens, result.outputTokens, config.priceInPerM, config.priceOutPerM)
        logger.info(
          `模型调用完成（${options.role}，${config.model}）：${latencyMs} 毫秒，输入 ${result.inputTokens}，输出 ${result.outputTokens}，finish=${result.finishReason || '未知'}`
        )
        if (!result.text.trim()) throw new Error(emptyOutputMessage(result.finishReason, result.outputTokens))
        return { ...result, latencyMs }
      } catch (error) {
        if (options.signal?.aborted) throw new AbortedError()
        lastError = error
        if (error instanceof OpenAI.APIConnectionTimeoutError) {
          lastError = new Error(
            `模型响应超过 ${Math.round(config.timeoutMs / 1000)} 秒仍未返回。推理模型默认可能开启思考，可在设置里的“额外请求参数”关闭思考，或调大超时`
          )
        }
        const reason = lastError instanceof Error ? lastError.message : String(lastError)
        logger.warn(`模型调用失败（${options.role}，第 ${attempt} 次）：${reason.slice(0, 200)}`)
        if (attempt === MAX_ATTEMPTS || !isRetryable(error)) break
        await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1), options.signal)
      } finally {
        clearInterval(heartbeat)
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  private async askChat(
    client: OpenAI,
    config: ModelConfig,
    options: AskOptions
  ): Promise<Omit<AskResult, 'latencyMs'>> {
    const content: OpenAI.Chat.ChatCompletionContentPart[] = [{ type: 'text', text: options.user }]
    for (const image of options.images ?? []) {
      content.push({ type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.base64}` } })
    }
    const response = await client.chat.completions.create(
      {
        model: config.model,
        messages: [
          { role: 'system', content: options.system },
          { role: 'user', content }
        ],
        max_completion_tokens: options.maxOutputTokens ?? config.maxOutputTokens,
        ...(config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {}),
        ...parseExtraBody(config.extraBody)
      },
      { signal: options.signal }
    )
    return {
      text: response.choices[0]?.message?.content ?? '',
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      finishReason: response.choices[0]?.finish_reason ?? ''
    }
  }

  private async askResponses(
    client: OpenAI,
    config: ModelConfig,
    options: AskOptions
  ): Promise<Omit<AskResult, 'latencyMs'>> {
    const content: OpenAI.Responses.ResponseInputContent[] = [{ type: 'input_text', text: options.user }]
    for (const image of options.images ?? []) {
      content.push({
        type: 'input_image',
        image_url: `data:${image.mime};base64,${image.base64}`,
        detail: 'auto'
      })
    }
    const response = await client.responses.create(
      {
        model: config.model,
        instructions: options.system,
        input: [{ role: 'user', content }],
        max_output_tokens: options.maxOutputTokens ?? config.maxOutputTokens,
        ...(config.reasoningEffort ? { reasoning: { effort: config.reasoningEffort } } : {}),
        ...parseExtraBody(config.extraBody)
      },
      { signal: options.signal }
    )
    return {
      text: response.output_text ?? '',
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      finishReason: response.incomplete_details?.reason ?? response.status ?? ''
    }
  }
}
