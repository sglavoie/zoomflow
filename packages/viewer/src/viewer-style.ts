/** Canvas, navigation and controls shared by the workspace and standalone HTML. */
export const viewerStyle = `
/* One violet accent connects a detail node, its preview and the breadcrumb inside it. */
.zf-detail-link, .zf-detail-crumb { --zf-detail-accent: #8272b4; }
.zf-depth-sheet { pointer-events: none; transform: translate(4px, -4px); opacity: .7; }
.zf-depth-2 { transform: translate(8px, -8px); opacity: .4; }
.zf-depth-sheet > * { fill: var(--surface, #fff); stroke: var(--zf-detail-accent); stroke-width: 1; }
.zf-detail-link { --zf-badge-ink: var(--zf-detail-accent); }
.zf-detail-link:is(:hover, :focus-visible) .zf-depth-1 { transform: translate(6px, -6px); opacity: .9; }
.zf-detail-link:is(:hover, :focus-visible) .zf-depth-2 { transform: translate(12px, -12px); opacity: .6; }
.zf-breadcrumbs .zf-detail-crumb[aria-current] { box-shadow: inset 0 -2px var(--zf-detail-accent); }
@media (prefers-reduced-motion: no-preference) { .zf-depth-sheet { transition: transform 160ms ease-out, opacity 160ms ease-out; } }

.zf-breadcrumbs { display: flex; align-items: center; flex-wrap: nowrap; gap: var(--space-2); min-height: 36px; flex-shrink: 0; min-width: 0; }
.zf-breadcrumbs > button { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zf-breadcrumbs > button:first-child { flex-shrink: 0; max-width: 22%; }
.zf-breadcrumbs > button:first-child[aria-current] { max-width: 100%; }
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
.zf-message:not(:has(> :not(:empty))) { min-height: 12px; padding: 0; }
.zf-message > [role="alert"] { color: #d64e52; }
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
/* Badges keep their screen size while board viewports shrink with zoom. Clip at the stage only. */
.zf-stage svg svg { overflow: visible; }
.zf-stage a { cursor: pointer; }
.zf-layer-label { fill: var(--muted, #52657d); }
.zf-layer-connectors { pointer-events: none; }
.zf-stage a:focus-visible { outline: 2px solid var(--focus); }
/* Chromium outlines focused SVG links by default, even when focus came from the mouse. */
.zf-stage a:where(:focus:not(:focus-visible)) { outline: none; }
.zf-stage a[data-missing] { outline: 2px dashed #d64e52; }
.zf-link-hint { position: absolute; top: 12px; left: 12px; max-width: calc(100% - 24px); padding: 6px 10px; border-radius: var(--radius); background: #203044; color: #fff; font-size: 12px; pointer-events: none; overflow-wrap: anywhere; }
.zf-pan-hint { grid-row: 3; grid-column: 1 / -1; font-size: 12px; color: var(--muted); }
.zf-zoom-controls button svg { display: block; margin: auto; }
.zf-zoom-controls .zf-fit { display: flex; align-items: center; gap: 5px; padding-inline: 8px; font-size: 12px; }
.zf-zoom-controls .zf-fit svg { margin: 0; }
@media (pointer: coarse) {
  .zf-zoom-controls button { min-width: 44px; min-height: 44px; }
}
.zf-link-hint[hidden], .zf-pan-hint[hidden], .zf-context[hidden] { display: none; }
.zf-stage a:not(.zf-detail-link):not([data-missing]):not(:has(> .zf-canvas-selected)):hover > g:not(.appendix-icon) { filter: drop-shadow(0 0 2px var(--focus)); }
.zf-stage[data-link-preview] .zf-link-hint { display: none; }
.zf-stage-area:has(.zf-stage[data-link-preview="pointer"]) .zf-pan-hint { visibility: hidden; }
.zf-board-snapshot { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; pointer-events: none; }
.zf-return-highlight { position: absolute; pointer-events: none; border: 2px solid var(--focus, #477de5); border-radius: 12px; }
.zf-walkthrough { grid-row: 3; grid-column: 1 / -1; min-width: 0; padding: 12px 16px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); font-size: 13px; }
.zf-walkthrough[hidden] { display: none; }
.zf-walkthrough-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-weight: 600; }
.zf-walkthrough-heading button:not(.zf-present-toggle) { padding: 0; min-width: 32px; min-height: 32px; font-size: 20px; background: transparent; border: 0; }
.zf-walkthrough p { margin: 2px 0 10px; color: var(--muted); }
.zf-walkthrough-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.zf-walkthrough-actions button { font-size: 13px; max-width: 100%; overflow-wrap: anywhere; }
.zf-walkthrough-toolbar { padding: 6px 0; }
.zf-walkthrough-current { filter: drop-shadow(0 0 4px var(--focus)); }
.zf-walkthrough-muted { opacity: .22; }
.zf-stage-area:has(.zf-stage[data-walkthrough]) > :is(.zf-pan-hint, .board-selection, .canvas-coach, .canvas-insert, .canvas-connections) { display: none; }
.zf-walkthrough-trigger[aria-pressed="true"] { color: var(--focus); background: var(--hover); }
@media (prefers-reduced-motion: no-preference) { .zf-walkthrough-muted, .zf-walkthrough-path { transition: opacity 160ms ease-out; } }

.zf-walkthrough-heading > div { display: flex; align-items: center; gap: 8px; }
.zf-present-toggle { font-size: 12px; font-weight: 500; }
.zf-stage-area[data-presentation] { position: fixed; inset: 0; z-index: 1000; padding: 20px; background: var(--surface); display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); }
.zf-stage-area[data-presentation] > .zf-stage { grid-area: 1 / 1; border: 0; border-radius: 0; }
.zf-stage-area[data-presentation] > :not(.zf-stage, .zf-walkthrough, .zf-present-title) { display: none; }
.zf-stage-area[data-presentation] > .zf-walkthrough { grid-area: 1 / 1; z-index: 2; align-self: end; justify-self: center; width: max-content; max-width: min(680px, 100%); box-shadow: 0 10px 40px #20304420; padding: 12px 18px; }
.zf-stage-area[data-presentation] .zf-walkthrough p { font-size: 12px; margin-block: 4px 10px; }
.zf-stage-area[data-presentation] .zf-walkthrough-actions { justify-content: center; }
@media (max-width: 599px) { .zf-stage-area[data-presentation] { padding: 10px; } .zf-stage-area[data-presentation] > .zf-walkthrough { padding: 10px 12px; } }

.zf-present-title { grid-area: 1 / 1; align-self: start; justify-self: start; padding: 18px; z-index: 2; pointer-events: none; max-width: min(640px, 100%); overflow-wrap: anywhere; }
.zf-present-title[hidden] { display: none; }
.zf-present-title strong { display: block; font-size: 22px; letter-spacing: -.025em; }
.zf-present-title span { display: block; font-size: 14px; color: var(--muted); margin-top: 6px; }
`;
