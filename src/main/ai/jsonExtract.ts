// 从模型回复文本中提取 JSON：容忍代码块围栏、前后说明文字、漏逗号、多余逗号与括号配对错误等常见瑕疵。

function stripFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) return fenced[1]
  // 只有开头围栏没有结尾围栏时也去掉开头
  return text.replace(/^\s*```(?:json)?\s*/i, '')
}

// 从第一个 { 或 [ 起按括号配对截出完整片段，字符串内的括号不计
function sliceBalanced(text: string): string | null {
  const start = text.search(/[{[]/)
  if (start < 0) return null
  const open = text[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

const VALUE_START = /["{[\d\-tfn]/
const VALUE_END = /["}\]\del]/

function dropTrailingComma(out: string): string {
  return out.replace(/,(\s*)$/, '$1')
}

// 修复三类常见瑕疵：两个值之间漏了逗号、闭合符前多了逗号、闭合符与括号栈不配对
// （漏写内层的 ] 或 }，或多写了闭合符）；不处理被截断的 JSON
export function repairJson(source: string): string {
  let out = ''
  let inString = false
  let escaped = false
  let previous = ''
  let spaced = false
  const stack: string[] = []
  for (const ch of source) {
    if (inString) {
      out += ch
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') {
        inString = false
        previous = '"'
        spaced = false
      }
      continue
    }
    if (/\s/.test(ch)) {
      out += ch
      spaced = true
      continue
    }
    if (ch === '}' || ch === ']') {
      const want = ch === '}' ? '{' : '['
      // 多余的闭合符：栈里没有对应的开括号，直接丢弃
      if (!stack.includes(want)) continue
      out = dropTrailingComma(out)
      // 漏写了内层的闭合符：先把内层依次补上
      while (stack[stack.length - 1] !== want) {
        out = dropTrailingComma(out) + (stack.pop() === '{' ? '}' : ']')
      }
      stack.pop()
      out += ch
      previous = ch
      spaced = false
      continue
    }
    if (spaced && VALUE_END.test(previous) && VALUE_START.test(ch)) out += ','
    out += ch
    if (ch === '"') inString = true
    else if (ch === '{' || ch === '[') stack.push(ch)
    previous = ch
    spaced = false
  }
  return out
}

// 模型输出无法解析时附在错误信息里的开头片段，便于定位是思考内容、说明文字还是被截断
export function describeOutput(text: string, limit = 160): string {
  const head = text.replace(/\s+/g, ' ').trim().slice(0, limit)
  return head ? `；模型输出开头：${head}` : '；模型输出为空'
}

// 解析失败时取出出错位置附近的原文，便于判断是哪一处不合法
function snippetAround(candidate: string, message: string, radius = 50): string {
  const match = message.match(/position (\d+)/)
  if (!match) return ''
  const at = Number(match[1])
  const part = candidate.slice(Math.max(0, at - radius), at + radius).replace(/\s+/g, ' ')
  return `；出错位置附近：${part}`
}

export function extractJson(text: string): unknown {
  const candidate = sliceBalanced(stripFence(text))
  if (candidate === null) throw new Error('模型回复中没有找到 JSON')
  try {
    return JSON.parse(candidate)
  } catch (error) {
    try {
      return JSON.parse(repairJson(candidate))
    } catch {
      const message = (error as Error).message
      throw new Error(`模型回复中的 JSON 无法解析: ${message}${snippetAround(candidate, message)}`)
    }
  }
}
