import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { Backend, OptimizeAction, OptimizeMode, OptimizeResult, OptimizerStatus } from '../shared/contracts.js'
import type { OptimizerApi } from './api.js'
import type {} from './locales.js'

export const PROMPT_VIEW_ID = 'prompt-optimizer'

export interface ComposerOrigin {
  sessionId: string
  draft: string
  draftRev: number
  hasReferences: boolean
}

export interface OptimizerUiState {
  source: string
  backend: Backend
  mode: OptimizeMode
  flow: 'direct' | 'guided'
  instructions: string
  includeContext: boolean
  output: string
  result: OptimizeResult | null
  questions: string[]
  answers: string[]
  questionIndex: number
  stage: 'compose' | 'questions' | 'result'
  origin: ComposerOrigin | null
  status: OptimizerStatus | null
  checking: boolean
  busy: 'idle' | 'generating' | 'stopping'
  error: string
  statusError: string
  notice: string
  cancellationFailed: boolean
}

export interface OptimizerUiActions {
  setSource(text: string): void
  useComposer(origin: ComposerOrigin): void
  setBackend(backend: Backend): void
  setMode(mode: OptimizeMode): void
  setFlow(flow: 'direct' | 'guided'): void
  setInstructions(text: string): void
  setIncludeContext(value: boolean): void
  setOutput(text: string): void
  answer(index: number, text: string): void
  nextQuestion(skip: boolean): void
  previousQuestion(): void
  askAgain(): void
  checkStatus(): Promise<void>
  run(action: OptimizeAction, origin: ComposerOrigin): Promise<void>
  cancel(): Promise<boolean>
  showError(text: string): void
  showNotice(text: string): void
  applied(): void
}

export interface OptimizerInjected {
  hooks: { optimizer: ObservableSnapshot<OptimizerUiState> }
  optimizerActions: OptimizerUiActions
}

interface Operation {
  id: string
  controller: AbortController
  timer: ReturnType<typeof setTimeout>
  cancelled: boolean
  cancelPending: boolean
}

/** Session-owned view state survives tab switches without entering the Session log. */
export class OptimizerUi {
  readonly source = createSnapshotStore<OptimizerUiState>({
    source: '', backend: 'harness', mode: 'optimize', flow: 'guided', instructions: '', includeContext: false,
    output: '', result: null, questions: [], answers: [], questionIndex: 0, stage: 'compose', origin: null,
    status: null, checking: false, busy: 'idle', error: '', statusError: '', notice: '', cancellationFailed: false,
  })

  private operation: Operation | null = null
  private statusController: AbortController | null = null
  private disposed = false

  constructor(private readonly sessionId: string, private readonly api: OptimizerApi, private readonly t: TranslateNS<'promptOptimizer'>) {}

  readonly actions: OptimizerUiActions = {
    setSource: text => {
      if (this.locked()) return
      this.source.update(state => {
        state.source = text
        state.stage = 'compose'
        state.questions = []
        state.answers = []
        state.questionIndex = 0
        state.output = ''
        state.result = null
        state.origin = null
        state.error = ''
        state.notice = ''
      })
    },
    useComposer: origin => {
      if (this.locked()) return
      this.actions.setSource(origin.draft)
      this.source.update(state => { state.origin = origin; state.flow = 'direct' })
    },
    setBackend: backend => { if (!this.locked()) this.source.update(state => { state.backend = backend }) },
    setMode: mode => { if (!this.locked()) this.source.update(state => { state.mode = mode }) },
    setFlow: flow => {
      if (!this.locked()) this.source.update(state => {
        if (state.flow === flow) return
        state.flow = flow
        state.stage = 'compose'
        state.questions = []
        state.answers = []
        state.questionIndex = 0
        state.result = null
        state.output = ''
        state.origin = null
        state.error = ''
        state.notice = ''
      })
    },
    setInstructions: text => { if (!this.locked()) this.source.update(state => { state.instructions = text }) },
    setIncludeContext: value => { if (!this.locked()) this.source.update(state => { state.includeContext = value }) },
    setOutput: text => { if (!this.locked()) this.source.update(state => { state.output = text; state.notice = '' }) },
    answer: (index, text) => { if (!this.locked()) this.source.update(state => { state.answers[index] = text }) },
    nextQuestion: skip => {
      if (this.locked()) return
      this.source.update(state => {
        if (skip) state.answers[state.questionIndex] = ''
        state.questionIndex = Math.min(state.questionIndex + 1, state.questions.length)
      })
    },
    previousQuestion: () => { if (!this.locked()) this.source.update(state => { state.questionIndex = Math.max(0, state.questionIndex - 1) }) },
    askAgain: () => { if (!this.locked()) this.source.update(state => { state.questionIndex = 0; state.stage = 'questions' }) },
    checkStatus: async () => {
      if (this.disposed || this.statusController) return
      const controller = new AbortController()
      this.statusController = controller
      this.source.update(state => { state.checking = true; state.statusError = '' })
      const timer = setTimeout(() => controller.abort(), 15_000)
      try {
        const status = await this.api.status(this.sessionId, controller.signal)
        if (this.disposed || this.statusController !== controller) return
        this.source.update(state => {
          state.status = status
          if (!status[state.backend].available) state.backend = status.harness.available ? 'harness' : status.codex.available ? 'codex' : state.backend
        })
      } catch (error) {
        if (!this.disposed) this.source.update(state => { state.statusError = this.t('statusFailed', { message: this.errorText(error) }) })
      } finally {
        clearTimeout(timer)
        if (this.statusController === controller) this.statusController = null
        if (!this.disposed) this.source.update(state => { state.checking = false })
      }
    },
    run: async (action, origin) => {
      if (this.locked() || this.operation || this.disposed) return
      const before = this.source.getSnapshot()
      if (!before.source.trim()) { this.actions.showError(this.t('emptyRequirement')); return }
      const controller = new AbortController()
      const operation: Operation = {
        id: crypto.randomUUID(), controller, cancelled: false, cancelPending: false,
        timer: setTimeout(() => { void this.cancel(true) }, before.status?.timeoutMs || 120_000),
      }
      this.operation = operation
      this.source.update(state => { state.busy = 'generating'; state.error = ''; state.notice = ''; state.origin = origin; state.cancellationFailed = false })
      try {
        const result = await this.api.optimize({
          requestId: operation.id, sessionId: this.sessionId, prompt: before.source,
          backend: before.backend, mode: before.mode, instructions: before.instructions, includeContext: before.includeContext,
          action,
          answers: action === 'generate' && before.flow === 'guided'
            ? before.questions.map((question, index) => ({ question, answer: before.answers[index] || '' })) : [],
        }, controller.signal)
        if (this.disposed || this.operation !== operation || operation.cancelled) return
        if (result.stage === 'questions') {
          const questions = result.questions.filter(question => question.trim()).slice(0, 3)
          if (!questions.length) throw new Error(this.t('emptyQuestions'))
          this.source.update(state => {
            state.questions = questions
            state.answers = questions.map(() => '')
            state.questionIndex = 0
            state.stage = 'questions'
            state.result = null
            state.output = ''
          })
        } else {
          if (!result.optimizedPrompt.trim()) throw new Error(this.t('emptyResult'))
          this.source.update(state => { state.result = result; state.output = result.optimizedPrompt; state.stage = 'result' })
        }
      } catch (error) {
        if (!this.disposed && this.operation === operation && !operation.cancelled) this.actions.showError(this.t('generationFailed', { message: this.errorText(error) }))
      } finally {
        clearTimeout(operation.timer)
        if (this.operation === operation && !operation.cancelled) {
          this.operation = null
          if (!this.disposed) this.source.update(state => { state.busy = 'idle' })
        }
      }
    },
    cancel: () => this.cancel(false),
    showError: error => { this.source.update(state => { state.error = error }) },
    showNotice: notice => { this.source.update(state => { state.notice = notice; state.error = '' }) },
    applied: () => { this.source.update(state => { state.origin = null; state.notice = this.t('applied') }) },
  }

  private locked() { return this.source.getSnapshot().busy !== 'idle' }

  private errorText(value: unknown) {
    const text = value instanceof Error ? value.message : String(value)
    return text.startsWith('INVALID_') ? this.t('invalidResponse') : text
  }

  private async cancel(timeout: boolean): Promise<boolean> {
    const operation = this.operation
    if (!operation || operation.cancelPending) return false
    operation.cancelled = true
    operation.cancelPending = true
    clearTimeout(operation.timer)
    operation.controller.abort()
    if (!this.disposed) this.source.update(state => {
      state.busy = 'stopping'; state.error = ''; state.notice = this.t(timeout ? 'timedOut' : 'cancelled')
    })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    let stopped = false
    try {
      await this.api.cancel(operation.id, this.sessionId, controller.signal)
      stopped = true
      return true
    } catch (error) {
      if (!this.disposed) this.source.update(state => {
        state.error = this.t('cancelFailed', { message: this.errorText(error) }); state.cancellationFailed = true
      })
      return false
    } finally {
      clearTimeout(timer)
      operation.cancelPending = false
      if (stopped && this.operation === operation) this.operation = null
      if (!this.disposed) this.source.update(state => { state.busy = 'idle'; if (stopped) state.cancellationFailed = false })
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.statusController?.abort()
    if (this.operation && !this.operation.cancelled) void this.cancel(false)
  }
}
