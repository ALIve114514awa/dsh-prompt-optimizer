import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentRun } from '@deepseek-ai/dsh-subagent'

export type CodexErrorCode =
  | 'codex-unavailable'
  | 'session-unavailable'
  | 'codex-failed'
  | 'invalid-result'
  | 'dispose-failed'

export class CodexGenerationError extends Error {
  readonly name = 'CodexGenerationError'

  constructor(
    readonly code: CodexErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

export function getCodexAvailability(ctx: Context, providerName = 'codex'): { available: boolean; reason?: string } {
  const subagents = ctx.get('subagents')
  if (!subagents?.getProvider(providerName)) {
    return {
      available: false,
      reason: '当前 Harness 未加载所配置的 Codex provider。请安装与 Harness 匹配的 dsh-subagent-codex 插件，并检查 provider 名称。',
    }
  }
  return { available: true }
}

function cancellationReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('提示词优化已取消。', 'AbortError')
}

/** Observe the operation even after cancellation so a late rejection is handled. */
async function cancellable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort: () => void = () => {}
  try {
    return await new Promise<T>((resolve, reject) => {
      onAbort = () => { reject(cancellationReason(signal)) }
      signal.addEventListener('abort', onAbort, { once: true })
      operation.then(resolve, reject)
      if (signal.aborted) onAbort()
    })
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/**
 * Use the official one-shot provider, retaining its native authentication and
 * model configuration. This adapter deliberately makes no Codex CLI fallback.
 */
export async function generateWithCodex(
  ctx: Context,
  request: { sessionId: string; prompt: string; parent?: Agent },
  signal: AbortSignal,
  providerName = 'codex',
): Promise<string> {
  signal.throwIfAborted()
  const availability = getCodexAvailability(ctx, providerName)
  if (!availability.available) {
    throw new CodexGenerationError('codex-unavailable', availability.reason!)
  }
  if (!request.sessionId.trim() || !request.prompt.trim()) {
    throw new CodexGenerationError('invalid-result', 'Codex 优化需要有效的会话和提示词。')
  }

  const subagents = ctx.get('subagents')!
  const controller = ctx.get('sessionController')
  let resolved: { agent: Agent } | { error: unknown }
  try {
    if (request.parent) {
      const agents = ctx.get('agents')
      if (request.parent.session.id !== request.sessionId || (agents && agents.get(request.sessionId as SessionId) !== request.parent)) {
        throw new CodexGenerationError('session-unavailable', '当前聊天已失效，请重新打开提示词优化。')
      }
      resolved = { agent: request.parent }
    } else {
      if (!controller) throw new CodexGenerationError('session-unavailable', '当前界面没有聊天恢复服务，请从当前聊天重新打开提示词优化。')
      resolved = await cancellable(controller.resolveAgent(request.sessionId as SessionId), signal)
    }
  } catch (error) {
    if (signal.aborted) throw cancellationReason(signal)
    throw new CodexGenerationError(
      'session-unavailable',
      '当前会话无法恢复，请重新打开普通会话后重试。',
      { cause: error },
    )
  }
  signal.throwIfAborted()
  if ('error' in resolved) {
    throw new CodexGenerationError(
      'session-unavailable',
      '当前会话无法作为 Codex 优化的父会话。请在普通会话中重试。',
      { cause: resolved.error },
    )
  }
  if (!resolved.agent.session.header.cwd) {
    throw new CodexGenerationError('session-unavailable', '当前会话没有可用的工作区。')
  }

  // Await publication without racing it: before publication the provider owns
  // cancellation and cleanup; afterward this function owns the returned run.
  let run: SubagentRun
  try {
    run = await subagents.start(providerName, {
      label: '提示词优化',
      parent: resolved.agent,
      prompt: [{ type: 'text', text: request.prompt }],
      signal,
    })
  } catch (error) {
    if (signal.aborted) throw cancellationReason(signal)
    throw new CodexGenerationError(
      'codex-failed',
      'Codex 启动失败。请检查官方 Codex 插件、原生登录状态和模型配置。',
      { cause: error },
    )
  }

  let failed = false
  try {
    const result = await cancellable(run.result, signal)
    signal.throwIfAborted()
    if (result.stopReason === 'aborted') {
      throw new DOMException('Codex 优化已取消。', 'AbortError')
    }
    if (result.stopReason !== 'completed') {
      // Only map fixed provider categories; never expose raw native diagnostics.
      const category = result.diagnostic?.match(/category: (limit|access-policy|service|transport|product-error)(?:;|\))/)?.[1]
      const reasons: Record<string, string> = {
        limit: 'Codex 账号用量已达限制，请等待额度恢复或切换 Harness 模型。',
        'access-policy': 'Codex 访问被拒绝，请检查原生登录和模型权限。',
        service: 'Codex 服务暂时不可用，请稍后重试。',
        transport: 'Codex 连接失败，请检查原生连接配置后重试。',
        'product-error': '原生 Codex 拒绝了请求。请检查官方 Codex provider 的原生模型配置与账号支持情况，然后重试或切换 Harness 模型。',
      }
      throw new CodexGenerationError('codex-failed', category ? reasons[category]! : `Codex 优化未完成（${result.stopReason}）。`)
    }
    const text = result.output
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text)
      .join('\n')
      .trim()
    if (!text) throw new CodexGenerationError('invalid-result', 'Codex 未返回可用的优化结果。')
    return text
  } catch (error) {
    failed = true
    if (signal.aborted) throw cancellationReason(signal)
    if (error instanceof CodexGenerationError || (error instanceof Error && error.name === 'AbortError')) {
      throw error
    }
    throw new CodexGenerationError('codex-failed', 'Codex 优化请求失败，请检查原生 Codex 状态后重试。', { cause: error })
  } finally {
    try {
      await run.dispose()
    } catch (error) {
      if (failed) {
        // Preserve the original failure without copying provider diagnostics,
        // paths, credentials, or protocol payloads into the browser response.
        ctx.logger.warn('提示词优化：Codex 任务失败后的资源清理未完成。')
      } else {
        throw new CodexGenerationError('dispose-failed', 'Codex 结果已生成，但任务资源清理失败。', { cause: error })
      }
    }
  }
}
