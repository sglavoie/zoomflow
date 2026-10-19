/** Shared shell for HTML exported by the browser and CLI. The SVG carries its own fonts and theme. */
export const offlineViewerStyle = `
:root{color-scheme:light;--zf-page:#f4f6f9;--zf-text:#203044;--zf-surface:#fff;--zf-border:#8192a466;--zf-muted:#52657d;--zf-focus:#477de5}
*{box-sizing:border-box}
body{margin:0;height:100dvh;min-height:500px;display:flex;flex-direction:column;background:var(--zf-page);color:var(--zf-text);font:15px system-ui,sans-serif}
header{padding:16px 24px;border-bottom:1px solid var(--zf-border);font-size:20px}
main{flex:1;min-height:0;display:flex;flex-direction:column;padding:16px 24px}
.zf-breadcrumbs{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-height:36px}
button{font:inherit;line-height:20px;min-height:36px;padding:7px 10px;border:1px solid var(--zf-border);border-radius:6px;background:var(--zf-surface);color:inherit;cursor:pointer}
button:not(:disabled):hover{background:#477de512}
button:disabled{opacity:.6;cursor:default}
button:focus-visible,.zf-stage:focus-visible,.zf-stage a:focus-visible{outline:2px solid var(--zf-focus);outline-offset:2px}
.zf-breadcrumbs button{background:transparent;border-color:transparent;color:var(--zf-muted)}
.zf-breadcrumbs button[aria-current]{font-weight:700;color:inherit;background:#477de512}
.zf-context{padding:8px 0;font-size:13px;line-height:1.5;overflow-wrap:anywhere}
.zf-message{min-height:26px;padding:6px 0;color:#a73539}
.zf-visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.zf-stage-area{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;gap:8px}
.zf-stage{position:relative;flex:1;min-height:0;display:grid;place-items:center;overflow:hidden;border:1px solid var(--zf-border);border-radius:10px;background:var(--zf-surface)}
.zf-stage>svg{display:block;width:100%;height:100%;max-width:100%;max-height:100%;touch-action:none}
.zf-stage a,.zf-stage [data-shape-id]{cursor:pointer}
.zf-stage a[data-missing]{outline:2px dashed #d64e52}
.zf-link-hint{position:absolute;top:12px;left:12px;max-width:calc(100% - 24px);padding:6px 10px;border-radius:6px;background:#203044;color:#fff;font-size:12px;pointer-events:none;overflow-wrap:anywhere}
.zf-link-hint[hidden]{display:none}
.zf-stage a:not([data-missing]):hover{outline:2px solid var(--zf-focus);outline-offset:3px}
.zf-stage.zf-panning{cursor:grabbing}
.zf-stage.zf-pan-ready *,.zf-stage.zf-pan-ready{cursor:grab!important}
.zf-stage.zf-panning *,.zf-stage.zf-panning{cursor:grabbing!important}
.zf-zoom-controls{align-self:flex-start;display:flex;align-items:center;gap:2px;padding:2px;border:1px solid var(--zf-border);border-radius:8px;background:var(--zf-surface)}
.zf-zoom-controls button{border:0;min-width:36px;min-height:32px;padding:5px;background:transparent}
.zf-zoom-controls span{min-width:44px;text-align:center;font-size:12px}
footer{padding:10px 24px;color:var(--zf-muted);font-size:12px}
@media(max-width:600px){header{padding:10px 16px}main{padding:8px 16px}.zf-stage-area{min-height:320px;display:flex;flex-direction:column;gap:6px}.zf-zoom-controls{position:static;align-self:flex-start;box-shadow:none}footer{padding:10px 16px}}
`;
