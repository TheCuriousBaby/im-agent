// 硬件 HID 模组联调工具：向模组的虚拟串口发送文本指令并打印回复，不依赖 Electron。
// 用法：
//   node scripts/hid-probe.mjs [COM3] "P" "M 32768 32768"   依次发送给定指令
//   node scripts/hid-probe.mjs [COM3]                        进入交互模式，输入一行发送一行
// 串口号省略时按 1A86:FFFF 自动查找。注意：发送的指令会真实移动鼠标、按键，cyStudio 连接时串口会被占用。
import { createInterface } from 'node:readline'
import { SerialPort } from 'serialport'

const REPLY_WAIT_MS = 1500

const args = process.argv.slice(2)
const explicitPort = /^com\d+$/i.test(args[0] ?? '') ? args.shift() : null
const commands = args

async function findPort() {
  const ports = await SerialPort.list()
  return ports.find((p) => p.vendorId?.toUpperCase() === '1A86' && p.productId?.toUpperCase() === 'FFFF')?.path ?? null
}

const path = explicitPort ?? (await findPort())
if (!path) {
  console.error('没有找到模组的串口，请确认模组已插入，或把串口号作为第一个参数传入，例如 COM3')
  process.exit(1)
}

const port = new SerialPort({ path, baudRate: 115200, autoOpen: false })
await new Promise((resolve, reject) => port.open((error) => (error ? reject(error) : resolve())))
console.log(`已打开 ${path}`)

let buffer = ''
port.on('data', (chunk) => {
  buffer += chunk.toString('utf8')
  const lines = buffer.split(/\r?\n/)
  buffer = lines.pop() ?? ''
  for (const line of lines) if (line) console.log(`  <- ${line}`)
})
port.on('error', (error) => console.error(`串口错误：${error.message}`))

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function send(line) {
  console.log(`-> ${line}`)
  await new Promise((resolve, reject) => port.write(`${line}\n`, (e) => (e ? reject(e) : port.drain((d) => (d ? reject(d) : resolve())))))
  await sleep(REPLY_WAIT_MS)
}

if (commands.length > 0) {
  for (const command of commands) await send(command)
  port.close()
} else {
  console.log('输入指令并回车发送，空行或 Ctrl+C 退出，例如 P、M 32768 32768、K ctrl+a')
  const rl = createInterface({ input: process.stdin })
  for await (const line of rl) {
    if (line.trim() === '') break
    await send(line.trim())
  }
  port.close()
}
