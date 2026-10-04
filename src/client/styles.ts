/** Scoped styles consume the application's existing light/dark theme tokens. */
export const styles = `
.dsh-prompt-tool-page { box-sizing: border-box; width: 100%; max-width: 100%; min-width: 0; min-height: 0; height: 100%; overflow: auto; overflow-x: hidden; scrollbar-gutter: stable; }
.dsh-prompt-tool-page-content { box-sizing: border-box; width: min(100%, 1040px); min-width: 0; margin: 0 auto; padding: 14px 18px 12px; padding-inline-start: max(18px, var(--dsh-frame-leading-clearance, 0px)); }
/* Public footer slot is a horizontal action seat; use rows when our entry is present. */
div:has(> [data-slot="sidebar.footer.action"] > .dsh-prompt-sidebar-button) { flex-direction: column; }
.dsh-prompt-sidebar-button { box-sizing: border-box; display: flex; align-items: center; gap: 10px; width: 100%; min-height: 38px; padding: 8px 10px; border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; text-align: left; cursor: pointer; }
.dsh-prompt-sidebar-button:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-prompt-sidebar-button svg { flex-shrink: 0; }
.dsh-prompt-sidebar-button[data-wide=false] { width: 36px; height: 36px; padding: 8px; justify-content: center; align-self: center; }
.dsh-prompt-sidebar-button:focus-visible { outline: 2px solid var(--dsw-focus-ring-color); outline-offset: -2px; }
.dsh-prompt-tool-empty { max-width: 520px; margin: 72px auto; padding: 24px; padding-inline-start: max(24px, var(--dsh-frame-leading-clearance, 0px)); }
.dsh-prompt-tool-empty h2 { margin: 0 0 12px; font-size: 20px; }
.dsh-prompt-tool-empty p { margin: 0 0 20px; color: var(--dsw-alias-label-secondary); }
.dsh-prompt-tool-page-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 10px; }
.dsh-prompt-tool-page-header h2 { margin: 0 0 6px; font-size: 18px; font-weight: 600; }
.dsh-prompt-tool-page-header p { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-prompt-tool-flow { max-width: 430px; margin-bottom: 8px; }
.dsh-prompt-tool-question-panel { padding: 17px; margin-top: 16px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
.dsh-prompt-tool-question-panel h3 { margin: 0 0 14px; font-size: 14px; }
.dsh-prompt-tool-question { display: block; margin: 0 0 12px; font-size: 15px; font-weight: 500; }
.dsh-prompt-tool-answer-summary { margin: 0; }
.dsh-prompt-tool-answer-summary div + div { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--dsw-alias-border-l2); }
.dsh-prompt-tool-answer-summary dt { margin: 0 0 5px; font-weight: 500; }
.dsh-prompt-tool-answer-summary dd { margin: 0; color: var(--dsw-alias-label-secondary); white-space: pre-wrap; }
.dsh-prompt-tool-page-footer { position: sticky; z-index: 1; bottom: 0; padding: 10px 0; margin-top: 10px; border-top: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-base); }
.dsh-prompt-tool { color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-family); font-size: 13px; line-height: 1.5; }
.dsh-prompt-tool *, .dsh-prompt-tool-footer * { box-sizing: border-box; }
.dsh-prompt-tool button, .dsh-prompt-tool input, .dsh-prompt-tool textarea { font: inherit; }
.dsh-prompt-tool-controls { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); gap: 12px; margin-bottom: 8px; }
.dsh-prompt-tool-label { display: block; margin: 0 0 7px; color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 600; }
.dsh-prompt-tool-options { display: flex; gap: 5px; padding: 3px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }
.dsh-prompt-tool-option { flex: 1; min-width: 0; min-height: 32px; padding: 5px 8px; border: 0; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; white-space: nowrap; }
.dsh-prompt-tool-option:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-prompt-tool-option[aria-checked=true] { background: var(--dsw-alias-button-elevated-fill); color: var(--dsw-alias-label-primary); box-shadow: var(--dsw-elevation-soft); font-weight: 600; }
.dsh-prompt-tool-option:disabled { opacity: .45; cursor: default; }
.dsh-prompt-tool-caption { min-height: 16px; margin: 4px 0 0; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.dsh-prompt-tool-extra { margin-bottom: 8px; }
.dsh-prompt-tool-optional { margin-left: 7px; color: var(--dsw-alias-label-tertiary); font-weight: 400; }
.dsh-prompt-tool-instructions { display: block; width: 100%; min-height: 42px; max-height: 100px; padding: 7px 9px; resize: vertical; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
.dsh-prompt-tool-instructions::placeholder, .dsh-prompt-tool-editor::placeholder { color: var(--dsw-alias-label-tertiary); }
.dsh-prompt-tool-context { display: flex; align-items: start; gap: 8px; margin-bottom: 10px; cursor: pointer; }
.dsh-prompt-tool-context input { margin: 3px 0 0; accent-color: var(--dsw-alias-brand-primary); }
.dsh-prompt-tool-context small { display: block; margin-top: 2px; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.dsh-prompt-tool-comparison { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; }
.dsh-prompt-tool-column { display: flex; min-width: 0; flex-direction: column; background: var(--dsw-alias-bg-layer-1); }
.dsh-prompt-tool-column + .dsh-prompt-tool-column { border-left: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-base); }
.dsh-prompt-tool-column-header { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 10px 13px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.dsh-prompt-tool-column-header strong { font-size: 12px; font-weight: 600; }
.dsh-prompt-tool-count { color: var(--dsw-alias-label-tertiary); font-size: 11px; font-variant-numeric: tabular-nums; }
.dsh-prompt-tool-editor { display: block; width: 100%; min-width: 0; min-height: 150px; height: clamp(150px, 24vh, 240px); padding: 10px; resize: vertical; border: 0; border-radius: 0; background: transparent; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.65; }
.dsh-prompt-tool-editor[readonly] { color: var(--dsw-alias-label-secondary); }
.dsh-prompt-tool-column-hint { padding: 5px 13px 10px; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.dsh-prompt-tool-notice { margin: 12px 0 0; padding: 9px 11px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font-size: 12px; overflow-wrap: anywhere; }
.dsh-prompt-tool-notice[data-kind=error] { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-secondary); }
.dsh-prompt-tool-notice[data-kind=warning] { color: var(--dsw-alias-state-warn-label); }
.dsh-prompt-tool-progress { display: inline-flex; align-items: center; gap: 7px; color: var(--dsw-alias-label-secondary); }
.dsh-prompt-tool-progress svg { width: 14px; height: 14px; animation: dsh-prompt-tool-spin 1s linear infinite; }
.dsh-prompt-tool-details { margin-top: 12px; padding: 0 2px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-prompt-tool-details summary { cursor: pointer; }
.dsh-prompt-tool-details ul { margin: 7px 0 0; padding-left: 20px; }
.dsh-prompt-tool-details li + li { margin-top: 4px; }
.dsh-prompt-tool-details[data-kind=questions] { color: var(--dsw-alias-state-warn-label); }
.dsh-prompt-tool-footer { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 12px; color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-family); font-size: 12px; }
.dsh-prompt-tool-footer-note { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.dsh-prompt-tool-footer-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 8px; }
.dsh-prompt-tool-button { display: inline-flex; justify-content: center; align-items: center; gap: 6px; min-height: 34px; padding: 7px 11px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-button-elevated-fill); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; cursor: pointer; }
.dsh-prompt-tool-button:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-prompt-tool-button[data-primary=true] { border-color: var(--dsw-alias-button-primary-fill); background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); font-weight: 600; }
.dsh-prompt-tool-button[data-primary=true]:hover { background: var(--dsw-alias-button-primary-hover); }
.dsh-prompt-tool-button:disabled { opacity: .45; cursor: default; }
.dsh-prompt-tool-status-retry { padding: 0; margin-left: 6px; border: 0; background: transparent; color: var(--dsw-alias-link); text-decoration: underline; cursor: pointer; }
.dsh-prompt-tool :focus-visible, .dsh-prompt-tool-footer :focus-visible { outline: 2px solid var(--dsw-focus-ring-color); outline-offset: 2px; }
@keyframes dsh-prompt-tool-spin { to { transform: rotate(360deg); } }
@media (max-width: 680px) {
  .dsh-prompt-tool-page-content { padding: 16px 12px 20px; }
  .dsh-prompt-tool-page-header { flex-direction: column; gap: 10px; margin-bottom: 16px; }
  .dsh-prompt-tool-page-footer { bottom: 0; }
  .dsh-prompt-tool-controls, .dsh-prompt-tool-comparison { grid-template-columns: minmax(0, 1fr); }
  .dsh-prompt-tool-controls { gap: 12px; }
  .dsh-prompt-tool-column + .dsh-prompt-tool-column { border-left: 0; border-top: 1px solid var(--dsw-alias-border-l2); }
  .dsh-prompt-tool-editor { min-height: 150px; height: 170px; }
  .dsh-prompt-tool-footer { align-items: flex-start; flex-direction: column; }
  .dsh-prompt-tool-footer-actions { width: 100%; }
  .dsh-prompt-tool-footer-note { align-self: flex-start; }
}
@media (prefers-reduced-motion: reduce) { .dsh-prompt-tool-progress svg { animation: none; } }
`
