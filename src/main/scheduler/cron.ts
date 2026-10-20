// 五段式 cron 表达式（分 时 日 月 周）的解析与下一次触发时间计算，按本地时区。

interface CronFields {
  minutes: Set<number>
  hours: Set<number>
  days: Set<number>
  months: Set<number>
  weekdays: Set<number>
  dayRestricted: boolean
  weekdayRestricted: boolean
}

function parseField(text: string, min: number, max: number): Set<number> {
  const result = new Set<number>()
  for (const part of text.split(',')) {
    const [rangeText, stepText] = part.split('/')
    const step = stepText === undefined ? 1 : Number(stepText)
    if (!Number.isInteger(step) || step < 1) throw new Error(`cron 步长无效: ${part}`)
    let lo: number
    let hi: number
    if (rangeText === '*') {
      lo = min
      hi = max
    } else if (rangeText.includes('-')) {
      const [a, b] = rangeText.split('-').map(Number)
      lo = a
      hi = b
    } else {
      lo = Number(rangeText)
      hi = stepText === undefined ? lo : max
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) {
      throw new Error(`cron 取值无效: ${part}`)
    }
    for (let v = lo; v <= hi; v += step) result.add(v)
  }
  return result
}

export function parseCron(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error('cron 需要五段：分 时 日 月 周')
  const [m, h, d, mo, w] = parts
  const weekdays = parseField(w, 0, 7)
  if (weekdays.has(7)) weekdays.add(0)
  return {
    minutes: parseField(m, 0, 59),
    hours: parseField(h, 0, 23),
    days: parseField(d, 1, 31),
    months: parseField(mo, 1, 12),
    weekdays,
    dayRestricted: d !== '*',
    weekdayRestricted: w !== '*'
  }
}

export function isValidCron(expr: string): boolean {
  try {
    parseCron(expr)
    return true
  } catch {
    return false
  }
}

function dayMatches(f: CronFields, date: Date): boolean {
  const dayOk = f.days.has(date.getDate())
  const weekOk = f.weekdays.has(date.getDay())
  if (f.dayRestricted && f.weekdayRestricted) return dayOk || weekOk
  if (f.dayRestricted) return dayOk
  if (f.weekdayRestricted) return weekOk
  return true
}

// 返回严格晚于 fromMs 的下一次触发时间戳，一年内没有则返回 null
export function nextCronRun(expr: string, fromMs: number): number | null {
  const f = parseCron(expr)
  const cursor = new Date(fromMs)
  cursor.setSeconds(0, 0)
  cursor.setMinutes(cursor.getMinutes() + 1)
  const limit = fromMs + 366 * 24 * 3600 * 1000

  while (cursor.getTime() <= limit) {
    if (!f.months.has(cursor.getMonth() + 1)) {
      cursor.setMonth(cursor.getMonth() + 1, 1)
      cursor.setHours(0, 0, 0, 0)
      continue
    }
    if (!dayMatches(f, cursor)) {
      cursor.setDate(cursor.getDate() + 1)
      cursor.setHours(0, 0, 0, 0)
      continue
    }
    if (!f.hours.has(cursor.getHours())) {
      cursor.setHours(cursor.getHours() + 1, 0, 0, 0)
      continue
    }
    if (!f.minutes.has(cursor.getMinutes())) {
      cursor.setMinutes(cursor.getMinutes() + 1, 0, 0)
      continue
    }
    return cursor.getTime()
  }
  return null
}
