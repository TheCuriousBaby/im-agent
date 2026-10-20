// 视觉识别：把窗口截图交给设置里配置的视觉模型，返回归一化坐标的版面与消息。
import { z } from 'zod'
import type { Frame, NormBox, Observation, SearchResultItem } from '../../shared/types'
import type { ModelClient } from '../ai/modelClient'
import { describeOutput, extractJson } from '../ai/jsonExtract'
import { clampNormBox, isValidNormBox } from '../capture/coords'
import { logger } from '../logger'

export interface ObserveOptions {
  signal?: AbortSignal
  // 刚在搜索框输入过内容，需要识别搜索结果列表
  expectSearchResults?: boolean
}

export interface VisionProvider {
  observe(frame: Frame, options?: ObserveOptions): Promise<Observation>
}

const SYSTEM_PROMPT = [
  '你是即时通讯软件的界面分析器。输入是一张聊天软件窗口的截图（微信、企业微信、飞书、WhatsApp 等）。',
  '只输出一个 JSON 对象，不要输出任何解释。坐标一律用相对截图宽高的 0~1000 归一化数值，',
  '框的格式为 [左, 上, 右, 下]，原点在截图左上角。找不到的区域填 null，列表找不到填 []。',
  '',
  'JSON 字段：',
  '{',
  '  "conversation_title": 当前打开的会话名称，看不出填空字符串,',
  '  "is_group": 当前会话是否群聊,',
  '  "search_bar": 搜索框的框,',
  '  "input_area": 消息输入框的框,',
  '  "chat_area": 消息列表区域的框,',
  '  "session_list": 左侧会话列表区域的框,',
  '  "unread_dots": 会话列表里每个带未读红点或未读数字的会话条目的框，数组,',
  '  "search_results": 搜索结果列表，每项 {"title": 名称, "box": 该条目的框}，没有在搜索则为空数组,',
  '  "messages": 消息列表里可见的消息，从上到下，每项 {"role": "self" 或 "peer" 或 "system", "text": 文字内容, "box": 该消息气泡的框}',
  '}',
  '',
  '判断 role 的依据：用户自己发的消息（self）通常是绿色或蓝色等彩色气泡，在微信、WhatsApp 里靠右，在飞书等软件里也可能和别人一样靠左；',
  '对方发的消息（peer）是白色或浅灰色气泡，旁边通常有对方的头像和昵称；居中的时间、撤回、系统提示是 system。',
  '先根据这个窗口里气泡的配色和排版规律判断，同一个窗口内保持一致。图片、表情、文件等非文字消息，text 写成 [图片]、[表情]、[文件] 这样的占位。',
  '不要编造截图中看不到的内容。'
].join('\n')

const boxSchema = z
  .unknown()
  .transform((value): NormBox | null => (isValidNormBox(value) ? clampNormBox(value) : null))

const RawSchema = z.object({
  conversation_title: z.string().catch(''),
  is_group: z.boolean().catch(false),
  search_bar: boxSchema.catch(null),
  input_area: boxSchema.catch(null),
  chat_area: boxSchema.catch(null),
  session_list: boxSchema.catch(null),
  unread_dots: z.array(boxSchema).catch([]),
  search_results: z
    .array(z.object({ title: z.string().catch(''), box: boxSchema.catch(null) }))
    .catch([]),
  messages: z
    .array(
      z.object({
        role: z.enum(['self', 'peer', 'system']).catch('system'),
        text: z.string().catch(''),
        box: boxSchema.catch(null)
      })
    )
    .catch([])
})

export function parseObservation(text: string): Observation {
  const raw = RawSchema.parse(extractJson(text))
  const searchResults: SearchResultItem[] = []
  for (const item of raw.search_results) {
    if (item.box) searchResults.push({ title: item.title, box: item.box })
  }
  return {
    conversationTitle: raw.conversation_title.trim(),
    isGroup: raw.is_group,
    searchBar: raw.search_bar,
    inputArea: raw.input_area,
    chatArea: raw.chat_area,
    sessionList: raw.session_list,
    unreadDots: raw.unread_dots.filter((b): b is NormBox => b !== null),
    searchResults,
    messages: raw.messages.filter((m) => m.text.trim().length > 0 || m.role !== 'system')
  }
}

const PARSE_ATTEMPTS = 2

export class VlmVision implements VisionProvider {
  constructor(private readonly client: ModelClient) {}

  async observe(frame: Frame, options: ObserveOptions = {}): Promise<Observation> {
    const user = options.expectSearchResults
      ? '请分析这张截图。当前正在使用搜索，请重点给出 search_results。'
      : '请分析这张截图。'
    let lastError: Error | null = null
    for (let attempt = 1; attempt <= PARSE_ATTEMPTS; attempt++) {
      const result = await this.client.ask({
        role: 'vision',
        system: SYSTEM_PROMPT,
        user,
        images: [{ base64: frame.imageBase64, mime: frame.mime }],
        signal: options.signal
      })
      try {
        return parseObservation(result.text)
      } catch (error) {
        // 格式错误多是随机的，同一张图再问一次通常就正常
        lastError = new Error(
          `${(error as Error).message}${describeOutput(result.text)}（finish=${result.finishReason || '未知'}）`
        )
        if (attempt < PARSE_ATTEMPTS) logger.warn(`识别结果格式不合法，重新请求一次：${lastError.message.slice(0, 200)}`)
      }
    }
    throw lastError ?? new Error('识别失败')
  }
}
