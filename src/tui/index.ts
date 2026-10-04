import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type ReactType from 'react'
import type { PromptOptimizerService } from '../server/index.js'
import type { OptimizeMode } from '../shared/contracts.js'
import { TuiOptimizerFlow } from './flow.js'
import { appendToTuiDraft } from './draft.js'
import { terminalLine, tuiViewport } from './layout.js'

export const name = 'prompt-optimizer-tui'
export const inject = ['tuiScenes', 'commands', 'promptOptimizer']

// Minimal structural projection of dsh-TUI 0.11.1's public scenes API. Keeping
// its React 19 / old Harness dependencies outside this type graph lets this
// adapter coexist with the Web client's React 18 and both Harness versions.
interface Key {
  ctrl?: boolean; meta?: boolean; shift?: boolean; tab?: boolean; escape?: boolean
  return?: boolean; backspace?: boolean; delete?: boolean; leftArrow?: boolean
  rightArrow?: boolean; home?: boolean; end?: boolean; isPasted?: boolean
}
interface SceneProps {
  React: typeof ReactType
  ui: {
    Box: ReactType.ElementType
    Text: ReactType.ElementType
    useInput(handler: (input: string, key: Key) => void): void
    useTerminalSize(): { columns: number; rows: number }
  }
  channel: {
    readonly sessionId: string
    notify(text: string, options?: { color?: string; timeoutMs?: number }): void
  }
  close(): void
}
interface SceneRuntime {
  register(descriptor: { id: string; title: string; component: (props: SceneProps) => ReactType.ReactElement }, identity?: Context): () => void
  open(id: string): boolean
}
interface CommandsRuntime {
  register(definition: {
    name: string; description: string; input: { hint: string }; recordInput: boolean
    handler(invocation: { agent: Agent; rawInput: string; signal: AbortSignal }): { kind: 'success'; text?: string } | { kind: 'error'; text: string }
  }): () => void
}
type TuiContext = Context & { tuiScenes: SceneRuntime; commands: CommandsRuntime; promptOptimizer: PromptOptimizerService }

export interface EditorResult { text: string; cursor: number }

/** Small multiline editor used only inside the plugin's scene. */
export function editTerminalText(text: string, cursor: number, input: string, key: Key, maxChars = 20000): EditorResult {
  cursor = Math.max(0, Math.min(text.length, cursor))
  const previous = cursor > 1 && /[\uDC00-\uDFFF]/.test(text[cursor - 1]!) ? cursor - 2 : Math.max(0, cursor - 1)
  const next = cursor < text.length && /[\uD800-\uDBFF]/.test(text[cursor]!) ? cursor + 2 : Math.min(text.length, cursor + 1)
  if (key.leftArrow) return { text, cursor: previous }
  if (key.rightArrow) return { text, cursor: next }
  if (key.home) return { text, cursor: text.lastIndexOf('\n', cursor - 1) + 1 }
  if (key.end) { const end = text.indexOf('\n', cursor); return { text, cursor: end < 0 ? text.length : end } }
  if (key.backspace) return { text: text.slice(0, previous) + text.slice(cursor), cursor: previous }
  if (key.delete) return { text: text.slice(0, cursor) + text.slice(next), cursor }
  const insertion = key.isPasted ? input : key.return ? '\n' : !key.ctrl && !key.meta ? input : ''
  const clean = insertion.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  if (!clean || text.length + clean.length > maxChars) return { text, cursor }
  return { text: text.slice(0, cursor) + clean + text.slice(cursor), cursor: cursor + clean.length }
}

export function apply(context: Context): void {
  const ctx = context as TuiContext
  const resolvedScenes = ctx.get('tuiScenes')
  const commands = ctx.get('commands')
  const resolvedService = ctx.get('promptOptimizer')
  if (!resolvedScenes || !commands || !resolvedService) return
  const scenes: SceneRuntime = resolvedScenes
  const service: PromptOptimizerService = resolvedService
  const lifecycle = new AbortController()
  let flow: TuiOptimizerFlow | undefined
  const timers = new Set<ReturnType<typeof setTimeout>>()
  ctx.effect(() => () => {
    lifecycle.abort()
    flow?.dispose()
    for (const timer of timers) clearTimeout(timer)
  })

  function Scene(props: SceneProps): ReactType.ReactElement {
    const { React, ui, channel } = props
    const { Box, Text } = ui
    // Other TUI extensions may open a registered scene by id directly.
    const current = flow ?? (flow = new TuiOptimizerFlow(service, channel.sessionId, '', ctx.get('agents')?.get(channel.sessionId as SessionId)))
    const state = React.useSyncExternalStore(current.subscribe, current.getSnapshot, current.getSnapshot)
    const [focus, setFocus] = React.useState(0)
    const [cursors, setCursors] = React.useState<Record<string, number>>({})
    const [confirmApply, setConfirmApply] = React.useState(false)
    const [notice, setNotice] = React.useState('')
    const mounted = React.useRef(true)
    const { columns, rows } = ui.useTerminalSize()
    React.useEffect(() => {
      mounted.current = true
      void current.refreshStatus()
      return () => { mounted.current = false; current.suspend() }
    }, [current])
    React.useEffect(() => { setConfirmApply(false) }, [state.preview, state.mode, state.backend])

    const fields = [
      { id: 'prompt', title: '原始提示词', value: state.prompt, max: 20000 },
      { id: 'instructions', title: '额外要求（可选）', value: state.instructions, max: 4000 },
      ...state.questions.map((question, index) => ({ id: `answer-${index}`, title: `问题 ${index + 1}：${question}`, value: state.answers[index] ?? '', max: 4000 })),
      ...state.phase === 'preview' ? [{ id: 'preview', title: '优化结果（可继续编辑）', value: state.preview, max: 30000 }] : [],
    ]
    const selected = fields[Math.min(focus, fields.length - 1)]!
    const cursor = Math.min(cursors[selected.id] ?? selected.value.length, selected.value.length)
    const run = (action: 'clarify' | 'generate') => {
      setConfirmApply(false)
      void current.generate(action).then(() => {
        if (!mounted.current) return
        const next = current.getSnapshot()
        if (next.phase === 'preview') setFocus(2 + next.questions.length)
        else if (next.phase === 'questions') setFocus(2)
      })
    }
    const applyPreview = () => {
      try {
        const text = current.applicationText(channel.sessionId)
        if (!confirmApply) { setConfirmApply(true); return }
        const sessionId = current.sessionId
        props.close()
        void appendToTuiDraft(sessionId, text, {
          signal: lifecycle.signal,
          stillCurrent: () => channel.sessionId === sessionId,
        }).then(() => channel.notify('已发送草稿追加请求，请检查输入框。尚未发送给聊天。', { color: 'success', timeoutMs: 5000 }))
          .catch(error => {
            if (lifecycle.signal.aborted) return
            channel.notify(error instanceof Error ? error.message : '未能追加草稿，请重新打开预览。', { color: 'error', timeoutMs: 8000 })
            if (channel.sessionId === sessionId && flow === current) scenes.open('prompt-optimizer')
          })
      } catch (error) { setNotice(error instanceof Error ? error.message : '当前结果不可应用。') }
    }
    ui.useInput((input, key) => {
      if (key.escape) {
        if (state.busy) current.cancel()
        else if (confirmApply) setConfirmApply(false)
        else props.close()
        return
      }
      if (key.ctrl && input.toLowerCase() === 's') { applyPreview(); return }
      if (state.busy) return
      setNotice('')
      if (key.tab) {
        const modes: OptimizeMode[] = ['optimize', 'expand', 'concise']
        const index = modes.indexOf(state.mode)
        current.configure({ mode: modes[(index + (key.shift ? 2 : 1)) % modes.length]! })
        return
      }
      if (key.ctrl) {
        switch (input.toLowerCase()) {
          case 'g': run(state.phase === 'questions' ? 'generate' : 'clarify'); return
          case 'r': run('generate'); return
          case 'b': current.configure({ backend: state.backend === 'harness' ? 'codex' : 'harness' }); return
          case 'x': current.configure({ includeContext: !state.includeContext }); return
          case 'n': setFocus((Math.min(focus, fields.length - 1) + 1) % fields.length); return
          case 'p': setFocus((Math.min(focus, fields.length - 1) + fields.length - 1) % fields.length); return
        }
      }
      const edited = editTerminalText(selected.value, cursor, input, key, selected.max)
      setCursors(previous => ({ ...previous, [selected.id]: edited.cursor }))
      if (edited.text === selected.value) return
      setConfirmApply(false)
      if (selected.id === 'prompt' || selected.id === 'instructions') current.edit(selected.id, edited.text)
      else if (selected.id === 'preview') current.editPreview(edited.text)
      else current.answer(Number(selected.id.slice(7)), edited.text)
    })

    const el = React.createElement
    const modes = { optimize: '智能优化', expand: '扩写', concise: '精简' }
    const viewport = tuiViewport({
      columns, rows, title: `${Math.min(focus, fields.length - 1) + 1}. ${selected.title}`, text: selected.value, cursor,
      questionCount: state.questions.length, answeredCount: state.answers.filter(answer => answer.trim()).length,
      changes: state.result?.changes ?? [], error: state.error ?? notice,
      busy: state.busy, confirmApply,
    })
    const heading = el(Text, { bold: true, color: 'accent' }, '提示词优化')
    const modeRow = el(Text, {}, terminalLine(`Tab 切换：${Object.entries(modes).map(([id, label]) => id === state.mode ? `[${label}]` : label).join('  ')}`, viewport.width))
    const source = state.status?.[state.backend]
    const info = el(Text, { color: 'subtle' }, terminalLine(`来源：${state.backend === 'harness' ? 'Harness AI' : 'Codex'}${source?.model ? ` · ${source.model}` : ''}  上下文：${state.includeContext ? '上一轮已结束对话' : '仅当前提示词'}`, viewport.width))
    const navigation = el(Text, { color: 'subtle' }, `输入栏 ${Math.min(focus, fields.length - 1) + 1}/${fields.length} · Ctrl+N/P 切换`)
    const editor = el(Box, { flexDirection: 'column', borderStyle: 'round', borderColor: 'accent', paddingX: 1, flexShrink: 0 },
      el(Text, { bold: true, color: 'accent' }, viewport.title.join('\n')),
      el(Text, {}, viewport.body.join('\n')))
    return el(Box, { flexDirection: 'column', width: '100%', paddingX: 1 }, heading, modeRow, info, navigation,
      ...viewport.summary ? [el(Text, { color: 'subtle' }, viewport.summary)] : [], editor,
      ...viewport.changes ? [el(Text, { color: 'subtle' }, viewport.changes)] : [],
      el(Text, { color: state.error || notice ? 'error' : 'subtle' }, viewport.error || ' '),
      ...viewport.footer.map((line, index) => el(Text, { key: `action-${index}`, bold: confirmApply && line.includes('Ctrl+S'), color: confirmApply && line.includes('Ctrl+S') ? 'warning' : 'subtle' }, line)))
  }

  const releaseScene = scenes.register({ id: 'prompt-optimizer', title: '提示词优化', component: Scene }, ctx)
  ctx.effect(() => releaseScene)
  const releaseCommand = commands.register({
    name: 'prompt-optimize', description: '优化提示词：澄清问题、编辑预览，再追加到未发送的草稿。',
    input: { hint: '需要优化的模糊提示词（可留空后在面板填写）' }, recordInput: false,
    handler(invocation) {
      if (invocation.signal.aborted) return { kind: 'error', text: '命令已取消。' }
      const sessionId = invocation.agent.session.id
      const prompt = invocation.rawInput.trim()
      if (!flow || flow.sessionId !== sessionId || prompt) {
        flow?.dispose()
        flow = new TuiOptimizerFlow(service, sessionId, prompt, invocation.agent)
      }
      // Let command success consume only its own slash-command draft before
      // opening the full-screen scene; it never submits the prompt to the model.
      const timer = setTimeout(() => {
        timers.delete(timer)
        if (!lifecycle.signal.aborted) scenes.open('prompt-optimizer')
      }, 30)
      timers.add(timer)
      return { kind: 'success' }
    },
  })
  ctx.effect(() => releaseCommand)
}
