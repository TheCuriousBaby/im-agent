// 输入执行子进程：在独立进程中调用 robotjs 完成鼠标键盘动作，崩溃不影响主进程。
import * as robot from '@hurdlegroup/robotjs'
import { bezierPath, randomInt } from './humanize'
import type { InputRequest, InputResponse } from './protocol'

const parentPort = process.parentPort

robot.setMouseDelay(0)
robot.setKeyboardDelay(0)

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function moveHuman(x: number, y: number): Promise<void> {
  const from = robot.getMousePos()
  for (const point of bezierPath(from, { x, y })) {
    robot.moveMouse(point.x, point.y)
    if (point.delayMs > 0) await sleep(point.delayMs)
  }
  robot.moveMouse(Math.round(x), Math.round(y))
}

async function clickOnce(button: 'left' | 'right' | 'middle'): Promise<void> {
  robot.mouseToggle('down', button)
  await sleep(randomInt(60, 140))
  robot.mouseToggle('up', button)
}

async function handle(request: InputRequest): Promise<unknown> {
  switch (request.op) {
    case 'ping':
      return 'pong'
    case 'moveTo':
      if (request.humanize) await moveHuman(request.x, request.y)
      else robot.moveMouse(Math.round(request.x), Math.round(request.y))
      return undefined
    case 'click':
      await clickOnce(request.button)
      if (request.double) {
        await sleep(randomInt(60, 110))
        await clickOnce(request.button)
      }
      return undefined
    case 'keyTap':
      robot.keyTap(request.key, request.modifiers)
      return undefined
    case 'typeString':
      robot.typeString(request.text)
      return undefined
    case 'scroll':
      robot.scrollMouse(0, request.dy)
      return undefined
    case 'mousePos':
      return robot.getMousePos()
  }
}

parentPort.on('message', (event) => {
  const request = event.data as InputRequest
  handle(request)
    .then((result): InputResponse => ({ id: request.id, ok: true, result }))
    .catch((error: unknown): InputResponse => ({ id: request.id, ok: false, error: (error as Error).message }))
    .then((response) => parentPort.postMessage(response))
})
