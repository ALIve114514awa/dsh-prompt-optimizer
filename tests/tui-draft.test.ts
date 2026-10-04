import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { appendToTuiDraft, tuiDraftSocketPath } from '../src/tui/draft.js'

test('draft injection sends only one prompt.append message and never sends a chat command', async () => {
  const id = randomUUID()
  const socketPath = process.platform === 'win32' ? `\\\\.\\pipe\\prompt-optimizer-test-${id}` : join(tmpdir(), `prompt-optimizer-${id}.sock`)
  let received = ''
  let receive!: () => void
  const done = new Promise<void>(resolve => { receive = resolve })
  const server = createServer(socket => {
    socket.setEncoding('utf8')
    socket.on('data', chunk => { received += chunk })
    socket.on('end', receive)
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve) })
  try {
    await appendToTuiDraft('same-session', '优化结果\n完整内容', { socketPath, delayMs: 0, stillCurrent: () => true, signal: new AbortController().signal })
    await done
    const messages = received.trim().split('\n').map(line => JSON.parse(line))
    assert.deepEqual(messages, [{ type: 'prompt.append', text: '优化结果\n完整内容' }])
    assert.ok(!received.includes('command.execute'))
    assert.ok(!received.includes('prompt.submit'))
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})

test('a changed session or cancelled apply sends no draft injection', async () => {
  await assert.rejects(appendToTuiDraft('same-session', 'result', { delayMs: 0, stillCurrent: () => false, signal: new AbortController().signal }), { code: 'session-changed' })
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(appendToTuiDraft('same-session', 'result', { delayMs: 0, stillCurrent: () => true, signal: controller.signal }), { name: 'AbortError' })
})

test('session changes while the composer remounts are checked again before opening a socket', async () => {
  let reads = 0
  await assert.rejects(appendToTuiDraft('same-session', 'result', {
    delayMs: 0, stillCurrent: () => ++reads === 1, signal: new AbortController().signal,
  }), { code: 'session-changed' })
  assert.equal(reads, 2)
})

test('an unavailable socket returns a recoverable error without retrying', async () => {
  const missing = process.platform === 'win32' ? `\\\\.\\pipe\\missing-prompt-optimizer-${randomUUID()}` : join(tmpdir(), `missing-${randomUUID()}.sock`)
  await assert.rejects(appendToTuiDraft('same-session', 'result', {
    socketPath: missing, delayMs: 0, stillCurrent: () => true, signal: new AbortController().signal,
  }), { code: 'draft-unavailable' })
})

test('socket coordinates match the installed TUI protocol and reject path traversal', () => {
  assert.equal(tuiDraftSocketPath('session-a', 'win32'), '\\\\.\\pipe\\dsh-tui-inject-session-a')
  assert.equal(tuiDraftSocketPath('session-a', 'linux', '/home/test'), '/home/test/.dsh-tui/inject/session-a.sock')
  assert.throws(() => tuiDraftSocketPath('../another-session'), { code: 'invalid-session' })
})
