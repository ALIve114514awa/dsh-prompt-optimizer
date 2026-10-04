import * as React from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { Backend, OptimizeMode } from '../shared/contracts.js'
import type { ComposerOrigin, OptimizerInjected } from './state.js'
import type {} from './locales.js'

type PromptPageProps = PropsRuntime<'promptOptimizer.editor'> & PropsLocale<'promptOptimizer'> & InjectFace<OptimizerInjected> & { closePanel(): void }

function ProgressIcon() {
  return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M16.6 10A6.6 6.6 0 1 1 10 3.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
}

/** A sidebar tool panel. It never sends or submits a main-session message. */
export function PromptOptimizer({ sessionId, useInput, inputActions, useOptimizer, optimizerActions: actions, closePanel, t }: PromptPageProps) {
  const input = useInput(state => state)
  const state = useOptimizer(value => value)
  const id = React.useId()
  const sourceRef = React.useRef<HTMLTextAreaElement>(null)
  const busy = state.busy !== 'idle'
  const available = state.status?.[state.backend]
  const canGenerate = !!state.source.trim() && !busy && !state.cancellationFailed && !state.checking && !!available?.available
  const currentQuestion = state.questions[state.questionIndex]

  React.useEffect(() => { if (!state.status && !state.checking) void actions.checkStatus() }, [actions])
  React.useEffect(() => { sourceRef.current?.focus() }, [])

  const captureOrigin = (): ComposerOrigin => ({
    sessionId, draft: input.draft, draftRev: inputActions.captureInsertion().draftRev, hasReferences: input.occurrences.length > 0,
  })

  function applyBlockReason() {
    const origin = state.origin
    if (!origin) return ''
    if (sessionId !== origin.sessionId) return t('sessionChanged')
    if (origin.hasReferences || input.occurrences.length > 0) return t('referenceWarning')
    if (input.draftRev !== origin.draftRev || input.draft !== origin.draft) return t('draftChanged')
    if (input.phase !== 'plain') return t('inputLocked')
    return ''
  }
  const blocked = applyBlockReason()

  const apply = () => {
    const origin = state.origin
    if (!origin || busy || !state.output.trim()) return
    const reason = applyBlockReason()
    if (reason || inputActions.captureInsertion().draftRev !== origin.draftRev) {
      actions.showError(reason || t('draftChanged'))
      return
    }
    if (!inputActions.insertText(state.output, { start: 0, end: origin.draft.length, draftRev: origin.draftRev })) {
      actions.showError(t('applyFailed'))
      return
    }
    actions.applied()
    closePanel()
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(state.output); actions.showNotice(t('copied')) }
    catch (error) { actions.showError(t('copyFailed', { message: error instanceof Error ? error.message : String(error) })) }
  }
  const back = async () => {
    if (state.busy === 'stopping') return
    if ((busy || state.cancellationFailed) && !await actions.cancel()) return
    closePanel()
  }

  function radioKeyboard<T extends string>(event: React.KeyboardEvent<HTMLButtonElement>, values: readonly T[], value: T, select: (value: T) => void, enabled: (value: T) => boolean = () => true) {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1
    let next = values.indexOf(value)
    for (let count = 0; count < values.length; count++) {
      next = (next + direction + values.length) % values.length
      if (enabled(values[next]!)) {
        select(values[next]!)
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus()
        return
      }
    }
  }
  const backends: readonly Backend[] = ['harness', 'codex']
  const modes: readonly OptimizeMode[] = ['optimize', 'expand', 'concise']
  const flows = ['guided', 'direct'] as const
  const backendCaption = state.checking ? t('checking') : available?.available
    ? available.model ? t('model', { model: available.model }) : '' : available?.reason || (state.status ? t('unavailable') : '')

  return <section className="dsh-prompt-tool-page" aria-label={t('title')}>
    <div className="dsh-prompt-tool dsh-prompt-tool-page-content">
      <header className="dsh-prompt-tool-page-header"><div><h2>{t('title')}</h2><p>{t('description')}</p></div>
        <button className="dsh-prompt-tool-button" type="button" disabled={busy} onClick={() => actions.useComposer(captureOrigin())}>{t('useDraft')}</button>
      </header>
      <div className="dsh-prompt-tool-controls">
        <div><span className="dsh-prompt-tool-label" id={`${id}-backend`}>{t('backend')}</span>
          <div className="dsh-prompt-tool-options" role="radiogroup" aria-labelledby={`${id}-backend`}>
            {backends.map(value => <button className="dsh-prompt-tool-option" key={value} type="button" role="radio" aria-checked={state.backend === value} tabIndex={state.backend === value ? 0 : -1}
              disabled={busy || state.status?.[value].available === false} title={state.status?.[value].reason} onClick={() => actions.setBackend(value)}
              onKeyDown={event => radioKeyboard(event, backends, value, actions.setBackend, choice => state.status?.[choice].available !== false)}>{t(value)}</button>)}
          </div><p className="dsh-prompt-tool-caption" aria-live="polite">{backendCaption}</p>
        </div>
        <div><span className="dsh-prompt-tool-label" id={`${id}-mode`}>{t('mode')}</span>
          <div className="dsh-prompt-tool-options" role="radiogroup" aria-labelledby={`${id}-mode`}>
            {modes.map(value => <button className="dsh-prompt-tool-option" key={value} type="button" role="radio" aria-checked={state.mode === value} tabIndex={state.mode === value ? 0 : -1} disabled={busy}
              onClick={() => actions.setMode(value)} onKeyDown={event => radioKeyboard(event, modes, value, actions.setMode)}>{t(value)}</button>)}
          </div><p className="dsh-prompt-tool-caption">{t(`${state.mode}Hint`)}</p>
        </div>
      </div>
      <div className="dsh-prompt-tool-flow"><span className="dsh-prompt-tool-label" id={`${id}-flow`}>{t('workflow')}</span>
        <div className="dsh-prompt-tool-options" role="radiogroup" aria-labelledby={`${id}-flow`}>
          {flows.map(value => <button className="dsh-prompt-tool-option" key={value} type="button" role="radio" aria-checked={state.flow === value} tabIndex={state.flow === value ? 0 : -1} disabled={busy}
            onClick={() => actions.setFlow(value)} onKeyDown={event => radioKeyboard(event, flows, value, actions.setFlow)}>{t(value)}</button>)}
        </div><p className="dsh-prompt-tool-caption">{t(state.flow === 'guided' ? 'guidedHint' : 'directHint')}</p>
      </div>
      <div className="dsh-prompt-tool-extra"><label className="dsh-prompt-tool-label" htmlFor={`${id}-instructions`}>{t('instructions')}<span className="dsh-prompt-tool-optional">{t('optional')}</span></label>
        <textarea className="dsh-prompt-tool-instructions" id={`${id}-instructions`} value={state.instructions} placeholder={t('instructionsPlaceholder')} maxLength={4000} disabled={busy} rows={2} onChange={event => actions.setInstructions(event.target.value)} />
      </div>
      <label className="dsh-prompt-tool-context"><input type="checkbox" checked={state.includeContext} disabled={busy} onChange={event => actions.setIncludeContext(event.target.checked)} />
        <span>{t('includeContext')}<small>{t(state.includeContext ? 'contextOn' : 'contextOff')}</small></span>
      </label>
      <div className="dsh-prompt-tool-comparison" aria-busy={busy}>
        <div className="dsh-prompt-tool-column"><div className="dsh-prompt-tool-column-header"><strong id={`${id}-source`}>{t('original')}</strong><span className="dsh-prompt-tool-count">{t('characters', { count: state.source.length })}</span></div>
          <textarea ref={sourceRef} className="dsh-prompt-tool-editor" aria-labelledby={`${id}-source`} value={state.source} placeholder={t('sourcePlaceholder')} disabled={busy} maxLength={60_000} onChange={event => actions.setSource(event.target.value)} />
          <div className="dsh-prompt-tool-column-hint">{t('originalHint')}</div>
        </div>
        <div className="dsh-prompt-tool-column"><div className="dsh-prompt-tool-column-header"><strong id={`${id}-result`}>{t('result')}</strong><span className="dsh-prompt-tool-count">{t('characters', { count: state.output.length })}</span></div>
          <textarea className="dsh-prompt-tool-editor" aria-labelledby={`${id}-result`} value={state.output} placeholder={t(busy ? 'generatingPlaceholder' : 'resultPlaceholder')} readOnly={busy || !state.result} onChange={event => actions.setOutput(event.target.value)} />
          <div className="dsh-prompt-tool-column-hint">{state.result?.model ? t('model', { model: state.result.model }) : t('resultHint')}</div>
        </div>
      </div>
      {state.flow === 'guided' && state.stage === 'questions' && <section className="dsh-prompt-tool-question-panel" aria-label={t('questions')}>
        {currentQuestion ? <>
          <p className="dsh-prompt-tool-label">{t('questionProgress', { current: state.questionIndex + 1, total: state.questions.length })}</p>
          <label className="dsh-prompt-tool-question" htmlFor={`${id}-answer`}>{currentQuestion}</label>
          <textarea id={`${id}-answer`} className="dsh-prompt-tool-instructions" value={state.answers[state.questionIndex] || ''} disabled={busy} maxLength={4000} rows={3} placeholder={t('answerPlaceholder')} onChange={event => actions.answer(state.questionIndex, event.target.value)} />
          <p className="dsh-prompt-tool-caption">{t('answersHint')}</p>
        </> : <><h3>{t('answersReady')}</h3><dl className="dsh-prompt-tool-answer-summary">{state.questions.map((question, index) => <div key={index}><dt>{question}</dt><dd>{state.answers[index]?.trim() || t('skipped')}</dd></div>)}</dl><p className="dsh-prompt-tool-caption">{t('answersHint')}</p></>}
      </section>}
      {busy && <p className="dsh-prompt-tool-progress" role="status"><ProgressIcon />{t(state.busy === 'stopping' ? 'stopping' : 'generating')}</p>}
      {state.statusError && <p className="dsh-prompt-tool-notice" data-kind="error" role="alert">{state.statusError}<button type="button" className="dsh-prompt-tool-status-retry" disabled={state.checking || busy} onClick={() => { void actions.checkStatus() }}>{t('statusRetry')}</button></p>}
      {blocked && state.output && <p className="dsh-prompt-tool-notice" data-kind="warning" role="status">{blocked}</p>}
      {state.error && <p className="dsh-prompt-tool-notice" data-kind="error" role="alert">{state.error}</p>}
      {state.notice && <p className="dsh-prompt-tool-notice" role="status">{state.notice}</p>}
      {!!state.result?.changes.length && <details className="dsh-prompt-tool-details"><summary>{t('changes')}</summary><ul>{state.result.changes.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
      {!!state.result?.questions.length && <details className="dsh-prompt-tool-details" data-kind="questions" open><summary>{t('questions')}</summary><ul>{state.result.questions.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
      <footer className="dsh-prompt-tool-footer dsh-prompt-tool-page-footer"><p className="dsh-prompt-tool-footer-note">{t('previewOnly')}</p>
        <div className="dsh-prompt-tool-footer-actions">
          <button className="dsh-prompt-tool-button" type="button" disabled={state.busy === 'stopping'} onClick={() => { void back() }}>{t('backToChat')}</button>
          {busy || state.cancellationFailed ? <button className="dsh-prompt-tool-button" type="button" disabled={state.busy === 'stopping'} onClick={() => { void actions.cancel() }}>{t('stop')}</button>
            : state.flow === 'guided' && state.stage === 'questions' && currentQuestion ? <>
              {state.questionIndex > 0 && <button className="dsh-prompt-tool-button" type="button" onClick={actions.previousQuestion}>{t('previousQuestion')}</button>}
              <button className="dsh-prompt-tool-button" type="button" onClick={() => actions.nextQuestion(true)}>{t('skipQuestion')}</button>
              <button className="dsh-prompt-tool-button" type="button" data-primary="true" onClick={() => actions.nextQuestion(false)}>{t(state.questionIndex + 1 === state.questions.length ? 'finishAnswers' : 'nextQuestion')}</button>
            </> : <>
              {state.flow === 'guided' && state.questions.length > 0 && <button className="dsh-prompt-tool-button" type="button" onClick={actions.askAgain}>{t('editAnswers')}</button>}
              <button className="dsh-prompt-tool-button" type="button" data-primary={!state.result} disabled={!canGenerate} onClick={() => { void actions.run(state.flow === 'guided' && state.stage === 'compose' ? 'clarify' : 'generate', captureOrigin()) }}>
                {t(state.result ? 'regenerate' : state.flow === 'guided' ? state.stage === 'compose' ? 'ask' : 'generateWithAnswers' : 'generatePrompt')}
              </button>
              {state.result && <button className="dsh-prompt-tool-button" type="button" disabled={!state.output.trim()} onClick={() => { void copy() }}>{t('copy')}</button>}
              {state.result && <button className="dsh-prompt-tool-button" type="button" data-primary="true" disabled={!state.origin || !state.output.trim() || !!blocked} title={blocked || undefined} onClick={apply}>{t('apply')}</button>}
            </>}
        </div>
      </footer>
    </div>
  </section>
}
