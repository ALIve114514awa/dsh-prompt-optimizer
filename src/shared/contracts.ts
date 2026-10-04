export type Backend = 'harness' | 'codex'
export type OptimizeMode = 'optimize' | 'expand' | 'concise'
export type OptimizeAction = 'clarify' | 'generate'
export interface ClarificationAnswer { question: string; answer: string }

export interface OptimizeRequest {
  requestId: string
  sessionId: string
  prompt: string
  backend: Backend
  mode: OptimizeMode
  instructions: string
  includeContext: boolean
  action?: OptimizeAction
  answers?: ClarificationAnswer[]
}

export interface OptimizeResult {
  optimizedPrompt: string
  changes: string[]
  questions: string[]
  backend: Backend
  model?: string
  stage?: 'questions' | 'result'
}

export interface BackendAvailability {
  available: boolean
  model?: string
  reason?: string
}

export interface OptimizerStatus {
  harness: BackendAvailability
  codex: BackendAvailability
  timeoutMs?: number
}

export class OptimizerError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'OptimizerError'
  }
}
