import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CodexGenerationError, generateWithCodex, getCodexAvailability } from '../src/server/codex.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function fixture(options: {
  available?: boolean
  providerName?: string
  parentError?: boolean
  noController?: boolean
  startError?: Error
  result?: Promise<unknown>
  disposalError?: Error
} = {}) {
  const calls: { provider: string; request: Record<string, unknown> }[] = []
  const state = { disposed: 0, resolved: 0, warnings: 0, providerLookups: [] as string[] }
  const agent = { session: { id: 'ordinary-session', header: { cwd: 'D:/example' } } }
  const services = {
    subagents: {
      getProvider: (name: string) => {
        state.providerLookups.push(name)
        const expected = options.providerName ?? 'codex'
        return options.available === false || name !== expected ? undefined : { name: expected }
      },
      async start(provider: string, request: Record<string, unknown>) {
        calls.push({ provider, request })
        if (options.startError) throw options.startError
        return {
          result: options.result ?? Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: '{"optimizedPrompt":"结果"}' }] }),
          async dispose() {
            state.disposed++
            if (options.disposalError) throw options.disposalError
          },
        }
      },
    },
    sessionController: options.noController ? undefined : {
      async resolveAgent() {
        state.resolved++
        return options.parentError ? { error: new Error('parent-owned') } : { agent }
      },
    },
  }
  const ctx = {
    get: (name: keyof typeof services) => services[name],
    logger: { warn: () => { state.warnings++ } },
  } as unknown as Context
  return { ctx, agent, calls, state }
}

const request = { sessionId: 'ordinary-session', prompt: '完整优化指令' }

test('passes the resolved parent and cancellation to the official provider, then disposes', async () => {
  const f = fixture()
  const signal = new AbortController().signal
  assert.equal(await generateWithCodex(f.ctx, request, signal), '{"optimizedPrompt":"结果"}')
  assert.equal(f.calls[0]?.provider, 'codex')
  assert.equal(f.calls[0]?.request.parent, f.agent)
  assert.equal(f.calls[0]?.request.signal, signal)
  assert.deepEqual(f.calls[0]?.request.prompt, [{ type: 'text', text: request.prompt }])
  assert.equal(f.state.disposed, 1)
})

test('reports a missing provider without attempting any task or fallback', async () => {
  const f = fixture({ available: false })
  assert.equal(getCodexAvailability(f.ctx).available, false)
  await assert.rejects(generateWithCodex(f.ctx, request, new AbortController().signal), (error: unknown) => {
    return error instanceof CodexGenerationError && error.code === 'codex-unavailable'
  })
  assert.equal(f.state.resolved, 0)
  assert.equal(f.calls.length, 0)
})

test('selects the deployment-owned Codex instance without overriding its native settings', async () => {
  const providerName = 'prompt-optimizer-codex'
  const f = fixture({ providerName })
  const signal = new AbortController().signal
  assert.equal(getCodexAvailability(f.ctx, providerName).available, true)
  await generateWithCodex(f.ctx, request, signal, providerName)
  assert.equal(f.calls[0]?.provider, providerName)
  assert.ok(f.state.providerLookups.every(name => name === providerName))
  assert.deepEqual(Object.keys(f.calls[0]!.request).sort(), ['label', 'parent', 'prompt', 'signal'])
  assert.equal(f.state.disposed, 1)
})

test('a missing dedicated Codex instance never falls back to the global provider', async () => {
  const f = fixture()
  await assert.rejects(generateWithCodex(f.ctx, request, new AbortController().signal, 'missing-dedicated-codex'), { code: 'codex-unavailable' })
  assert.deepEqual(f.state.providerLookups, ['missing-dedicated-codex'])
  assert.equal(f.calls.length, 0)
  assert.equal(f.state.resolved, 0)
})

test('a trusted live TUI parent can start Codex without a Web session controller', async () => {
  const f = fixture({ noController: true })
  assert.equal(getCodexAvailability(f.ctx).available, true)
  await generateWithCodex(f.ctx, { ...request, parent: f.agent as Agent }, new AbortController().signal)
  assert.equal(f.calls[0]?.request.parent, f.agent)
  assert.equal(f.state.resolved, 0)
  assert.equal(f.state.disposed, 1)
  await assert.rejects(generateWithCodex(f.ctx, { ...request, sessionId: 'different-session', parent: f.agent as Agent }, new AbortController().signal), { code: 'session-unavailable' })
  assert.equal(f.calls.length, 1)
})

test('rejects unavailable or subagent-owned parent sessions', async () => {
  const f = fixture({ parentError: true })
  await assert.rejects(generateWithCodex(f.ctx, request, new AbortController().signal), (error: unknown) => {
    return error instanceof CodexGenerationError && error.code === 'session-unavailable'
  })
  assert.equal(f.calls.length, 0)
})

test('a pre-aborted request never resolves a parent or starts Codex', async () => {
  const f = fixture()
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(generateWithCodex(f.ctx, request, controller.signal), { name: 'AbortError' })
  assert.equal(f.state.resolved, 0)
  assert.equal(f.calls.length, 0)
})

test('cancellation releases a published run even when its result has not settled', async () => {
  const result = deferred<unknown>()
  const f = fixture({ result: result.promise })
  const controller = new AbortController()
  const generation = generateWithCodex(f.ctx, request, controller.signal)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.calls.length, 1)
  controller.abort()
  await assert.rejects(generation, { name: 'AbortError' })
  assert.equal(f.state.disposed, 1)
  // A late transport rejection must remain observed after the cancelled request.
  result.reject(new Error('late transport rejection'))
  await new Promise(resolve => setImmediate(resolve))
})

test('startup failures retain a safe diagnostic and no unpublished run is disposed', async () => {
  const f = fixture({ startError: new Error('native process authentication detail') })
  await assert.rejects(generateWithCodex(f.ctx, request, new AbortController().signal), (error: unknown) => {
    return error instanceof CodexGenerationError && error.code === 'codex-failed'
      && !error.message.includes('authentication detail')
  })
  assert.equal(f.state.disposed, 0)
})

test('failed runs never return partial output and always dispose', async () => {
  const f = fixture({ result: Promise.resolve({ stopReason: 'error', output: [{ type: 'text', text: 'partial' }] }) })
  await assert.rejects(generateWithCodex(f.ctx, request, new AbortController().signal), (error: unknown) => {
    return error instanceof CodexGenerationError && error.code === 'codex-failed'
  })
  assert.equal(f.state.disposed, 1)
})

test('a usage limit is actionable without exposing native diagnostics', async () => {
  const f = fixture({ result: Promise.resolve({ stopReason: 'error', output: [], diagnostic: 'Product subagent failure (product: Codex; stage: turn; category: limit) secret-token' }) })
  await assert.rejects(generateWithCodex(f.ctx, request, new AbortController().signal), (error: unknown) => {
    return error instanceof CodexGenerationError && error.message.includes('用量已达限制') && !error.message.includes('secret-token')
  })
  assert.equal(f.state.disposed, 1)
})

test('native request rejection gives model configuration guidance without exposing product errors or partial output', async () => {
  const diagnostic = 'Product subagent failure (product: Codex; stage: turn; category: product-error; httpStatusCode: 400) SECRET_NATIVE_BODY'
  const f = fixture({ result: Promise.resolve({ stopReason: 'error', output: [{ type: 'text', text: 'unsafe partial result' }], diagnostic }) })
  await assert.rejects(generateWithCodex(f.ctx, request, new AbortController().signal), (error: unknown) => {
    return error instanceof CodexGenerationError && error.code === 'codex-failed'
      && error.message.includes('原生模型配置与账号支持情况')
      && !error.message.includes('SECRET_NATIVE_BODY')
      && !error.message.includes('unsafe partial result')
      && !error.message.includes('400')
  })
  assert.equal(f.state.disposed, 1)
})

test('empty output is rejected while a result promise rejection still cleans up', async () => {
  const empty = fixture({ result: Promise.resolve({ stopReason: 'completed', output: [] }) })
  await assert.rejects(generateWithCodex(empty.ctx, request, new AbortController().signal), (error: unknown) => {
    return error instanceof CodexGenerationError && error.code === 'invalid-result'
  })
  assert.equal(empty.state.disposed, 1)

  const rejected = fixture({ result: Promise.reject(new Error('transport details')) })
  await assert.rejects(generateWithCodex(rejected.ctx, request, new AbortController().signal), (error: unknown) => {
    return error instanceof CodexGenerationError && error.code === 'codex-failed'
  })
  assert.equal(rejected.state.disposed, 1)
})

test('cleanup failures after success are reported, while original failures are preserved', async () => {
  const successful = fixture({ disposalError: new Error('cleanup details') })
  await assert.rejects(generateWithCodex(successful.ctx, request, new AbortController().signal), (error: unknown) => {
    return error instanceof CodexGenerationError && error.code === 'dispose-failed'
  })
  const failed = fixture({
    result: Promise.resolve({ stopReason: 'error', output: [] }),
    disposalError: new Error('cleanup details'),
  })
  await assert.rejects(generateWithCodex(failed.ctx, request, new AbortController().signal), (error: unknown) => {
    return error instanceof CodexGenerationError && error.code === 'codex-failed'
  })
  assert.equal(failed.state.warnings, 1)
})
