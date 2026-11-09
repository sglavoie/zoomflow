import type { Viewer } from '@zoomflow/viewer';
import { lookControls, lookFields } from './builder-dialog';
import { flowSource, readFlow } from './flow-model';
import { mindMapSource, readMindMap } from './mind-map-model';
import type { BoardSites } from './board-model';
import { pageListeners } from './canvas-guidance';

/** Change the current builder's look without leaving the diagram. Attachments stay intact. */
export function setupBoardAppearance(toolbar: HTMLElement, viewer: Viewer, prefix: string,
  current: () => BoardSites | undefined, apply: (source: string) => void) {
  const host = document.createElement('div');
  host.className = 'board-appearance';
  host.innerHTML = lookFields(prefix);
  host.hidden = true;
  toolbar.append(host);
  const details = host.querySelector('details')!;
  details.querySelector('summary')!.textContent = 'Style';
  const controls = lookControls(host, prefix);
  const read = () => {
    const sites = current();
    const owner = sites?.owner(viewer.currentBoard?.id ?? 'root');
    const builder = owner && sites?.builder(owner);
    if (!sites || !owner || !builder) return;
    const flow = readFlow(builder.own);
    const map = flow ? undefined : readMindMap(builder.own);
    return { sites, owner, flow, map };
  };
  for (const box of controls.boxes) box.addEventListener('change', () => {
    const state = read();
    if (!state) return;
    const look = controls.get();
    const own = state.flow ? flowSource({ ...state.flow, look }) : mindMapSource({ ...state.map!, look });
    const result = state.sites.update(state.owner, own);
    if (!('error' in result)) apply(result.source);
  });
  const close = (event: Event) => { if (!host.contains(event.target as Node)) details.open = false; };
  pageListeners(viewer.stage, signal => document.addEventListener('pointerdown', close, { signal }));
  details.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); details.open = false; details.querySelector('summary')!.focus(); }
  });
  return {
    refresh() {
      const state = read();
      host.hidden = !state;
      if (state) controls.set((state.flow ?? state.map)!.look);
    },
  };
}
