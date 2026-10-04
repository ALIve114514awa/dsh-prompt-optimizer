import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import * as host from '../lib/index.js'
import * as tui from '../lib/tui.js'

// In-memory registration acceptance test: real Cordis and Connection, no app
// startup, model request, network listener, user profile, or credentials.
const ctx = new Context()
const scenes = new Map()
const commands = new Map()
const failSend = () => { throw new Error('A registration/status check must never send a chat message or call AI') }
async function settle(predicate) {
  const until = Date.now() + 2000
  while (!predicate()) {
    assert(Date.now() < until, 'Cordis dependency transition did not settle')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

try {
  const tuiFiber = ctx.plugin(tui)
  const hostFiber = ctx.plugin(host, {})
  await Promise.all([tuiFiber.await(), hostFiber.await()])
  assert.equal(hostFiber.state, 0)
  assert.equal(tuiFiber.state, 0)
  assert.equal(ctx.get('promptOptimizer'), undefined)

  const uiFiber = ctx.plugin({ name: 'registration-test-tui', apply(owner) {
    owner.provide('tuiScenes', {
      register(scene) { scenes.set(scene.id, scene); return () => scenes.delete(scene.id) },
      open() { return true },
    })
    owner.provide('commands', {
      register(command) { commands.set(command.name, command); return () => commands.delete(command.name) },
    })
  } })
  await uiFiber.await()
  assert.equal(tuiFiber.state, 0, 'TUI must wait for the Host service')

  const coreFiber = ctx.plugin({ name: 'registration-test-core', apply(owner) {
    owner.provide('sessionController', {
      resolveAgent: async () => ({ agent: {
        options: { provider: 'test', model: 'registration-model' },
        session: { id: 'registration-session', header: { cwd: 'D:/example' }, requestHeader: () => undefined },
        inbox: { submit: failSend },
      } }),
      submit: failSend,
    })
    owner.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'test', model: 'registration-model' }) })
    owner.provide('llm', { listProviders: () => [{ id: 'test' }], stream: failSend })
  } })
  await coreFiber.await()
  await settle(() => hostFiber.state === 2 && tuiFiber.state === 2)
  assert.equal(typeof ctx.get('promptOptimizer').optimize, 'function')
  assert.deepEqual([...scenes.keys()], ['prompt-optimizer'])
  assert.deepEqual([...commands.keys()], ['prompt-optimize'])
  assert.equal(commands.get('prompt-optimize').recordInput, false)

  let connection
  const connectionFiber = ctx.plugin({ name: 'registration-test-connection', apply(owner) {
    connection = new HostConnectionService(owner, [], { isAuthenticated: () => true })
  } })
  await connectionFiber.await()
  await settle(() => connection.fetchRoutes.size === 3)
  assert.deepEqual([...connection.fetchRoutes.keys()], [
    '/api/promptOptimizer/status', '/api/promptOptimizer/optimize', '/api/promptOptimizer/cancel',
  ])
  const handler = connection.createSharedFetchHandler('/api')
  const response = await handler.fetch(new Request('http://localhost/api/promptOptimizer/status', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'registration-check', method: 'promptOptimizer/status', payload: { sessionId: 'registration-session' } }),
  }))
  const status = await response.json()
  assert.equal(status.result.ok, true)
  assert.equal(status.result.value.harness.model, 'registration-model')
  assert.equal(status.result.value.codex.available, false)
  assert.equal((await handler.fetch(new Request('http://localhost/api/promptOptimizer/status'))).status, 404)

  await hostFiber.dispose()
  await settle(() => tuiFiber.state === 0 && connection.fetchRoutes.size === 0)
  assert.equal(ctx.get('promptOptimizer'), undefined)
  assert.equal(scenes.size, 0)
  assert.equal(commands.size, 0)
  assert.equal((await handler.fetch(new Request('http://localhost/api/promptOptimizer/status', { method: 'POST' }))).status, 404)
  console.log('Runtime registration verified: delayed Host/TUI DI, real Connection exact routes, status RPC, and disposal')
} finally {
  await ctx.fiber.dispose()
}
