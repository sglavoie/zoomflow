import { viewerStyle } from './viewer-style';

/** Shared shell for HTML exported by the browser and CLI. The SVG carries its own fonts and theme. */
export const offlineViewerStyle = viewerStyle + `
:root{--surface:var(--zf-surface);--border:var(--zf-border);--muted:var(--zf-muted);--focus:var(--zf-focus);--hover:#477de512;--space-2:8px;--radius:6px;color-scheme:light;--zf-page:#f4f6f9;--zf-text:#203044;--zf-surface:#fff;--zf-border:#8192a466;--zf-muted:#52657d;--zf-focus:#477de5}
*{box-sizing:border-box}
body{margin:0;height:100dvh;display:flex;flex-direction:column;background:var(--zf-page);color:var(--zf-text);font:15px system-ui,sans-serif}
header{overflow-wrap:anywhere;padding:16px 24px;border-bottom:1px solid var(--zf-border);font-size:20px}
main{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;padding:16px 24px}
button{font:inherit;line-height:20px;min-height:36px;padding:7px 10px;border:1px solid var(--zf-border);border-radius:6px;background:var(--zf-surface);color:inherit;cursor:pointer}
button:not(:disabled):hover{background:#477de512}
button:disabled{opacity:.6;cursor:default}
button:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
footer{padding:10px 24px;color:var(--zf-muted);font-size:12px}
@media(max-width:999px){header{padding:10px 16px}main{padding:8px 16px}footer{padding:8px 16px}}
@media(max-height:500px){header{padding:6px 16px;font-size:16px}footer{display:none}main{padding:4px 16px}}
`;
