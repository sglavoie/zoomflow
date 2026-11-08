import { indexBoards, type Diagram } from '@zoomflow/core';
import { Viewer, setupViewport, type RenderBoard } from '@zoomflow/viewer';
import { createPreviewQueue } from './preview-queue';

export type CompileBuilderPreview = (source: string, draft: boolean) => Promise<{ diagram: Diagram; render: RenderBoard }>;

/** A real, isolated diagram preview. Editing a form never writes the workspace source or history. */
export function setupBuilderPreview(dialog: HTMLDialogElement, source: () => string | undefined,
  draft: () => boolean, compile?: CompileBuilderPreview) {
  if (!compile) return { update() {} };
  const form = dialog.querySelector('form')!;
  const fields = document.createElement('div');
  fields.className = 'builder-fields';
  for (const child of [...form.children]) {
    if (!child.matches('.flow-heading, .flow-footer, [id$="-description"]')) fields.append(child);
  }
  const body = document.createElement('div');
  body.className = 'builder-body';
  const panel = document.createElement('section');
  panel.className = 'builder-preview';
  panel.setAttribute('aria-label', 'Live diagram preview');
  panel.innerHTML = '<div class="builder-preview-heading"><strong>Live preview</strong><span></span></div><div class="builder-preview-viewer"></div><p class="builder-preview-status" aria-live="polite"></p>';
  body.append(fields, panel);
  form.querySelector('.flow-footer')!.before(body);
  const status = panel.querySelector<HTMLElement>('.builder-preview-status')!;
  const count = panel.querySelector('.builder-preview-heading span')!;
  const host = panel.querySelector<HTMLElement>('.builder-preview-viewer')!;
  let viewer: Viewer | undefined;
  let viewport: ReturnType<typeof setupViewport> | undefined;
  function ensureViewer() {
    if (!viewer) {
      viewer = new Viewer(host, { history: false, active: () => false, name: () => 'Overview' });
      const area = document.createElement('div');
      area.className = 'zf-stage-area';
      viewer.stage.before(area);
      area.append(viewer.stage);
      viewport = setupViewport(viewer.stage, area);
    }
    return viewer;
  }
  const queue = createPreviewQueue();
  let revision = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let requestedSource: string | undefined;
  function update() {
    if (!dialog.open) return;
    const text = source();
    if (text === requestedSource && text) return;
    requestedSource = text;
    const request = ++revision;
    clearTimeout(timer);
    viewer?.cancelPendingRender();
    queue.invalidate();
    if (!text) {
      status.textContent = 'Add a topic to see your diagram.';
      viewer?.stage.replaceChildren();
      count.textContent = '';
      panel.setAttribute('aria-busy', 'false');
      return;
    }
    panel.setAttribute('aria-busy', 'true');
    status.textContent = 'Updating preview…';
    timer = setTimeout(() => void queue.run(async () => {
      try {
        const result = await compile!(text, draft());
        if (request !== revision || !dialog.open) return;
        const live = ensureViewer();
        live.setTheme(document.documentElement.dataset.theme === 'dark');
        await live.setDocument(result.diagram, result.render);
        if (request !== revision || !dialog.open) return;
        const boards = indexBoards(result.diagram).size;
        count.textContent = `${boards} ${boards === 1 ? 'board' : 'boards'}`;
        status.textContent = boards > 1 ? 'Open an arrow badge to explore a detail board.' : 'Your diagram updates as you edit.';
        viewport!.refresh();
      } catch {
        if (request === revision) { requestedSource = undefined; status.textContent = 'Preview unavailable. Keep editing, or change a field to retry.'; }
      } finally {
        if (request === revision) panel.setAttribute('aria-busy', 'false');
      }
    }), 180);
  }
  for (const type of ['input', 'change']) fields.addEventListener(type, update);
  dialog.addEventListener('close', () => {
    ++revision; clearTimeout(timer); queue.invalidate(); viewer?.destroy(); viewer = undefined; viewport = undefined; host.replaceChildren(); requestedSource = undefined;
  });
  return { update };
}
