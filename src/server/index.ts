import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { BlockAssembler, joinAssistantStreamText, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { getCodexAvailability, generateWithCodex, CodexGenerationError } from './codex.js'
import { buildOptimizerInput, latestCompletedTurn, limitContext, OPTIMIZER_SYSTEM, parseOptimization, validateRequest, type ContextMessage } from './prompt.js'
import { RequestRegistry } from './requests.js'
import { OptimizerError, type BackendAvailability, type OptimizeRequest, type OptimizeResult, type OptimizerStatus } from '../shared/contracts.js'

export const name = 'prompt-optimizer'
export const inject = ['llm']
export interface Config {
  timeoutMs: number
  maxInputChars: number
  maxContextChars: number
  maxOutputTokens: number
  harnessProvider?: string
  harnessModel?: string
  /** Official Codex instance configured in this Harness profile. */
  codexProviderName?: string
}
export const Config: Schema<Config> = Schema.object({
  timeoutMs: Schema.number().min(1000).max(600000).default(120000),
  maxInputChars: Schema.number().min(100).max(100000).default(20000),
  maxContextChars: Schema.number().min(100).max(100000).default(16000),
  maxOutputTokens: Schema.number().min(128).max(16000).default(4096),
  harnessProvider: Schema.string(),
  harnessModel: Schema.string(),
  codexProviderName: Schema.string().min(1).default('codex'),
})

/** Process-local callers may provide their exact live agent; HTTP never accepts it. */
export interface OptimizerCallOptions { routeSource?: 'agent-options'; parent?: Agent }
export interface PromptOptimizerService {
  status(sessionId: string, signal: AbortSignal, options?: OptimizerCallOptions): Promise<OptimizerStatus>
  optimize(request: unknown, signal: AbortSignal, options?: OptimizerCallOptions): Promise<OptimizeResult>
  cancel(requestId: string, sessionId: string): boolean
}
declare module '@deepseek-ai/cordis' {
  interface Context { promptOptimizer: PromptOptimizerService }
}

async function withCancellation<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let onAbort: () => void = () => {}
  try {
    return await new Promise<T>((resolve, reject) => {
      onAbort = () => reject(signal.reason ?? new DOMException('优化已取消。', 'AbortError'))
      signal.addEventListener('abort', onAbort, { once: true })
      promise.then(resolve, reject)
      if (signal.aborted) onAbort()
    })
  } finally { signal.removeEventListener('abort', onAbort) }
}

interface Route { provider: string; model: string; reasoningEffort?: GenerateOptions['reasoningEffort'] }

function selectedRoute(ctx: Context, agent: Agent, config: Config, preferAgentOptions = false): Route {
  if (config.harnessProvider && config.harnessModel) return { provider: config.harnessProvider, model: config.harnessModel }
  const projections = ctx.get('sessionProjections')
  const projected = projections?.stateOf(agent.session, 'modelSelection') as { pending?: Route | null } | undefined
  const pending = projected?.pending
  if (pending) return { ...pending }
  // The TUI switches models by forking with new options while retaining history.
  if (preferAgentOptions && agent.options.provider && agent.options.model) return {
    provider: agent.options.provider, model: agent.options.model,
    ...(agent.options.reasoningEffort ? { reasoningEffort: agent.options.reasoningEffort } : {}),
  }
  const logged = agent.session.requestHeader()?.config
  if (logged) return { provider: logged.provider, model: logged.model, ...(logged.reasoningEffort ? { reasoningEffort: logged.reasoningEffort } : {}) }
  const current = ctx.get('agentDefaultModel')?.currentSelection()
  if (!current?.provider || !current.model) throw new OptimizerError('model-unavailable', '请先为当前聊天选择可用的 Harness 模型。')
  return { ...current }
}

async function resolveAgent(ctx: Context, sessionId: string, signal: AbortSignal, parent?: Agent): Promise<Agent> {
  signal.throwIfAborted()
  if (parent) {
    const agents = ctx.get('agents')
    if (parent.session.id !== sessionId || (agents && agents.get(sessionId as SessionId) !== parent)) {
      throw new OptimizerError('session-unavailable', '当前聊天已失效，请在当前聊天重新打开提示词优化。')
    }
    return parent
  }
  const controller = ctx.get('sessionController')
  if (!controller) throw new OptimizerError('session-unavailable', '当前界面没有聊天恢复服务，请从聊天的提示词优化入口重新打开。')
  const resolved = await withCancellation(controller.resolveAgent(sessionId as SessionId), signal)
  if ('error' in resolved) throw new OptimizerError('session-unavailable', '无法打开当前聊天，请在普通会话中重试。')
  return resolved.agent
}

function readContext(agent: Agent, maxChars: number): ContextMessage[] {
  const messages: ContextMessage[] = []
  for (const event of latestCompletedTurn(agent.session.snapshotEvents())) {
    if (event.type === 'user/message') {
      // Context means committed human messages, not tool output or plugin injections.
      if (event.data.source.kind !== 'user') continue
      const text = event.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
      if (text.trim()) messages.push({ role: 'user', text })
    } else if (event.type === 'assistant/message') {
      const text = joinAssistantStreamText(event.data.stream)
      if (text.trim()) messages.push({ role: 'assistant', text })
    }
  }
  return limitContext(messages, maxChars)
}

async function harnessStatus(ctx: Context, sessionId: string, config: Config, signal: AbortSignal, preferAgentOptions = false, parent?: Agent): Promise<BackendAvailability> {
  try {
    const agent = await resolveAgent(ctx, sessionId, signal, parent)
    const route = selectedRoute(ctx, agent, config, preferAgentOptions)
    const available = ctx.llm.listProviders().some(provider => provider.id === route.provider)
    return { available, model: route.model, ...available ? {} : { reason: '当前模型的提供方尚未配置，请在 Harness 中完成模型设置。' } }
  } catch (error) {
    signal.throwIfAborted()
    return { available: false, reason: error instanceof OptimizerError ? error.message : '当前聊天的模型信息不可用，请重新打开聊天。' }
  }
}

async function generateWithHarness(ctx: Context, route: Route, sessionId: string, input: string, config: Config, signal: AbortSignal): Promise<string> {
  const assembler = new BlockAssembler()
  for await (const chunk of ctx.llm.stream({
    provider: route.provider, model: route.model, reasoningEffort: route.reasoningEffort,
    messages: [{ role: 'user', content: [{ type: 'text', text: input }] }],
    system: OPTIMIZER_SYSTEM, tools: [], maxTokens: config.maxOutputTokens,
    sessionId: sessionId as SessionId, signal,
  })) {
    signal.throwIfAborted()
    assembler.push(chunk)
  }
  signal.throwIfAborted()
  const finish = assembler.finish
  if (finish.kind === 'aborted') throw new OptimizerError('cancelled', '优化已取消。')
  if (finish.kind === 'error') {
    const messages: Record<string, string> = {
      AUTH: 'Harness 模型认证失败，请检查登录或 API 配置。',
      MISSING_CREDENTIAL: '当前模型缺少凭据，请在 Harness 设置中配置。',
      RATE_LIMIT: '模型请求达到限额，请稍后重试。',
      NO_ADAPTER: '当前模型提供方不可用，请切换模型。',
    }
    throw new OptimizerError(finish.failure.code, messages[finish.failure.code] ?? 'Harness 模型调用失败，请检查模型配置或稍后重试。')
  }
  if (finish.kind !== 'stop') throw new OptimizerError('invalid-result', finish.kind === 'max-tokens' ? '优化结果达到长度上限，请选择精简模式或增加输出上限。' : 'AI 返回了工具调用，未接受此结果，请重新生成。')
  const blocks = assembler.blocks()
  if (blocks.some(block => block.type === 'tool-call')) throw new OptimizerError('invalid-result', 'AI 返回了工具调用，未接受此结果。')
  return blocks.filter(block => block.type === 'text').map(block => block.text).join('')
}

export function apply(ctx: Context, config: Config): void {
  if (Boolean(config.harnessProvider) !== Boolean(config.harnessModel)) throw new Error('harnessProvider 与 harnessModel 必须同时设置。')
  const registry = new RequestRegistry(config.timeoutMs)
  ctx.effect(() => () => registry.dispose())

  async function optimize(request: OptimizeRequest, signal: AbortSignal, options?: OptimizerCallOptions): Promise<OptimizeResult> {
    const agent = await resolveAgent(ctx, request.sessionId, signal, options?.parent)
    signal.throwIfAborted()
    const context = request.includeContext ? readContext(agent, config.maxContextChars) : []
    const input = buildOptimizerInput(request, context)
    const route = request.backend === 'harness' ? selectedRoute(ctx, agent, config, options?.routeSource === 'agent-options') : undefined
    // Private optimization must not add plugin events to the durable chat log.
    // Released Session.append has no public ignorable-event writer; unknown
    // required events would prevent the official persistence reader restoring it.
    const text = request.backend === 'harness'
      ? await withCancellation(generateWithHarness(ctx, route!, request.sessionId, input, config, signal), signal)
      : await generateWithCodex(ctx, { sessionId: request.sessionId, parent: agent, prompt: `${OPTIMIZER_SYSTEM}\n\n待改写的数据：\n${input}` }, signal, config.codexProviderName)
    signal.throwIfAborted()
    const result: OptimizeResult = { ...parseOptimization(text, 30000, request.action), backend: request.backend, ...(route ? { model: route.model } : {}) }
    return result
  }

  const service: PromptOptimizerService = {
    async status(sessionId, signal, options) {
      if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 200) throw new OptimizerError('invalid-request', '当前聊天无效。')
      signal.throwIfAborted()
      return { harness: await harnessStatus(ctx, sessionId, config, signal, options?.routeSource === 'agent-options', options?.parent), codex: getCodexAvailability(ctx, config.codexProviderName), timeoutMs: config.timeoutMs }
    },
    async optimize(raw, signal, options) {
      const request = validateRequest(raw, config.maxInputChars)
      return await registry.run(request.requestId, request.sessionId, signal, signal => optimize(request, signal, options))
    },
    cancel: (requestId, sessionId) => registry.cancel(requestId, sessionId),
  }
  ctx.provide('promptOptimizer', service)

  ctx.inject(['connection'], ctx => {
  for (const operation of ['status', 'optimize', 'cancel'] as const) {
    ctx.connection.fetch.register({
      path: `/api/promptOptimizer/${operation}`, methods: ['POST'], requestBody: 'buffered',
      fetch: async (request: Request): Promise<Response> => {
        let rpcId: unknown
        try {
          const body = await request.json() as Record<string, unknown>
          rpcId = body.rpcId
          if (body.type !== 'client-request' || typeof rpcId !== 'string' || body.method !== `promptOptimizer/${operation}`) throw new OptimizerError('invalid-request', '请求格式无效。')
          let value: unknown
          if (operation === 'status') {
            const sessionId = (body.payload as { sessionId?: unknown } | undefined)?.sessionId
            if (typeof sessionId !== 'string' || !sessionId) throw new OptimizerError('invalid-request', '当前聊天无效。')
            value = await service.status(sessionId, request.signal)
          } else if (operation === 'cancel') {
            const payload = body.payload as { requestId?: unknown; sessionId?: unknown } | undefined
            if (typeof payload?.requestId !== 'string' || typeof payload.sessionId !== 'string') throw new OptimizerError('invalid-request', '取消请求无效。')
            value = { cancelled: service.cancel(payload.requestId, payload.sessionId) }
          } else {
            value = await service.optimize(body.payload, request.signal)
          }
          return Response.json({ type: 'server-response', rpcId, result: { ok: true, value } })
        } catch (error) {
          const known = error instanceof OptimizerError || error instanceof CodexGenerationError
          const aborted = error instanceof Error && error.name === 'AbortError'
          const code = known ? error.code : aborted ? 'cancelled' : 'internal'
          const message = known ? error.message : aborted ? '优化已取消。' : '提示词优化失败，请重试。'
          if (!known && !aborted) ctx.logger.warn(`提示词优化：${operation} 操作失败。`)
          return Response.json({ type: 'server-response', rpcId: typeof rpcId === 'string' ? rpcId : 'invalid', result: { ok: false, error: { code, message, details: {} } } })
        }
      },
    })
  }
  })
}
