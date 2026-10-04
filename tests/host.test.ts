import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-session-persistence-jsonl'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { apply, type Config, type PromptOptimizerService } from '../src/server/index.js'

const config: Config = { timeoutMs: 10000, maxInputChars: 20000, maxContextChars: 16000, maxOutputTokens: 4096 }
const payload = { requestId: 'host-request-123', sessionId: 'test-session', prompt: '写一个教程', backend: 'harness', mode: 'expand', instructions: '', includeContext: false }
const end = (turn: number) => ({ type: 'turn/end', data: { turn } })
const start = (turn: number) => ({ type: 'turn/start', data: { turn } })
const user = (text: string) => ({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } })
const assistant = (text: string) => ({ type: 'assistant/message', data: { stream: [{ type: 'text-chunks', index: 0, texts: [text] }] } })

function fixture(options: { text?: string; failure?: string; events?: unknown[]; pending?: { provider: string; model: string }; resolution?: Promise<unknown>; agentOptions?: {provider:string;model:string}; loggedRoute?: {provider:string;model:string}; stalledStream?: boolean; timeoutMs?: number; noController?: boolean; session?: Session } = {}) {
  const routes = new Map<string, { fetch: (request: Request) => Promise<Response> }>()
  const calls: Record<string, unknown>[] = []
  const log: { type: string; data: unknown }[] = []
  let submitted = 0
  let service!: PromptOptimizerService
  const agent = {
    options: options.agentOptions ?? {},
    session: options.session ?? {
      id: 'test-session',
      header: { cwd: 'D:/example' },
      requestHeader: () => options.loggedRoute ? {config:options.loggedRoute} : undefined,
      snapshotEvents: () => options.events ?? [],
      append: (type: string, data: unknown) => log.push({ type, data }),
    },
    inbox: { submit: () => { submitted++; throw new Error('must not submit a chat message') } },
  }
  const services = {
    sessionController: options.noController ? undefined : { resolveAgent: async () => options.resolution ? await options.resolution : ({ agent }), submit: () => { submitted++ } },
    agents: { get: (id: string) => id === 'test-session' ? agent : undefined },
    agentDefaultModel: { currentSelection: () => ({ provider: 'test', model: 'test-model' }) },
    sessionProjections: { stateOf: () => ({ pending: options.pending ?? null }) },
    subagents: undefined,
  }
  const ctx = {
    get: (name: keyof typeof services) => services[name],
    provide: (_name: string, value: PromptOptimizerService) => {service = value},
    inject: (_names: string[], callback: (ctx: Context) => void) => callback(ctx),
    sessionController: services.sessionController,
    effect: (effect: () => unknown) => effect(),
    logger: { warn: () => {} },
    connection: { fetch: { register: (route: { path: string; fetch: (request: Request) => Promise<Response> }) => routes.set(route.path, route) } },
    llm: {
      listProviders: () => [{ id: 'test' }],
      async *stream(request: Record<string, unknown>) {
        calls.push(request)
        if (options.stalledStream) await new Promise(() => {})
        if (options.failure) {
          yield { type: 'finish', reason: { kind: 'error', failure: { code: options.failure, message: 'SECRET_DIAGNOSTIC' } } }
        } else {
          yield { type: 'text-delta', index: 0, text: options.text ?? JSON.stringify({ stage: 'result', optimizedPrompt: '面向初学者，写一篇逐步教程。', changes: ['明确目标'], questions: [] }) }
          yield { type: 'finish', reason: { kind: 'stop' } }
        }
      },
    },
  } as unknown as Context
  apply(ctx, {...config,...options.timeoutMs ? {timeoutMs:options.timeoutMs} : {}})
  async function rpc(operation: string, data: unknown, signal?: AbortSignal) {
    const request = new Request(`http://localhost/api/promptOptimizer/${operation}`, { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'rpc-test-id', method: `promptOptimizer/${operation}`, payload: data }) })
    return await (await routes.get(`/api/promptOptimizer/${operation}`)!.fetch(request)).json() as { rpcId: string; result: { ok: boolean; value?: any; error?: { code: string; message: string } } }
  }
  return { routes, calls, log, rpc, service, agent: agent as unknown as Agent, submitted: () => submitted }
}

test('private RPC generates a preview without submitting a main chat turn', async () => {
  const f = fixture()
  assert.deepEqual([...f.routes.keys()], ['/api/promptOptimizer/status','/api/promptOptimizer/optimize','/api/promptOptimizer/cancel'])
  const response = await f.rpc('optimize', payload)
  assert.equal(response.rpcId, 'rpc-test-id')
  assert.equal(response.result.ok, true)
  assert.equal(response.result.value.optimizedPrompt, '面向初学者，写一篇逐步教程。')
  assert.deepEqual(f.calls[0]!.tools, [])
  assert.equal(f.calls[0]!.provider, 'test')
  assert.equal(f.submitted(), 0)
  assert.deepEqual(f.log, [])
})

test('TUI uses its trusted live agent without a session controller, while RPC cannot supply that parent', async () => {
  const f = fixture({ noController: true, agentOptions: { provider: 'test', model: 'tui-model' } })
  const options = { routeSource: 'agent-options' as const, parent: f.agent }
  assert.equal((await f.service.status('test-session', new AbortController().signal, options)).harness.model, 'tui-model')
  assert.equal((await f.service.optimize(payload, new AbortController().signal, options)).optimizedPrompt, '面向初学者，写一篇逐步教程。')
  assert.equal(f.calls.length, 1)
  await assert.rejects(f.service.optimize({ ...payload, requestId: 'another-request', sessionId: 'another-session' }, new AbortController().signal, options), { code: 'session-unavailable' })
  const rpc = await f.rpc('optimize', { ...payload, requestId: 'wire-parent-request', parent: { session: { id: 'test-session' } } })
  assert.equal(rpc.result.error?.code, 'session-unavailable')
  assert.equal(f.calls.length, 1)
  assert.equal(f.submitted(), 0)
})

test('opted-in context includes only the latest ended user/assistant turn', async () => {
  const f = fixture({ events: [start(1),user('old'),assistant('old reply'),end(1),start(2),user('previous'),{type:'tool/result',data:{message:'secret tool output'}},assistant('previous reply'),end(2),start(3),user('active'),assistant('partial')] })
  await f.rpc('optimize', {...payload,includeContext:true})
  const input = JSON.parse((f.calls[0]!.messages as {content:{text:string}[]}[])[0]!.content[0]!.text)
  assert.deepEqual(input.conversation, [{role:'user',text:'previous'},{role:'assistant',text:'previous reply'}])
  assert.equal(f.submitted(), 0)
})

test('clarification and answers stay in optimizer requests', async () => {
  const f = fixture({ text: JSON.stringify({stage:'questions',optimizedPrompt:'',changes:[],questions:['教程面向谁？']}) })
  const response = await f.rpc('optimize', {...payload,action:'clarify'})
  assert.equal(response.result.value.stage, 'questions')
  assert.equal(response.result.value.optimizedPrompt, '')
  assert.equal(f.submitted(), 0)
  const g = fixture()
  await g.rpc('optimize', {...payload,action:'generate',answers:[{question:'教程面向谁？',answer:'初学者'}]})
  const input = JSON.parse((g.calls[0]!.messages as {content:{text:string}[]}[])[0]!.content[0]!.text)
  assert.deepEqual(input.clarificationAnswers,[{question:'教程面向谁？',answer:'初学者'}])
})

test('pending model selection takes precedence over the default model', async () => {
  const f = fixture({ pending: {provider:'test',model:'new-selection'} })
  await f.rpc('optimize', payload)
  assert.equal(f.calls[0]!.model, 'new-selection')
})
test('TUI uses the new fork options instead of a seeded previous model header', async () => {
  const f = fixture({agentOptions:{provider:'test',model:'tui-new-model'},loggedRoute:{provider:'test',model:'old-history-model'}})
  await f.service.optimize(payload,new AbortController().signal,{routeSource:'agent-options'})
  assert.equal(f.calls[0]!.model,'tui-new-model')
  const status = await f.service.status('test-session',new AbortController().signal,{routeSource:'agent-options'})
  assert.equal(status.harness.model,'tui-new-model')
  const web = fixture({agentOptions:{provider:'test',model:'deployment-default'},loggedRoute:{provider:'test',model:'web-session-model'}})
  await web.rpc('optimize',payload)
  assert.equal(web.calls[0]!.model,'web-session-model')
})

test('invalid input and provider failure return safe errors without successful results', async () => {
  const f = fixture({failure:'AUTH'})
  assert.equal((await f.rpc('optimize', {...payload,prompt:' '})).result.error?.code,'empty-prompt')
  assert.equal(f.calls.length,0)
  const result = (await f.rpc('optimize',payload)).result
  assert.equal(result.ok,false)
  assert.equal(result.error?.code,'AUTH')
  assert.ok(!result.error?.message.includes('SECRET_DIAGNOSTIC'))
  assert.deepEqual(f.log, [])
})

test('cancelling a cold session resolution returns promptly and does not dispatch AI', async () => {
  let entered!: () => void
  const signal = new AbortController()
  const f = fixture({resolution:new Promise(() => {entered = () => signal.abort()})})
  const pending = f.rpc('optimize',payload,signal.signal)
  await new Promise(resolve => setImmediate(resolve))
  entered()
  const response = await pending
  assert.equal(response.result.error?.code,'cancelled')
  assert.equal(f.calls.length,0)
  assert.equal(f.log.length,0)
})
test('a stalled Harness stream still returns a timeout and releases the request slot', async () => {
  const f = fixture({stalledStream:true,timeoutMs:20})
  const response = await f.rpc('optimize',payload)
  assert.equal(response.result.error?.code,'timeout')
  assert.equal(f.calls.length,1)
  assert.equal(f.service.cancel(payload.requestId,payload.sessionId),false)
  assert.equal(f.submitted(),0)
  assert.deepEqual(f.log, [])
})

test('private optimization survives a real persistence cold reopen without changing chat events', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'prompt-optimizer-cold-'))
  const id = SessionId('test-session')
  const baseline = Session.create(id)
  const session = Session.create(id, undefined, { ...baseline.header, cwd: join(temporaryRoot, 'work') })
  session.append('session/title', { title: 'Cold restore test', messageSeqs: [], source: { kind: 'user' } })
  const before = session.snapshotEvents()
  const f = fixture({ session })
  const originalContext = new Context()
  const coldContext = new Context()
  try {
    await originalContext.plugin(Storage, { root: temporaryRoot, compression: 'zstd' }).await()
    const writer = await originalContext.sessionPersistence.create(session.header)
    try {
      assert.equal((await f.service.optimize(payload, new AbortController().signal)).optimizedPrompt, '面向初学者，写一篇逐步教程。')
      assert.deepEqual(session.snapshotEvents(), before, 'Optimization must not append a main message or an unknown plugin event')
      await writer.append(session.snapshotEvents())
      await writer.flush()
    } finally { await writer.close() }
    await originalContext.fiber.dispose()

    await coldContext.plugin(Storage, { root: temporaryRoot, compression: 'zstd' }).await()
    const reader = await coldContext.sessionPersistence.open(id, 'read')
    try {
      const restored = await reader.read()
      assert.deepEqual(restored.events, before)
      assert.equal(restored.events.length, 1)
      assert.equal(restored.events[0]!.type, 'session/title')
      assert.equal(reader.header.id, id)
    } finally { await reader.close() }
  } finally {
    await originalContext.fiber.dispose()
    await coldContext.fiber.dispose()
    // Remove only the verified temporary directory created by this test.
    assert.equal(dirname(resolve(temporaryRoot)), resolve(tmpdir()))
    assert.ok(basename(temporaryRoot).startsWith('prompt-optimizer-cold-'))
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})
