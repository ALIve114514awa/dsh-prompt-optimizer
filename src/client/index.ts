import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createOptimizerApi } from './api.js'
import { PromptOptimizer } from './PromptOptimizer.js'
import { PromptMainPanel, PromptSidebarButton, PromptSessionArea } from './placement.js'
import { OptimizerUi, PROMPT_VIEW_ID } from './state.js'
import { en, zh } from './locales.js'
import { styles } from './styles.js'

export const inject = ['slots', 'connection', 'locale', 'conversation', 'sessions', 'layout']

export function apply(ctx: Context): void {
  ctx.effect(() => {
    const element = document.createElement('style')
    element.dataset.plugin = 'dsh-prompt-optimizer'
    element.textContent = styles
    document.head.appendChild(element)
    return () => element.remove()
  })
  ctx.effect(() => ctx.locale.register('promptOptimizer', { zh, en }))
  const optimizerApi = createOptimizerApi(ctx)
  const t = ctx.locale.bind('promptOptimizer')
  const sessions = new Map<string, OptimizerUi>()
  const uiFor = (sessionId: SessionId) => {
    const existing = sessions.get(sessionId)
    if (existing) return existing
    const ui = new OptimizerUi(sessionId, optimizerApi, t)
    sessions.set(sessionId, ui)
    const binding = ctx.sessions.binding(sessionId)
    binding?.ctx.effect(() => () => {
      ui.dispose()
      if (sessions.get(sessionId) === ui) sessions.delete(sessionId)
    }, 'prompt-optimizer: Session view state')
    return ui
  }
  ctx.effect(() => () => { for (const ui of sessions.values()) ui.dispose(); sessions.clear() })

  const closePanel = () => ctx.layout.selectPanel(null)
  // A global main panel has its own navigation entry, while its private child
  // slots receive the renderer's current Session sources for safe draft edits.
  ctx.slots.inject('main', function* () {
    yield ctx.slots.register({
      name: 'main', key: PROMPT_VIEW_ID,
      children: { 'promptOptimizer.sessionArea': { kind: 'single', scope: 'session-maybe' } },
    }, PromptMainPanel)
    yield ctx.slots.register({
      name: 'promptOptimizer.sessionArea', locale: 'promptOptimizer',
      children: { 'promptOptimizer.editor': { kind: 'single', scope: 'session' } },
      inject: () => ({ closePanel }),
    }, PromptSessionArea)
    yield ctx.slots.register({
      name: 'promptOptimizer.editor', locale: 'promptOptimizer',
      inject: sessionId => {
        const ui = uiFor(sessionId)
        return { hooks: { optimizer: ui.source }, optimizerActions: ui.actions, closePanel }
      },
    }, PromptOptimizer)
  })
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: PROMPT_VIEW_ID, order: -100, locale: 'promptOptimizer',
    inject: () => ({ openPanel: () => ctx.layout.selectPanel(PROMPT_VIEW_ID as MainPanelId) }),
  }, PromptSidebarButton))
}
