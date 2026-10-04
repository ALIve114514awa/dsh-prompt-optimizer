import { createConnection } from 'node:net'
import { homedir } from 'node:os'
import { posix } from 'node:path'
import { OptimizerError } from '../shared/contracts.js'

export function tuiDraftSocketPath(sessionId: string, platform: NodeJS.Platform = process.platform, home = homedir()): string {
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(sessionId)) throw new OptimizerError('invalid-session', 'TUI 会话标识无效。')
  return platform === 'win32' ? `\\\\.\\pipe\\dsh-tui-inject-${sessionId}` : posix.join(home, '.dsh-tui', 'inject', `${sessionId}.sock`)
}

function waitForComposer(delayMs: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * dsh-TUI 0.11.1 exposes append-only draft injection. Send exactly one append
 * request; never send command.execute or prompt.submit, and never retry a write
 * without acknowledgement (a retry could duplicate the user's draft).
 */
export async function appendToTuiDraft(
  sessionId: string,
  text: string,
  options: { stillCurrent: () => boolean; signal: AbortSignal; delayMs?: number; socketPath?: string },
): Promise<void> {
  options.signal.throwIfAborted()
  if (!options.stillCurrent()) throw new OptimizerError('session-changed', '聊天已切换，未追加优化结果。')
  const path = options.socketPath ?? tuiDraftSocketPath(sessionId)
  // The scene owns the whole screen. Let its close commit remount the host's
  // composer before sending to the documented external injection endpoint.
  await waitForComposer(options.delayMs ?? 120, options.signal)
  if (!options.stillCurrent()) throw new OptimizerError('session-changed', '聊天已切换，未追加优化结果。')
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ path })
    let settled = false
    let finished = false
    const cleanup = () => {
      clearTimeout(timer)
      options.signal.removeEventListener('abort', onAbort)
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      socket.destroy()
      reject(error)
    }
    const onAbort = () => { fail(options.signal.reason) }
    const timer = setTimeout(() => fail(new OptimizerError('draft-unavailable', 'TUI 草稿追加接口未响应，请保留预览后重试。')), 2500)
    options.signal.addEventListener('abort', onAbort, { once: true })
    socket.once('error', () => fail(new OptimizerError('draft-unavailable', 'TUI 草稿接口不可用，未追加结果。请保留预览后重试。')))
    socket.once('connect', () => {
      if (options.signal.aborted) return onAbort()
      if (!options.stillCurrent()) return fail(new OptimizerError('session-changed', '聊天已切换，未追加优化结果。'))
      socket.end(`${JSON.stringify({ type: 'prompt.append', text })}\n`)
    })
    socket.once('finish', () => {
      finished = true
    })
    socket.once('close', () => {
      if (settled) return
      if (!finished) return fail(new OptimizerError('draft-unavailable', 'TUI 草稿接口提前关闭，请保留预览后重试。'))
      settled = true
      cleanup()
      resolve()
    })
  })
}
