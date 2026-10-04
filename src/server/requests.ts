import { OptimizerError } from '../shared/contracts.js'

export class RequestRegistry {
  private readonly running = new Map<string, { sessionId: string; controller: AbortController }>()
  private readonly cancelledBeforeStart = new Map<string, number>()
  private disposed = false
  constructor(private readonly timeoutMs: number) {}

  async run<T>(requestId: string, sessionId: string, parentSignal: AbortSignal, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const cancellationKey = `${sessionId}\0${requestId}`
    this.pruneCancellations()
    if (this.disposed || this.cancelledBeforeStart.delete(cancellationKey)) throw new OptimizerError('cancelled', '已取消优化。')
    if (this.running.has(requestId)) throw new OptimizerError('duplicate-request', '该优化请求正在处理，请等待结果。')
    if (this.running.size >= 4) throw new OptimizerError('busy', '同时处理的优化请求过多，请稍后重试。')
    const controller = new AbortController()
    this.running.set(requestId, { sessionId, controller })
    const forwardAbort = () => controller.abort(parentSignal.reason ?? new OptimizerError('cancelled', '已取消优化。'))
    parentSignal.addEventListener('abort', forwardAbort, { once: true })
    if (parentSignal.aborted) forwardAbort()
    const timer = setTimeout(() => controller.abort(new OptimizerError('timeout', '优化超时，请稍后重试或切换 AI 来源。')), this.timeoutMs)
    try {
      controller.signal.throwIfAborted()
      const result = await operation(controller.signal)
      controller.signal.throwIfAborted()
      return result
    } finally {
      clearTimeout(timer)
      parentSignal.removeEventListener('abort', forwardAbort)
      this.running.delete(requestId)
    }
  }

  cancel(requestId: string, sessionId: string): boolean {
    const current = this.running.get(requestId)
    if (!current) {
      // A separate cancel HTTP request can arrive before the optimize body.
      this.pruneCancellations()
      if (this.cancelledBeforeStart.size >= 128) this.cancelledBeforeStart.delete(this.cancelledBeforeStart.keys().next().value!)
      this.cancelledBeforeStart.set(`${sessionId}\0${requestId}`, Date.now() + this.timeoutMs)
      return false
    }
    if (current.sessionId !== sessionId) return false
    current.controller.abort(new OptimizerError('cancelled', '已取消优化。'))
    return true
  }

  dispose(): void {
    this.disposed = true
    this.cancelledBeforeStart.clear()
    for (const request of this.running.values()) request.controller.abort(new OptimizerError('cancelled', '插件已卸载，优化已取消。'))
  }

  private pruneCancellations(): void {
    const now = Date.now()
    for (const [key, expires] of this.cancelledBeforeStart) if (expires <= now) this.cancelledBeforeStart.delete(key)
  }
}
