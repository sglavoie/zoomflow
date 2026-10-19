/** Canvas, navigation and controls shared by the workspace and standalone HTML. */
export const viewerStyle = `
.zf-breadcrumbs { display: flex; align-items: center; flex-wrap: nowrap; gap: var(--space-2); min-height: 36px; flex-shrink: 0; min-width: 0; }
.zf-breadcrumbs > button { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zf-breadcrumbs > button:first-child { flex-shrink: 0; max-width: 22%; }
.zf-breadcrumbs > .zf-ancestor-toggle { flex-shrink: 0; }
.zf-crumb-separator { flex-shrink: 0; color: var(--muted); }
.zf-ancestor-menu { position: fixed; z-index: 50; width: min(300px, calc(100vw - 16px)); overflow-y: auto; padding: 6px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); box-shadow: 0 8px 28px #20304426; }
.zf-ancestor-menu[hidden] { display: none; }
.zf-ancestor-menu button { display: block; width: 100%; text-align: left; overflow-wrap: anywhere; }
.zf-breadcrumbs button[aria-current] { font-weight: bold; }
.zf-breadcrumbs button { background: transparent; border-color: transparent; color: var(--muted); }
.zf-breadcrumbs button[aria-current] { color: inherit; background: var(--hover); }
.zf-context { padding-top: 8px; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
.zf-message { min-height: 26px; padding: 6px 0; }
.zf-message:empty { min-height: 12px; padding: 0; }
.zf-message[role="alert"] { color: #d64e52; }
.zf-stage-area { position: relative; flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-rows: minmax(0, 1fr) minmax(40px, max-content); gap: var(--space-2); }
.zf-zoom-controls { grid-row: 2; grid-column: 1; justify-self: start; align-self: center; display: flex; align-items: center; gap: 2px; padding: 2px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
.zf-zoom-controls button { border: 0; min-width: 36px; min-height: 32px; padding: 5px; background: transparent; }
.zf-zoom-controls span { min-width: 44px; text-align: center; font-size: 12px; }
.zf-stage > svg { touch-action: none; }
.zf-stage.zf-panning { cursor: grabbing; }
.zf-stage.zf-pan-ready *, .zf-stage.zf-pan-ready { cursor: grab !important; }
.zf-stage.zf-panning *, .zf-stage.zf-panning { cursor: grabbing !important; }
.zf-visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.zf-stage { grid-column: 1 / -1; position: relative; flex: 1; min-height: 0; overflow: hidden; display: grid; place-items: center; border: 1px solid #8192a433; border-radius: 10px; background: var(--surface); }
.zf-stage:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
.zf-stage > svg { display: block; width: 100%; height: 100%; max-width: 100%; max-height: 100%; }
.zf-stage a { cursor: pointer; }
.zf-stage a:focus { outline: 2px solid var(--focus); }
.zf-stage a[data-missing] { outline: 2px dashed #d64e52; }
.zf-link-hint { position: absolute; top: 12px; left: 12px; max-width: calc(100% - 24px); padding: 6px 10px; border-radius: var(--radius); background: #203044; color: #fff; font-size: 12px; pointer-events: none; overflow-wrap: anywhere; }
.zf-pan-hint { grid-row: 3; grid-column: 1 / -1; font-size: 12px; color: var(--muted); }
.zf-zoom-controls button svg { display: block; margin: auto; }
@media (pointer: coarse) {
  .zf-zoom-controls button { min-width: 44px; min-height: 44px; }
}
.zf-link-hint[hidden], .zf-pan-hint[hidden], .zf-context[hidden] { display: none; }
.zf-stage a:not([data-missing]):hover { outline: 2px solid var(--focus); outline-offset: 3px; }
`;
