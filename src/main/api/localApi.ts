// 本机控制 API：仅监听 127.0.0.1，需要 Bearer 令牌，拒绝带 Origin 的浏览器请求与异常 Host。
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import type { EngineStatus, TaskMessage } from '../../shared/types'
import { logger } from '../logger'
import { TaskInputSchema, toTaskMessage } from '../scheduler/taskSource'

export interface LocalApiConfig {
  enabled: boolean
  port: number
  token: string
}

export interface LocalApiEngine {
  status(): EngineStatus
  pause(): EngineStatus
  resume(): EngineStatus
  stop(): EngineStatus
}

const MAX_BODY_BYTES = 64 * 1024

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export class LocalApi {
  private server: Server | null = null

  constructor(
    private readonly engine: LocalApiEngine,
    private readonly submit: (task: TaskMessage) => void
  ) {}

  apply(config: LocalApiConfig): void {
    this.stop()
    if (!config.enabled) return
    const server = createServer((req, res) => {
      this.handle(req, res, config).catch((error: unknown) => {
        sendJson(res, 400, { error: (error as Error).message })
      })
    })
    server.on('error', (error) => logger.error(`本机 API 启动失败：${error.message}`))
    server.listen(config.port, '127.0.0.1', () => logger.info(`本机 API 已监听 127.0.0.1:${config.port}`))
    this.server = server
  }

  stop(): void {
    this.server?.close()
    this.server = null
  }

  private async handle(req: IncomingMessage, res: ServerResponse, config: LocalApiConfig): Promise<void> {
    if (req.headers.origin) return sendJson(res, 403, { error: '不接受浏览器跨域请求' })
    const host = (req.headers.host ?? '').toLowerCase()
    if (host !== `127.0.0.1:${config.port}` && host !== `localhost:${config.port}`) {
      return sendJson(res, 403, { error: 'Host 不合法' })
    }
    const auth = req.headers.authorization ?? ''
    if (!auth.startsWith('Bearer ') || !safeEqual(auth.slice(7), config.token)) {
      return sendJson(res, 401, { error: '令牌无效' })
    }

    const route = `${req.method} ${(req.url ?? '').split('?')[0]}`
    switch (route) {
      case 'GET /status':
        return sendJson(res, 200, this.engine.status())
      case 'POST /pause':
        return sendJson(res, 200, this.engine.pause())
      case 'POST /resume':
        return sendJson(res, 200, this.engine.resume())
      case 'POST /stop':
        return sendJson(res, 200, this.engine.stop())
      case 'POST /tasks': {
        const input = TaskInputSchema.parse(JSON.parse(await readBody(req)))
        const task = toTaskMessage(input, 'local-api')
        this.submit(task)
        return sendJson(res, 202, { id: task.id })
      }
      default:
        return sendJson(res, 404, { error: '未找到接口' })
    }
  }
}
