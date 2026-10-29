// 串口链路：用 serialport 打开 HID 模组的虚拟串口（USB CDC），按行收发文本指令。
import { SerialPort } from 'serialport'
import type { HidLink } from './hidBackend'

// 模组自带的 USB 标识，串口路径留空时用它自动找到 COM 口
const MODULE_VENDOR_ID = '1A86'
const MODULE_PRODUCT_ID = 'FFFF'
const BAUD_RATE = 115200

export async function findModulePort(): Promise<string | null> {
  const ports = await SerialPort.list()
  const match = ports.find(
    (p) => p.vendorId?.toUpperCase() === MODULE_VENDOR_ID && p.productId?.toUpperCase() === MODULE_PRODUCT_ID
  )
  return match?.path ?? null
}

export async function openSerialLink(configuredPath: string): Promise<HidLink> {
  const path = configuredPath.trim() || (await findModulePort())
  if (!path) throw new Error('没有找到硬件 HID 模组的串口，请确认模组已插入，或在设置里手动填写串口号')

  const port = new SerialPort({ path, baudRate: BAUD_RATE, autoOpen: false })
  await new Promise<void>((resolve, reject) => {
    port.open((error) => {
      if (!error) return resolve()
      const hint = /access denied|busy|in use/i.test(error.message) ? '（串口可能被 cyStudio 或其他软件占用，请先断开连接）' : ''
      reject(new Error(`无法打开串口 ${path}：${error.message}${hint}`))
    })
  })

  const lineListeners: Array<(line: string) => void> = []
  const closeListeners: Array<(error?: Error) => void> = []
  let buffer = ''
  port.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line === '') continue
      for (const listener of lineListeners) listener(line)
    }
  })
  let closed = false
  const notifyClose = (error?: Error): void => {
    if (closed) return
    closed = true
    for (const listener of closeListeners) listener(error)
  }
  port.on('close', () => notifyClose())
  port.on('error', (error) => notifyClose(error))

  return {
    write: (line) =>
      new Promise<void>((resolve, reject) => {
        port.write(`${line}\n`, (error) => {
          if (error) return reject(error)
          port.drain((drainError) => (drainError ? reject(drainError) : resolve()))
        })
      }),
    onLine: (listener) => void lineListeners.push(listener),
    onClose: (listener) => void closeListeners.push(listener),
    close: () => {
      if (port.isOpen) port.close()
    }
  }
}
