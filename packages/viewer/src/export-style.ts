import { viewerStyle } from './viewer-style';

/** Shared shell for HTML exported by the browser and CLI. The SVG carries its own fonts and theme;
 * both follow the reader's color scheme. */
export const offlineViewerStyle = viewerStyle + `
:root{--surface:var(--zf-surface);--border:var(--zf-border);--muted:var(--zf-muted);--focus:var(--zf-focus);--hover:#477de512;--space-2:8px;--radius:6px;color-scheme:light;--zf-page:#f4f6f9;--zf-text:#203044;--zf-surface:#fff;--zf-border:#8192a466;--zf-muted:#52657d;--zf-focus:#477de5;--zf-badge-surface:#fff;--zf-badge-ink:#52657d}
*{box-sizing:border-box}
body{margin:0;height:100dvh;display:flex;flex-direction:column;background:var(--zf-page);color:var(--zf-text);font:15px system-ui,sans-serif}
header{overflow-wrap:anywhere;padding:16px 24px;border-bottom:1px solid var(--zf-border);font-size:20px}
header h1{margin:0;font:inherit;font-weight:bold}
main{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;padding:16px 24px}
button{font:inherit;line-height:20px;min-height:36px;padding:7px 10px;border:1px solid var(--zf-border);border-radius:6px;background:var(--zf-surface);color:inherit;cursor:pointer}
button:not(:disabled):hover{background:#477de512}
button:disabled{opacity:.6;cursor:default}
button:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
footer{padding:10px 24px;color:var(--zf-muted);font-size:12px}
.zf-stage-area{grid-template-columns:max-content minmax(0,1fr)}
.zf-search-trigger{grid-row:2;grid-column:2;align-self:center;justify-self:end;min-width:0;max-width:100%}
.zf-stage .zf-search-selected{outline:3px solid var(--zf-focus);outline-offset:4px}
.zf-search{width:min(640px,calc(100vw - 24px));max-height:calc(100dvh - 24px);padding:20px;border:1px solid var(--zf-border);border-radius:12px;background:var(--zf-surface);color:var(--zf-text);overflow:auto}
.zf-search::backdrop{background:#0006}
.zf-search-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}
.zf-search h2{margin:0;font-size:20px}
.zf-search input{width:100%;min-height:40px;padding:8px 10px;border:1px solid var(--zf-border);border-radius:6px;background:var(--zf-page);color:inherit;font:inherit}
.zf-search input:focus-visible{outline:2px solid var(--zf-focus);outline-offset:2px}
.zf-search p{font-size:13px;color:var(--zf-muted)}
.zf-search ul{list-style:none;padding:0;margin:0;display:grid;gap:6px}
.zf-search li button{display:block;width:100%;text-align:left;overflow-wrap:anywhere}
.zf-search strong,.zf-search small{display:block}
.zf-search small{margin-top:4px;color:var(--zf-muted)}
@media(prefers-color-scheme:dark){:root{color-scheme:dark;--zf-page:#111722;--zf-text:#e4eaf2;--zf-surface:#182231;--zf-muted:#adbbcd;--zf-badge-surface:#182231;--zf-badge-ink:#adbbcd}.zf-stage{background:#0a0f25}}
@media(max-width:999px){header{padding:10px 16px}main{padding:8px 16px}footer{padding:8px 16px}}
@media(max-height:500px){header{padding:6px 16px;font-size:16px}footer{display:none}main{padding:4px 16px}}
`;
