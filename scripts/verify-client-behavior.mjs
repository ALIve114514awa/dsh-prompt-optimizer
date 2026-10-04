import assert from 'node:assert/strict'
import vm from 'node:vm'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { build } from 'esbuild'
import * as snapshotRuntime from '@deepseek-ai/dsh-client-store'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
async function load(entry, modules) {
  const built = await build({ absWorkingDir: root, entryPoints: [entry], bundle: true, packages: 'external', format: 'cjs', platform: 'browser', jsx: 'automatic', write: false })
  const module = { exports: {} }
  vm.runInNewContext(built.outputFiles[0].text, {
    module, exports: module.exports,
    require: name => { assert(name in modules, `Unexpected runtime dependency: ${name}`); return modules[name] },
    AbortController, setTimeout, clearTimeout, Error, console, crypto: { randomUUID },
  }, { timeout: 1000 })
  return module.exports
}

// Exercise the actual UI state engine with fake model replies. Answering and
// skipping remain local, and only an explicit generate action dispatches again.
const { OptimizerUi } = await load('src/client/state.ts', { '@deepseek-ai/dsh-client-store': snapshotRuntime })
const requests = []
const status = { harness: { available: true, model: 'test' }, codex: { available: false }, timeoutMs: 10000 }
const api = {
  status: async () => status,
  optimize: async request => {
    requests.push(request)
    return request.action === 'clarify'
      ? { stage: 'questions', backend: 'harness', optimizedPrompt: '', changes: [], questions: ['Audience?', 'Length?', 'Format?', 'Extra?'] }
      : { stage: 'result', backend: 'harness', optimizedPrompt: 'Edited preview', changes: [], questions: [] }
  },
  cancel: async () => true,
}
const origin = { sessionId: 'client-session', draft: 'vague prompt', draftRev: 7, hasReferences: false }
const ui = new OptimizerUi(origin.sessionId, api, key => key)
await ui.actions.checkStatus()
ui.actions.setSource(origin.draft)
await ui.actions.run('clarify', origin)
assert.equal(requests.length, 1)
assert.deepEqual(Array.from(ui.source.getSnapshot().questions), ['Audience?', 'Length?', 'Format?'])
ui.actions.answer(0, 'Beginners')
ui.actions.nextQuestion(false)
ui.actions.answer(1, 'discarded draft answer')
ui.actions.nextQuestion(true)
ui.actions.answer(2, 'Markdown')
ui.actions.nextQuestion(false)
assert.equal(ui.source.getSnapshot().questionIndex, 3)
assert.equal(requests.length, 1, 'Answer and skip must not call AI')
await ui.actions.run('generate', origin)
assert.deepEqual(JSON.parse(JSON.stringify(requests[1].answers)), [
  { question: 'Audience?', answer: 'Beginners' },
  { question: 'Length?', answer: '' },
  { question: 'Format?', answer: 'Markdown' },
])
assert.equal(requests[1].sessionId, origin.sessionId)
assert.equal(requests[1].includeContext, false)
ui.actions.setOutput('Manually edited preview')
assert.equal(ui.source.getSnapshot().output, 'Manually edited preview')
const otherUi = new OptimizerUi('another-session', api, key => key)
assert.equal(otherUi.source.getSnapshot().output, '', 'Sessions must not share preview state')
otherUi.dispose()
ui.dispose()

let resolveLate
let cancelled = 0
const cancelledUi = new OptimizerUi('cancelled-session', {
  ...api, optimize: () => new Promise(resolve => { resolveLate = resolve }),
  cancel: async () => { cancelled++; return true },
}, key => key)
cancelledUi.actions.setSource('late prompt')
const pending = cancelledUi.actions.run('generate', { ...origin, sessionId: 'cancelled-session' })
assert.equal(await cancelledUi.actions.cancel(), true)
resolveLate({ stage: 'result', backend: 'harness', optimizedPrompt: 'late reply', changes: [], questions: [] })
await pending
assert.equal(cancelledUi.source.getSnapshot().output, '')
assert.equal(cancelledUi.source.getSnapshot().busy, 'idle')
assert.equal(cancelled, 1)
cancelledUi.dispose()

// Inspect handlers from the real component using inert hook/JSX fixtures.
// Browser acceptance remains a separate check; this isolates draft write guards.
const jsx = (type, props) => ({ type, props })
const React = { useId: () => 'test', useRef: value => ({ current: value }), useEffect: () => {} }
const { PromptOptimizer } = await load('src/client/PromptOptimizer.tsx', {
  react: React, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: Symbol('fragment') },
})
function findApply(node) {
  if (!node || typeof node !== 'object') return undefined
  if (node.type === 'button' && node.props.children === 'apply') return node
  const children = node.props?.children
  for (const child of Array.isArray(children) ? children.flat(Infinity) : [children]) {
    const found = findApply(child)
    if (found) return found
  }
}
function fixture(overrides = {}) {
  const fixtureInput = { draft: origin.draft, draftRev: origin.draftRev, occurrences: [], phase: 'plain', ...overrides.input }
  const state = {
    source: origin.draft, backend: 'harness', mode: 'optimize', flow: 'direct', instructions: '', includeContext: false,
    output: 'Manually edited preview', result: { stage: 'result', optimizedPrompt: 'original model preview', changes: [], questions: [] },
    questions: [], answers: [], questionIndex: 0, stage: 'result', origin: { ...origin, ...overrides.origin },
    status, checking: false, busy: 'idle', error: '', statusError: '', notice: '', cancellationFailed: false,
    ...overrides.state,
  }
  const writes = [], errors = [], views = []
  let applied = 0
  const actions = { showError: text => errors.push(text), applied: () => applied++ }
  const inputActions = new Proxy({
    captureInsertion: () => ({ draftRev: overrides.capturedRevision ?? fixtureInput.draftRev }),
    insertText: (...args) => { writes.push(args); return overrides.insertSuccess !== false },
  }, { get(target, property) { assert(property in target, `Unexpected composer operation: ${String(property)}`); return target[property] } })
  const tree = PromptOptimizer({
    sessionId: overrides.sessionId ?? origin.sessionId,
    useInput: selector => selector(fixtureInput), inputActions,
    useOptimizer: selector => selector(state), optimizerActions: actions,
    closePanel: () => views.push(['chat']), t: key => key,
  })
  const button = findApply(tree)
  assert(button, 'Expected a preview apply button')
  button.props.onClick()
  return { writes, errors, views, applied }
}
const valid = fixture()
assert.deepEqual(JSON.parse(JSON.stringify(valid.writes)), [[
  'Manually edited preview', { start: 0, end: origin.draft.length, draftRev: origin.draftRev },
]])
assert.equal(valid.applied, 1)
assert.equal(valid.views[0][0], 'chat')
for (const blocked of [
  { sessionId: 'different-session' },
  { input: { draft: 'new draft' } },
  { input: { draftRev: 8 } },
  { capturedRevision: 8 },
  { input: { occurrences: [{}] } },
  { origin: { hasReferences: true } },
  { input: { phase: 'submitted' } },
]) {
  const checked = fixture(blocked)
  assert.equal(checked.writes.length, 0, `Blocked state wrote the draft: ${JSON.stringify(blocked)}`)
  assert.equal(checked.applied, 0)
  assert.equal(checked.views.length, 0)
}
const stale = fixture({ insertSuccess: false })
assert.deepEqual(Array.from(stale.errors), ['applyFailed'])
assert.equal(stale.applied, 0)
assert.equal(stale.views.length, 0)
assert.equal(fixture({ state: { output: '' } }).writes.length, 0)
console.log('Client behavior verified: three questions, answer/skip boundaries, explicit generation, late cancellation, session isolation, and draft/version/reference guards')
