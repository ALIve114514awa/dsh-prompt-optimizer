import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { BackendAvailability, OptimizeRequest, OptimizeResult, OptimizerStatus } from '../shared/contracts.js'

export interface OptimizerApi {
  status(sessionId: string, signal: AbortSignal): Promise<OptimizerStatus>
  optimize(request: OptimizeRequest, signal: AbortSignal): Promise<OptimizeResult>
  cancel(requestId: string, sessionId: string, signal: AbortSignal): Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isAvailability(value: unknown): value is BackendAvailability {
  return isRecord(value)
    && typeof value.available === 'boolean'
    && (value.model === undefined || typeof value.model === 'string')
    && (value.reason === undefined || typeof value.reason === 'string')
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

/** Keep transport and Cordis services in the plugin assembly closure. */
export function createOptimizerApi(ctx: Context): OptimizerApi {
  async function call(endpoint: string, payload: unknown, signal: AbortSignal): Promise<unknown> {
    // This version publishes the service without a Context declaration merge.
    const connection = ctx.get('connection') as ConnectionHandle
    const result = await connection.rpc.call('/api', `promptOptimizer/${endpoint}`, payload, signal)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }

  return {
    async status(sessionId, signal) {
      const value = await call('status', { sessionId }, signal)
      if (!isRecord(value) || !isAvailability(value.harness) || !isAvailability(value.codex)) {
        throw new Error('INVALID_STATUS_RESPONSE')
      }
      return {
        harness: value.harness,
        codex: value.codex,
        timeoutMs: typeof value.timeoutMs === 'number' && Number.isFinite(value.timeoutMs) && value.timeoutMs > 0
          ? value.timeoutMs : undefined,
      }
    },
    async optimize(request, signal) {
      const value = await call('optimize', request, signal)
      if (!isRecord(value)
        || typeof value.optimizedPrompt !== 'string'
        || !isStringArray(value.changes)
        || !isStringArray(value.questions)
        || (value.backend !== 'harness' && value.backend !== 'codex')
        || (value.model !== undefined && typeof value.model !== 'string')
        || (value.stage !== undefined && value.stage !== 'questions' && value.stage !== 'result')) {
        throw new Error('INVALID_OPTIMIZE_RESPONSE')
      }
      return value as unknown as OptimizeResult
    },
    async cancel(requestId, sessionId, signal) {
      await call('cancel', { requestId, sessionId }, signal)
    },
  }
}
