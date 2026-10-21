import { viewerStyle, type ViewerRoute } from '@zoomflow/viewer';
import { setupExamplePicker } from './example-picker';
import './style.css';
import { createCompiler } from './compiler';
import { setupReference } from './reference';
import { setupSplit, type SplitAxis } from './source-split';
import { setupViewportHeight } from './mobile-view';
import { setupShortcuts } from './shortcuts';
import { setupFlowBuilder } from './flow-builder';
import { createDocumentPane, type DocumentPane, type PaneContext, type PaneId } from './document-pane';
import { cloneSecondPane, nameParts, paneScope } from './pane-scope';
import { findEngineNotice } from './engine-notice';
import { setupExportMenu } from './export-menu';
import { setupFileOpen } from './file-open';

const canvasStyle = document.createElement('style');
canvasStyle.textContent = viewerStyle;
document.head.prepend(canvasStyle);
const workspace = document.querySelector<HTMLElement>('#workspace')!;
const paneRoots: Record<PaneId, HTMLElement> = {
  a: document.querySelector<HTMLElement>('#pane-a')!,
  b: document.querySelector<HTMLElement>('#pane-b')!,
};
const paneDivider = document.querySelector<HTMLElement>('#pane-divider')!;

/** The second pane is a copy of the first pane's untouched markup with its own element IDs.
 * The D2 reference stays a single panel that opens in the active pane.
 */
function secondPaneMarkup() {
  nameParts(paneRoots.a);
  const copy = cloneSecondPane(paneRoots.a, ['#d2-reference', '#reference-divider']);
  for (const [part, label] of [['preview-pane', 'Second diagram'], ['viewer', 'Second live preview'],
    ['source-pane', 'Second source editor'], ['mobile-view-switch', 'Second document view']]) {
    copy.querySelector(`[data-part="${part}"]`)!.setAttribute('aria-label', label);
  }
  return [...copy.childNodes];
}
const secondPane = secondPaneMarkup();

setupShortcuts();
const narrow = matchMedia('(max-width: 999px)');
const roomy = matchMedia('(min-width: 1400px)');
setupViewportHeight(narrow);
function restorePreference(select: HTMLSelectElement, key: string) {
  try {
    const saved = localStorage.getItem(key);
    if ([...select.options].some((option) => option.value === saved)) select.value = saved!;
  } catch { /* Preferences are optional when storage is unavailable. */ }
  select.addEventListener('change', () => { try { localStorage.setItem(key, select.value); } catch { /* Optional storage. */ } });
}

const panes: Partial<Record<PaneId, DocumentPane>> = {};
let active: PaneId = 'a';
const activePane = () => panes[active]!;
const otherPane = (pane: PaneId): PaneId => pane === 'a' ? 'b' : 'a';
const exportMenu = setupExportMenu(() => panes[active], () => examplePicker);

const theme = document.querySelector<HTMLSelectElement>('#theme')!;
restorePreference(theme, 'zoomflow.theme');
const media = matchMedia('(prefers-color-scheme: dark)');
function updateTheme() {
  document.documentElement.dataset.theme = theme.value === 'system'
    ? media.matches ? 'dark' : 'light' : theme.value;
  for (const pane of Object.values(panes)) pane.viewer.setTheme(document.documentElement.dataset.theme === 'dark');
}
theme.addEventListener('change', updateTheme);
media.addEventListener('change', updateTheme);

// The pinned browser entry creates and owns D2's WASM worker. Import it lazily
// so the shell and loading state paint before the compiler is downloaded.
// Both panes share it; the worker answers each request by its message ID.
const compiler = createCompiler();
const engine = findEngineNotice();
engine.retry.addEventListener('click', () => {
  const restart = engine.retry.dataset.restart === 'true';
  if (restart) compiler.restart();
  for (const pane of Object.values(panes)) pane.retry(restart);
});
const documentRoutes = new Map<string, ViewerRoute>();
const fileHandles = new Map<string, FileSystemFileHandle>();
const files = setupFileOpen({ picker: () => examplePicker, activePane, fileHandles, paneRoots, setActive });

const flowBuilder = setupFlowBuilder((source, name) => {
  const key = examplePicker.rememberFile(name, source, '');
  void activePane().replaceDocument(source, name, key);
  activePane().showView('preview');
}, () => ({ source: activePane().source, name: activePane().name }));

function context(id: PaneId): PaneContext {
  return {
    compiler, picker: () => examplePicker, flowBuilder, engine, fileHandles, documentRoutes,
    isActive: () => active === id,
    tabbed: () => narrow.matches || workspace.dataset.layout === 'tabs',
    exportChanged: () => { if (active === id && panes[id]) exportMenu.updateExportLabel(); },
    setExportStatus: exportMenu.setExportStatus,
    clearFileError: () => files.setFileError(''),
    revealSource: (pane, range) => { setActive(pane); panes[pane]?.focusSource(range); },
    lintChanged: () => {
      const source = panes[id]!.lintOptions;
      const other = panes[otherPane(id)];
      if (!other) return;
      other.lintOptions.missingBacklink.checked = source.missingBacklink.checked;
      other.lintOptions.boundaryPorts.checked = source.boundaryPorts.checked;
      other.updateLint();
    },
  };
}

panes.a = createDocumentPane('a', paneRoots.a, context('a'));
const examplePicker = setupExamplePicker({
  readSource: (pane) => panes[pane]?.source ?? '',
  open: (pane, document, reset) => {
    if (document) void panes[pane]?.replaceDocument(document.source, document.name, document.key, reset);
    else panes[pane]?.close();
  },
  onState: (pane, state) => {
    panes[pane]?.renderDraftState(state);
    if (pane === active) showDocumentState(state.dirty, state.identity.name, Boolean(state.identity.projectId));
  },
  forget: (key) => {
    for (const pane of Object.values(panes)) { pane.editor.forget(key); pane.viewport.forget(key); }
    fileHandles.delete(key); documentRoutes.delete(key);
  },
  checkpoint: (key) => {
    const restore = Object.values(panes).flatMap((pane) => [pane.editor.checkpoint(key), pane.viewport.checkpoint(key)]);
    const handle = fileHandles.get(key);
    const route = documentRoutes.get(key);
    return () => {
      restore.forEach((undo) => undo());
      if (handle) fileHandles.set(key, handle);
      if (route) documentRoutes.set(key, route);
    };
  },
  focusPane: (pane) => focusPane(pane),
});

function showDocumentState(dirty: boolean, name?: string, project = false) {
  document.title = name ? `${dirty ? '• ' : ''}${name} — Zoomflow` : 'Zoomflow';
  document.querySelector<HTMLElement>('#document-unsaved')!.hidden = !dirty;
  document.querySelector('#example-picker > summary')!.setAttribute('aria-label',
    name ? `${name}${dirty ? ', unsaved changes' : ''} — choose a diagram` : 'Choose a diagram');
  exportMenu.showProjectDownload(project);
}
/** Header commands, shortcuts and the D2 reference follow the pane being worked in. */
function setActive(pane: PaneId) {
  if (pane === active || !panes[pane]) return;
  active = pane;
  for (const id of ['a', 'b'] as const) paneRoots[id].toggleAttribute('data-active', id === pane);
  examplePicker.setTarget(pane);
  if (!activePane().key) showDocumentState(false);
  exportMenu.updateExportLabel();
}
paneRoots.a.toggleAttribute('data-active', true);
function focusPane(pane: PaneId) {
  setActive(pane);
  const target = panes[pane]!;
  const editor = target.editor.view.dom;
  if (editor.offsetParent) target.editor.view.focus();
  else target.viewer.stage.focus({ preventScroll: true });
}
for (const id of ['a', 'b'] as const) {
  const root = paneRoots[id];
  root.addEventListener('focusin', () => setActive(id));
  root.addEventListener('pointerdown', () => setActive(id), { capture: true });
}

const reference = setupReference(() => {
  const pane = activePane();
  return { preview: pane.scope.part('preview-pane'), source: pane.scope.part('source-pane'),
    showPreview: () => pane.showView('preview'), showSource: () => pane.showView('source') };
});
document.querySelector('#toggle-reference')!.addEventListener('click', () => activePane().showView('preview'));

function wirePaneHeader(id: PaneId) {
  const button = (name: string) => paneScope(id, paneRoots[id]).part<HTMLButtonElement>(name);
  button('pane-document').addEventListener('click', (event) => { event.stopPropagation(); setActive(id); examplePicker.choose(id); });
  button('pane-choose').addEventListener('click', (event) => { event.stopPropagation(); setActive(id); examplePicker.choose(id); });
  button('pane-start-empty').addEventListener('click', () => {
    setActive(id);
    const key = examplePicker.rememberFile('untitled.d2', '', '', () => undefined);
    void panes[id]!.replaceDocument('', 'untitled.d2', key).then(() => panes[id]!.focusSource());
  });
  button('pane-switch').addEventListener('click', () => focusPane(otherPane(id)));
}
wirePaneHeader('a');

/** Create the second pane the first time a split layout opens. */
function ensureSecondPane() {
  if (panes.b) return panes.b;
  paneRoots.b.append(...secondPane);
  // Start with the first pane's AI settings, then keep both panes' settings in step.
  // The panes share one availability check for the same settings.
  const settings = ['ai-provider', 'ai-environment', 'ai-claude-config-dir'];
  const [a, b] = [paneScope('a', paneRoots.a), paneScope('b', paneRoots.b)];
  for (const name of settings) {
    const [first, second] = [a.part<HTMLInputElement>(name), b.part<HTMLInputElement>(name)];
    second.value = first.value;
    for (const [from, to] of [[first, second], [second, first]]) {
      from.addEventListener('change', () => {
        if (to.value === from.value) return;
        to.value = from.value;
        to.dispatchEvent(new Event('change'));
      });
    }
  }
  for (const name of ['missing-backlink', 'boundary-ports']) {
    b.part<HTMLInputElement>(name).checked = a.part<HTMLInputElement>(name).checked;
  }
  panes.b = createDocumentPane('b', paneRoots.b, context('b'));
  panes.b.viewer.setTheme(document.documentElement.dataset.theme === 'dark');
  panes.b.close();
  wirePaneHeader('b');
  splits.push(sourceSplit('b'));
  return panes.b;
}

const layoutSelect = document.querySelector<HTMLSelectElement>('#layout')!;
restorePreference(layoutSelect, 'zoomflow.layout');
/** All four views need room; narrower windows show the split as tabs. */
function effectiveLayout() {
  const layout = layoutSelect.value;
  return layout === 'single' ? 'single' : layout === 'quad' && roomy.matches ? 'quad' : 'tabs';
}
function sourceSplit(id: PaneId) {
  const root = paneRoots[id];
  const columns: SplitAxis = { container: workspace, storageKey: 'zoomflow.source.preview-share', properties: ['--preview-share', '--source-share'],
    minimum: 360, defaultShare: () => 50 + 12 * Math.max(0, Math.min(1, (workspace.clientWidth - 1100) / 340)),
    describe: (share) => `Diagram ${Math.round(share)}%, D2 source ${Math.round(100 - share)}%` };
  const rows: SplitAxis = { container: root, storageKey: paneScope(id, root).id('zoomflow.split.preview-share'), properties: ['--preview-share', '--source-share'],
    minimum: 160, defaultShare: () => 55, rows: true,
    describe: (share) => `Diagram ${Math.round(share)}%, D2 source ${Math.round(100 - share)}%` };
  return setupSplit(paneScope(id, root).part('source-divider'), () => {
    if (narrow.matches) return undefined;
    const layout = workspace.dataset.layout;
    return layout === 'single' && id === 'a' ? columns : layout === 'quad' ? rows : undefined;
  });
}
const splits = [sourceSplit('a'), setupSplit(paneDivider, () => narrow.matches || workspace.dataset.layout === 'single' ? undefined : {
  container: workspace, storageKey: 'zoomflow.split.pane-share', properties: ['--first-pane-share', '--second-pane-share'],
  minimum: 360, defaultShare: () => 50, describe: (share) => `First diagram ${Math.round(share)}%, second diagram ${Math.round(100 - share)}%`,
})];
function applyLayout() {
  const layout = effectiveLayout();
  const split = layout !== 'single';
  if (split) ensureSecondPane();
  workspace.dataset.layout = layout;
  paneRoots.b.hidden = !split;
  paneDivider.hidden = !split;
  for (const pane of Object.values(panes)) pane.root.querySelector<HTMLElement>('.pane-header')!.hidden = !split;
  if (!split && panes.b) {
    setActive('a');
    reference.reset({ preview: panes.a!.scope.part('preview-pane'), source: panes.a!.scope.part('source-pane'),
      showPreview: () => panes.a!.showView('preview'), showSource: () => panes.a!.showView('source') });
  }
  examplePicker.setSplit(split);
  if (!split) { panes.b?.close(); panes.b?.suspend(); }
  else panes.b!.resume();
  for (const pane of Object.values(panes)) pane.views.layoutChanged();
  for (const divider of splits) divider.refresh();
}
layoutSelect.addEventListener('change', applyLayout);
narrow.addEventListener('change', applyLayout);
roomy.addEventListener('change', applyLayout);

window.addEventListener('keydown', (event) => {
  if (event.isComposing || event.altKey || event.shiftKey || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
  event.preventDefault();
  if (!event.repeat) activePane().save();
});

// A page kept in the back/forward cache must still work when the visitor returns.
window.addEventListener('pagehide', (event) => {
  examplePicker.flush();
  if (event.persisted) return;
  for (const pane of Object.values(panes)) pane.dispose();
  compiler.dispose();
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') examplePicker.flush(); });
updateTheme();
exportMenu.updateExportLabel();
panes.a.open(examplePicker.initial);
applyLayout();
