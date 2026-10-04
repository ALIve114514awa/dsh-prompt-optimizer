import * as React from 'react'
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from './locales.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'promptOptimizer.sessionArea': { kind: 'single'; scope: 'session-maybe' }
    'promptOptimizer.editor': { kind: 'single'; scope: 'session' }
  }
}

type MainProps = PropsRuntime<'main'> & PropsRenderSlots<'promptOptimizer.sessionArea'>
type SessionAreaProps = PropsRuntime<'promptOptimizer.sessionArea'> & PropsRenderSlots<'promptOptimizer.editor'> & PropsLocale<'promptOptimizer'> & { closePanel(): void }

function PromptPanelIcon({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m8.5 3 1.6 4.9L15 9.5l-4.9 1.6L8.5 16l-1.6-4.9L2 9.5l4.9-1.6L8.5 3Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" /><path d="m15.8 2 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z" fill="currentColor" /></svg>
}

export function PromptSidebarButton({ wide, openPanel, t }: PropsRuntime<'sidebar.footer.action'> & PropsLocale<'promptOptimizer'> & { openPanel(): void }) {
  return <button type="button" className="dsh-prompt-sidebar-button" data-wide={wide} title={t('toolbar')} aria-label={t('toolbar')} onClick={openPanel}>
    <PromptPanelIcon size={18} />{wide && <span>{t('toolbar')}</span>}
  </button>
}

/** Session scope resolves through the renderer, just as in the native main panel. */
export function PromptMainPanel({ renderSlot }: MainProps) {
  return renderSlot('promptOptimizer.sessionArea', {})
}

export function PromptSessionArea({ sessionId, renderSlot, closePanel, t }: SessionAreaProps) {
  if (sessionId !== undefined) return renderSlot('promptOptimizer.editor', {})
  return <section className="dsh-prompt-tool-page dsh-prompt-tool" aria-label={t('title')}>
    <div className="dsh-prompt-tool-empty">
      <h2>{t('title')}</h2><p>{t('noSession')}</p>
      <button className="dsh-prompt-tool-button" type="button" onClick={closePanel}>{t('backToChat')}</button>
    </div>
  </section>
}
