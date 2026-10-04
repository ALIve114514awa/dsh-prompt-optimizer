import assert from 'node:assert/strict'
import { test } from 'node:test'
import { terminalLine, terminalLines, tuiViewport } from '../src/tui/layout.js'

test('long clarification and change explanations do not hide actions in a 24-line terminal', () => {
  const result = tuiViewport({
    columns: 76, rows: 22, title: `问题 3：${'详细说明需要交付的内容与格式。'.repeat(20)}`,
    text: '回答的具体内容。'.repeat(30), cursor: 200,
    questionCount: 5, answeredCount: 3, changes: ['说明优化原因。'.repeat(60)], error: '',
    busy: false, confirmApply: true,
  })
  assert.ok(result.renderedRows <= 22)
  assert.ok(result.title.length <= 2)
  assert.ok(result.body.some(line => line.includes('▌')))
  assert.match(result.footer.join('\n'), /再次 Ctrl\+S/)
  assert.match(result.footer.join('\n'), /Esc 返回/)
  assert.match(result.footer.join('\n'), /不会发送消息/)
})

test('a wrapped preview scrolls to its caret at the manually edited end', () => {
  const text = `${'中文😀长预览'.repeat(100)}\n用户编辑的末尾`
  const result = tuiViewport({ columns: 76, rows: 22, title: '优化结果', text, cursor: text.length,
    questionCount: 0, answeredCount: 0, changes: [], error: '', busy: false, confirmApply: false })
  assert.ok(result.renderedRows <= 22)
  assert.match(result.body.join('\n'), /用户编辑的末尾▌/)
})

test('terminal wrapping respects Chinese and intact emoji clusters', () => {
  assert.deepEqual(terminalLines('中文😀abc', 6), ['中文😀', 'abc'])
  assert.equal(terminalLine('中文😀abc', 6), '中文…')
  assert.deepEqual(terminalLines('👨‍👩‍👧‍👦a', 2), ['👨‍👩‍👧‍👦', 'a'])
})
