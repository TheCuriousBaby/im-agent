// 远程任务源（预留）：通过 WebSocket 接收外部服务下发的任务并回传执行结果，默认关闭。
//
// 协议（JSON 文本帧）：
//   客户端连接后先发送 {"type":"auth","token":"..."}
//   服务端下发 {"type":"task","task":{"id":"...","target":{"name":"...","chatType":"single"},"actions":[{"type":"text","text":"..."}]}}
//   客户端回传 {"type":"report","report":{"taskId":"...","status":"succeeded","finishedAt":1730000000000}}
import { z } from 'zod'
import type { TaskReport } from '../../../shared/types'
import { logger } from '../../logger'
import { TaskInputSchema, toTaskMessage, type TaskSink, type TaskSource } from '../taskSource'

const ServerFrameSchema = z.object({ type: z.literal('task'), task: TaskInputSchema })

export interface WsTaskSourceConfig {
  url: string
  token: string
}

const RECONNECT_BASE_MS = 2000
const RECONNECT_MAX_MS = 60000

export class WsTaskSource implements TaskSource {
  readonly id = 'remote-ws'
  private socket: WebSocket | null = null
  private sink: TaskSink | null = null
  private stopped = true
  private retry = 0
  private reconnectTimer: NodeJS.Timeout | null = null

  constructor(private readonly config: () => WsTaskSourceConfig) {}

  start(sink: TaskSink): void {
    this.sink = sink
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.socket?.close()
    this.socket = null
  }

  report(report: TaskReport): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'report', report }))
    }
  }

  private connect(): void {
    const { url, token } = this.config()
    if (!/^wss?:\/\//i.test(url)) {
      logger.warn('远程任务源地址无效，需要以 ws:// 或 wss:// 开头')
      return
    }
    const socket = new WebSocket(url)
    this.socket = socket
    socket.addEventListener('open', () => {
      this.retry = 0
      socket.send(JSON.stringify({ type: 'auth', token }))
      logger.info('远程任务源已连接')
    })
    socket.addEventListener('message', (event) => this.onMessage(String(event.data)))
    socket.addEventListener('close', () => this.scheduleReconnect())
    socket.addEventListener('error', () => logger.warn('远程任务源连接出错'))
  }

  private onMessage(text: string): void {
    try {
      const frame = ServerFrameSchema.parse(JSON.parse(text))
      this.sink?.submit(toTaskMessage(frame.task, this.id))
    } catch (error) {
      logger.warn(`忽略无法识别的远程任务帧: ${(error as Error).message.slice(0, 120)}`)
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.retry)
    this.retry++
    this.reconnectTimer = setTimeout(() => this.connect(), delay)
  }
}
