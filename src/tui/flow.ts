import { randomUUID } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PromptOptimizerService } from '../server/index.js'
import { OptimizerError, type Backend, type ClarificationAnswer, type OptimizeAction, type OptimizeMode, type OptimizeResult, type OptimizerStatus } from '../shared/contracts.js'

export interface TuiOptimizerState {
  prompt: string
  instructions: string
  mode: OptimizeMode
  backend: Backend
  includeContext: boolean
  questions: string[]
  answers: string[]
  preview: string
  result?: OptimizeResult
  status?: OptimizerStatus
  busy: boolean
  phase: 'edit' | 'questions' | 'preview'
  error?: string
}

/** The terminal front door uses the same Host service as Web and Desktop. */
export class TuiOptimizerFlow {
  private state: TuiOptimizerState
  private readonly listeners = new Set<() => void>()
  private pending?: { id: string; controller: AbortController }
  private statusController?: AbortController
  private disposed = false
  private revision = 0
  private generatedRevision = -1

  constructor(
    private readonly service: PromptOptimizerService,
    readonly sessionId: string,
    initialPrompt = '',
    private readonly parent?: Agent,
  ) {
    this.state = {
      prompt: initialPrompt, instructions: '', mode: 'optimize', backend: 'harness',
      includeContext: false, questions: [], answers: [], preview: '', busy: false, phase: 'edit',
    }
  }

  getSnapshot = (): TuiOptimizerState => this.state
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private update(patch: Partial<TuiOptimizerState>): void {
    if (this.disposed) return
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  async refreshStatus(): Promise<void> {
    if (this.disposed) return
    this.statusController?.abort()
    const controller = new AbortController()
    this.statusController = controller
    const timer = setTimeout(() => controller.abort(new OptimizerError('timeout', 'AI 来源检查超时，请重新打开面板重试。')), 15000)
    let removeAbort = () => {}
    try {
      const aborted = new Promise<never>((_, reject) => {
        const listener = () => reject(controller.signal.reason)
        controller.signal.addEventListener('abort', listener, { once: true })
        removeAbort = () => controller.signal.removeEventListener('abort', listener)
      })
      const status = await Promise.race([this.service.status(this.sessionId, controller.signal, { routeSource: 'agent-options', ...this.parent ? { parent: this.parent } : {} }), aborted])
      if (!controller.signal.aborted && !this.disposed) {
        const selectCodex = this.state.phase === 'edit' && !this.state.busy && !status.harness.available && status.codex.available
        this.update({ status, ...selectCodex ? { backend: 'codex' } : {} })
      }
    } catch (error) {
      if (!controller.signal.aborted || (controller.signal.reason instanceof OptimizerError && controller.signal.reason.code === 'timeout')) {
        this.update({ error: error instanceof Error ? error.message : '无法读取 AI 来源。' })
      }
    } finally {
      clearTimeout(timer)
      removeAbort()
      if (this.statusController === controller) this.statusController = undefined
    }
  }

  edit(field: 'prompt' | 'instructions', value: string): void {
    if (this.state.busy) return
    this.revision++
    this.update({ [field]: value, preview: '', result: undefined, questions: [], answers: [], phase: 'edit', error: undefined })
  }

  configure(patch: Partial<Pick<TuiOptimizerState, 'mode' | 'backend' | 'includeContext'>>): void {
    if (this.state.busy) return
    this.revision++
    this.update({ ...patch, preview: '', result: undefined, phase: this.state.questions.length ? 'questions' : 'edit', error: undefined })
  }

  answer(index: number, text: string): void {
    if (this.state.busy || !this.state.questions[index]) return
    this.revision++
    const answers = [...this.state.answers]
    answers[index] = text
    this.update({ answers, result: undefined, preview: '', phase: 'questions', error: undefined })
  }

  editPreview(text: string): void {
    if (!this.state.busy && this.state.phase === 'preview') this.update({ preview: text, error: undefined })
  }

  async generate(action: OptimizeAction): Promise<void> {
    if (this.disposed || this.state.busy) return
    if (!this.state.prompt.trim()) {
      this.update({ error: '先填写需要优化的提示词。' })
      return
    }
    const availability = this.state.status?.[this.state.backend]
    if (availability && !availability.available) {
      this.update({ error: availability.reason ?? '所选 AI 来源不可用。' })
      return
    }
    const pending = { id: randomUUID(), controller: new AbortController() }
    this.pending = pending
    const revision = this.revision
    const answers: ClarificationAnswer[] = this.state.questions.map((question, index) => ({ question, answer: this.state.answers[index] ?? '' }))
    this.update({ busy: true, error: undefined, result: undefined, preview: '' })
    try {
      const result = await this.service.optimize({
        requestId: pending.id, sessionId: this.sessionId, prompt: this.state.prompt,
        mode: this.state.mode, backend: this.state.backend, instructions: this.state.instructions,
        includeContext: this.state.includeContext, action, answers,
      }, pending.controller.signal, { routeSource: 'agent-options', ...this.parent ? { parent: this.parent } : {} })
      if (this.pending !== pending || pending.controller.signal.aborted || this.disposed) return
      if (result.stage === 'questions') {
        this.update({ phase: 'questions', questions: result.questions, answers: result.questions.map(() => ''), result, busy: false })
      } else {
        this.generatedRevision = revision
        this.update({ phase: 'preview', preview: result.optimizedPrompt, result, busy: false })
      }
    } catch (error) {
      if (this.pending !== pending || this.disposed) return
      this.update({ busy: false, error: pending.controller.signal.aborted ? '优化已取消。' : error instanceof Error ? error.message : '优化失败，请重试。' })
    } finally {
      if (this.pending === pending) {
        this.pending = undefined
        this.update({ busy: false })
      }
    }
  }

  cancel(): void {
    const pending = this.pending
    if (!pending) return
    this.pending = undefined
    pending.controller.abort(new OptimizerError('cancelled', '优化已取消。'))
    try { this.service.cancel(pending.id, this.sessionId) } catch { /* The signal also owns cancellation. */ }
    this.update({ busy: false, error: '优化已取消。' })
  }

  applicationText(currentSessionId: string): string {
    if (this.disposed || currentSessionId !== this.sessionId) throw new OptimizerError('session-changed', '聊天已切换，请在当前聊天重新打开提示词优化。')
    if (this.state.busy || this.state.phase !== 'preview' || this.generatedRevision !== this.revision || !this.state.preview.trim()) {
      throw new OptimizerError('stale-preview', '先生成并检查当前设置对应的优化结果。')
    }
    return this.state.preview
  }

  dispose(): void {
    this.suspend()
    this.disposed = true
    this.listeners.clear()
  }

  /** Close the scene while retaining a preview for explicit recovery/retry. */
  suspend(): void {
    this.cancel()
    this.statusController?.abort()
    this.statusController = undefined
  }
}
