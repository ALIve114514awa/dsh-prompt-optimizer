const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function clean(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
}

function cells(value: string): number {
  const cp = value.codePointAt(0) ?? 0
  if (/^\p{Mark}/u.test(value)) return 0
  return value.includes('\ufe0f') || value.includes('\u200d') || cp >= 0x1f000
    || (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf)
    || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff)
    || (cp >= 0xfe10 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) ? 2 : 1
}

export function terminalLine(value: string, width: number): string {
  const normalized = clean(value).replace(/\n/g, ' ')
  const segments = [...graphemes.segment(normalized)].map(part => part.segment)
  if (segments.reduce((sum, segment) => sum + cells(segment), 0) <= width) return normalized
  let line = '', used = 0
  for (const segment of segments) {
    if (used + cells(segment) > Math.max(0, width - 1)) break
    line += segment
    used += cells(segment)
  }
  return `${line}…`
}

/** Wrap by terminal cells rather than UTF-16 length, including Chinese/emoji. */
export function terminalLines(value: string, width: number): string[] {
  const result: string[] = []
  for (const logicalLine of clean(value).split('\n')) {
    let line = '', used = 0
    for (const { segment } of graphemes.segment(logicalLine)) {
      const size = cells(segment)
      if (used && used + size > width) { result.push(line); line = ''; used = 0 }
      line += segment
      used += size
    }
    result.push(line)
  }
  return result
}

export interface TuiViewportOptions {
  columns: number; rows: number; title: string; text: string; cursor: number
  questionCount: number; answeredCount: number; changes: string[]; error: string
  busy: boolean; confirmApply: boolean
}

/** Keep the active editor and all actions visible, regardless of Q&A length. */
export function tuiViewport(options: TuiViewportOptions) {
  const width = Math.max(12, options.columns - 2)
  const editorWidth = Math.max(8, options.columns - 6)
  const allTitle = terminalLines(options.title, editorWidth)
  const title = allTitle.slice(0, 2)
  if (allTitle.length > 2) title[1] = terminalLine(`${title[1]}…`, editorWidth)
  const summary = options.questionCount ? terminalLine(`澄清问题：${options.answeredCount}/${options.questionCount} 已回答 · Ctrl+N/P 查看各输入栏`, width) : ''
  const changes = options.changes.length ? terminalLine(`修改：${options.changes.join(' · ')}`, width) : ''
  const error = terminalLine(options.error, width)
  const footer = [
    options.busy ? 'AI 处理中… Esc 取消请求。' : 'Ctrl+G 问答/生成 · Ctrl+R 直接生成',
    options.confirmApply ? '再次 Ctrl+S 追加草稿（保留已有文字）；Esc 返回。' : 'Ctrl+S 确认应用 · Esc 取消/关闭',
    'Ctrl+N/P 输入栏 · Ctrl+B 来源 · Ctrl+X 上下文 · Enter 换行',
    '仅追加到输入草稿，保留已有文字；不会发送消息。',
  ].flatMap(line => terminalLines(line, width))
  // Four header rows, two borders, and the bounded supporting information.
  const fixedRows = 4 + title.length + 2 + Number(Boolean(summary)) + Number(Boolean(changes)) + 1 + footer.length
  const editorHeight = Math.max(1, Math.min(12, options.rows - fixedRows))
  const cursor = Math.max(0, Math.min(options.text.length, options.cursor))
  const lines = terminalLines(`${options.text.slice(0, cursor)}▌${options.text.slice(cursor)}`, editorWidth)
  const caretLine = terminalLines(`${options.text.slice(0, cursor)}▌`, editorWidth).length - 1
  const from = Math.max(0, Math.min(lines.length - editorHeight, caretLine - Math.floor(editorHeight / 2)))
  const body = lines.slice(from, from + editorHeight)
  return { width, title, summary, changes, error, footer, body, renderedRows: fixedRows + body.length }
}
