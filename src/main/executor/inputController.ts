// 输入控制器：在输入后端之上组合点击、剪贴板粘贴与发送键序列，并在每一步响应取消信号。
import type { Point } from '../../shared/types'
import type { Settings } from '../../shared/settings'
import type { InputBackend } from './inputBackend'
import { AbortedError } from '../abort'
import { randomInt } from './humanize'

export interface ClipboardPort {
  readText(): string
  writeText(text: string): void
  writeImageFromPath(path: string): void
}

export type SendKeysMode = Settings['input']['sendKeys']

export class InputController {
  constructor(
    private readonly backend: InputBackend,
    private readonly clipboard: ClipboardPort,
    private readonly humanize: () => boolean
  ) {}

  private check(signal?: AbortSignal): void {
    if (signal?.aborted) throw new AbortedError()
  }

  async pause(minMs: number, maxMs: number, signal?: AbortSignal): Promise<void> {
    this.check(signal)
    const ms = this.humanize() ? randomInt(minMs, maxMs) : Math.min(minMs, 30)
    await new Promise<void>((resolve, reject) => {
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
    this.check(signal)
  }

  async clickAt(point: Point, signal?: AbortSignal): Promise<void> {
    this.check(signal)
    await this.backend.moveTo(point, this.humanize())
    await this.pause(80, 200, signal)
    await this.backend.click('left')
    await this.pause(50, 150, signal)
  }

  // 把文本写入剪贴板并粘贴，结束后恢复原剪贴板内容
  async paste(text: string, signal?: AbortSignal): Promise<void> {
    this.check(signal)
    const previous = this.clipboard.readText()
    try {
      this.clipboard.writeText(text)
      await this.pause(200, 300, signal)
      await this.backend.keyTap('v', ['control'])
      await this.pause(300, 500, signal)
    } finally {
      this.clipboard.writeText(previous)
    }
  }

  // 把图片文件写入剪贴板并粘贴，结束后恢复原文本内容
  async pasteImage(path: string, signal?: AbortSignal): Promise<void> {
    this.check(signal)
    const previous = this.clipboard.readText()
    try {
      this.clipboard.writeImageFromPath(path)
      await this.pause(300, 450, signal)
      await this.backend.keyTap('v', ['control'])
      await this.pause(900, 1400, signal)
    } finally {
      this.clipboard.writeText(previous)
    }
  }

  async sendKeys(mode: SendKeysMode, signal?: AbortSignal): Promise<void> {
    this.check(signal)
    if (mode === 'enter') {
      await this.backend.keyTap('enter')
    } else if (mode === 'ctrl-enter') {
      await this.backend.keyTap('enter', ['control'])
    } else {
      await this.backend.keyTap('enter')
      await this.pause(100, 140, signal)
      await this.backend.keyTap('enter', ['control'])
      await this.pause(50, 90, signal)
      await this.backend.keyTap('backspace')
    }
  }

  async hotkey(key: string, modifiers: string[], signal?: AbortSignal): Promise<void> {
    this.check(signal)
    await this.backend.keyTap(key, modifiers)
  }

  async selectAll(signal?: AbortSignal): Promise<void> {
    await this.hotkey('a', ['control'], signal)
  }

  async clearInput(signal?: AbortSignal): Promise<void> {
    await this.selectAll(signal)
    await this.pause(60, 120, signal)
    await this.backend.keyTap('backspace')
  }
}
