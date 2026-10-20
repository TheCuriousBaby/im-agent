// 中断信号对应的错误类型：用户暂停、停止或取消时抛出，调用方据此区分正常中断与真正的失败。
export class AbortedError extends Error {
  constructor() {
    super('已中断')
    this.name = 'AbortedError'
  }
}

export function isAborted(error: unknown): boolean {
  return error instanceof AbortedError || (error instanceof Error && (error.message === '已中断' || error.message === '已取消'))
}
