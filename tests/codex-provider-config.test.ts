import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import { apply, type Config } from '../src/server/index.js'

test('Host status and generation use only the configured Codex instance, even when RPC supplies a different name', async () => {
  const providerName = 'prompt-optimizer-codex'
  const lookups: string[] = []
  const calls: { provider: string; request: Record<string, unknown> }[] = []
  const routes = new Map<string, { fetch: (request: Request) => Promise<Response> }>()
  let disposed = 0
  const agent = {
    options: {},
    session: { id: 'test-session', header: { cwd: 'D:/example' }, requestHeader: () => undefined },
  }
  const services: Record<string, unknown> = {
    sessionController: { resolveAgent: async () => ({ agent }) },
    agents: { get: () => agent },
    agentDefaultModel: { currentSelection: () => ({ provider: 'harness', model: 'selected-model' }) },
    subagents: {
      getProvider: (name: string) => {
        lookups.push(name)
        return name === providerName ? { name } : undefined
      },
      start: async (provider: string, request: Record<string, unknown>) => {
        calls.push({ provider, request })
        return {
          result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: JSON.stringify({ stage: 'result', optimizedPrompt: '预览提示词', changes: [], questions: [] }) }] }),
          dispose: async () => { disposed++ },
        }
      },
    },
  }
  const ctx = {
    get: (name: string) => services[name],
    provide: () => {},
    effect: (effect: () => unknown) => effect(),
    inject: (_names: string[], callback: (ctx: Context) => void) => callback(ctx),
    logger: { warn: () => {} },
    llm: { listProviders: () => [{ id: 'harness' }] },
    connection: { fetch: { register: (route: { path: string; fetch: (request: Request) => Promise<Response> }) => routes.set(route.path, route) } },
  } as unknown as Context
  const config: Config = { timeoutMs: 10000, maxInputChars: 20000, maxContextChars: 16000, maxOutputTokens: 4096, codexProviderName: providerName }
  apply(ctx, config)
  async function rpc(operation: string, payload: unknown) {
    const request = new Request(`http://localhost/api/promptOptimizer/${operation}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'codex-config-test', method: `promptOptimizer/${operation}`, payload }),
    })
    return await (await routes.get(`/api/promptOptimizer/${operation}`)!.fetch(request)).json()
  }
  const status = await rpc('status', { sessionId: 'test-session', codexProviderName: 'other-provider' })
  assert.equal(status.result.ok, true)
  assert.equal(status.result.value.codex.available, true)
  const result = await rpc('optimize', {
    requestId: 'codex-config-test-request', sessionId: 'test-session', backend: 'codex', prompt: '帮我写教程',
    mode: 'optimize', action: 'generate', instructions: '', includeContext: false,
    codexProviderName: 'other-provider', model: 'client-supplied-model',
  })
  assert.equal(result.result.ok, true)
  assert.equal(result.result.value.optimizedPrompt, '预览提示词')
  assert.ok(lookups.length >= 2)
  assert.ok(lookups.every(name => name === providerName))
  assert.equal(calls[0]?.provider, providerName)
  assert.deepEqual(Object.keys(calls[0]!.request).sort(), ['label', 'parent', 'prompt', 'signal'])
  assert.equal(disposed, 1)
})
