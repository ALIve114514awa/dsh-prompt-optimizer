import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PromptOptimizerService } from '../src/server/index.js'
import type { OptimizeRequest, OptimizeResult } from '../src/shared/contracts.js'
import { TuiOptimizerFlow } from '../src/tui/flow.js'
import { editTerminalText } from '../src/tui/index.js'

function fixture() {
  const requests: OptimizeRequest[] = []
  const cancelled: string[] = []
  const routeSources: unknown[] = []
  let reply: OptimizeResult = { backend: 'harness', stage: 'questions', optimizedPrompt: '', changes: [], questions: ['交付格式？', '目标读者？'] }
  let pending: Promise<OptimizeResult> | undefined
  const service: PromptOptimizerService = {
    async status(_sessionId, _signal, options) {
      routeSources.push(options)
      return { harness: { available: true, model: 'example' }, codex: { available: false, reason: '未安装' } }
    },
    async optimize(request, _signal, options) {
      routeSources.push(options)
      requests.push(request as OptimizeRequest)
      return pending ?? reply
    },
    cancel(id) { cancelled.push(id); return true },
  }
  const flow = new TuiOptimizerFlow(service, 'session-a', '写一份说明')
  return { flow, requests, cancelled, routeSources, setReply(value: OptimizeResult) { reply = value }, setPending(value: Promise<OptimizeResult>) { pending = value } }
}

test('TUI first asks clarification, then carries each answer into the final generation', async () => {
  const f = fixture()
  await f.flow.refreshStatus()
  await f.flow.generate('clarify')
  assert.equal(f.flow.getSnapshot().phase, 'questions')
  f.flow.answer(0, 'Markdown')
  f.flow.answer(1, '初学者')
  f.setReply({ backend: 'harness', stage: 'result', optimizedPrompt: '为初学者编写 Markdown 说明。', changes: ['补充读者和格式'], questions: [] })
  await f.flow.generate('generate')
  assert.deepEqual(f.requests[1]?.answers, [{ question: '交付格式？', answer: 'Markdown' }, { question: '目标读者？', answer: '初学者' }])
  assert.equal(f.requests[0]?.includeContext, false)
  assert.equal(f.requests[0]?.action, 'clarify')
  assert.equal(f.requests[1]?.action, 'generate')
  assert.deepEqual(f.routeSources, [{ routeSource: 'agent-options' }, { routeSource: 'agent-options' }, { routeSource: 'agent-options' }])
  assert.equal(f.flow.applicationText('session-a'), '为初学者编写 Markdown 说明。')
})

test('editing the original or changing tabs invalidates an older preview', async () => {
  const f = fixture()
  f.setReply({ backend: 'harness', stage: 'result', optimizedPrompt: '结果', changes: [], questions: [] })
  await f.flow.generate('generate')
  f.flow.configure({ mode: 'concise' })
  assert.throws(() => f.flow.applicationText('session-a'), { code: 'stale-preview' })
  await f.flow.generate('generate')
  f.flow.edit('prompt', '新要求')
  assert.throws(() => f.flow.applicationText('session-a'), { code: 'stale-preview' })
})

test('manual preview edits are applied exactly and never target a different session', async () => {
  const f = fixture()
  f.setReply({ backend: 'harness', stage: 'result', optimizedPrompt: '结果', changes: [], questions: [] })
  await f.flow.generate('generate')
  f.flow.editPreview('手动编辑后的提示词\n第二行')
  assert.equal(f.flow.applicationText('session-a'), '手动编辑后的提示词\n第二行')
  assert.throws(() => f.flow.applicationText('session-b'), { code: 'session-changed' })
})

test('cancelled results arriving late cannot replace the current draft or leave the flow busy', async () => {
  const f = fixture()
  let resolve!: (result: OptimizeResult) => void
  f.setPending(new Promise(done => { resolve = done }))
  const generation = f.flow.generate('generate')
  f.flow.cancel()
  assert.equal(f.cancelled.length, 1)
  assert.equal(f.flow.getSnapshot().busy, false)
  f.flow.edit('prompt', '保留用户新草稿')
  resolve({ backend: 'harness', stage: 'result', optimizedPrompt: '迟到的结果', changes: [], questions: [] })
  await generation
  assert.equal(f.flow.getSnapshot().prompt, '保留用户新草稿')
  assert.equal(f.flow.getSnapshot().preview, '')
})

test('an unavailable source never starts an AI request', async () => {
  const f = fixture()
  await f.flow.refreshStatus()
  f.flow.configure({ backend: 'codex' })
  await f.flow.generate('generate')
  assert.equal(f.requests.length, 0)
  assert.equal(f.flow.getSnapshot().error, '未安装')
})

test('closing a scene preserves the preview and its manual edits for an explicit retry', async () => {
  const f = fixture()
  f.setReply({ backend: 'harness', stage: 'result', optimizedPrompt: '结果', changes: [], questions: [] })
  await f.flow.generate('generate')
  f.flow.editPreview('保留预览')
  f.flow.suspend()
  assert.equal(f.flow.applicationText('session-a'), '保留预览')
  await f.flow.refreshStatus()
  assert.equal(f.flow.applicationText('session-a'), '保留预览')
  assert.equal(f.requests.length, 1)
  f.flow.dispose()
  assert.throws(() => f.flow.applicationText('session-a'), { code: 'session-changed' })
})

test('source checking times out without relying on the Host promise settling', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let signal!: AbortSignal
  const service: PromptOptimizerService = {
    status(_sessionId, requestedSignal) { signal = requestedSignal; return new Promise(() => {}) },
    async optimize() { throw new Error('unexpected generation') },
    cancel() { return false },
  }
  const flow = new TuiOptimizerFlow(service, 'session-a')
  const checking = flow.refreshStatus()
  t.mock.timers.tick(15000)
  await checking
  assert.equal(signal.aborted, true)
  assert.match(flow.getSnapshot().error ?? '', /检查超时/)
  flow.dispose()
})

test('terminal editor keeps multiline pasted text, and deletes emoji as complete characters', () => {
  assert.deepEqual(editTerminalText('你好😀', 4, '', { backspace: true }), { text: '你好', cursor: 2 })
  assert.deepEqual(editTerminalText('第一行', 3, '\n第二行', { isPasted: true }), { text: '第一行\n第二行', cursor: 7 })
  assert.deepEqual(editTerminalText('a', 1, '\u001b[2J', { isPasted: true }), { text: 'a[2J', cursor: 4 })
})
