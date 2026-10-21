import type { PaneId } from './pane-scope';
import { setText } from './text';

/** The page-level engine notice; `owner` is the pane whose preview shows it.
 * The notice stays rendered so screen readers announce its message; it collapses while empty. */
export type EngineNotice = { notice: HTMLElement; message: HTMLElement; retry: HTMLButtonElement; owner?: PaneId };

export function findEngineNotice(): EngineNotice {
  return {
    notice: document.querySelector<HTMLElement>('#engine-notice')!,
    message: document.querySelector<HTMLElement>('#engine-message')!,
    retry: document.querySelector<HTMLButtonElement>('#retry-engine')!,
    owner: undefined,
  };
}

/** One pane's use of the shared notice: it shows engine startup and slow-preview messages. */
export function paneNotice(engine: EngineNotice, id: PaneId) {
  return {
    show(message: string, role: 'status' | 'alert', retry?: 'Retry preview' | 'Restart preview') {
      engine.owner = id;
      engine.notice.setAttribute('role', role);
      setText(engine.message, message);
      engine.retry.hidden = !retry;
      engine.retry.textContent = retry ?? 'Retry preview';
      engine.retry.dataset.restart = String(retry === 'Restart preview');
    },
    /** Another pane's notice stays until that pane's preview resolves it. */
    hide() {
      if (engine.owner && engine.owner !== id) return;
      engine.owner = undefined;
      setText(engine.message, '');
      engine.retry.hidden = true;
      engine.retry.dataset.restart = 'false';
      engine.retry.textContent = 'Retry preview';
    },
    get owned() { return engine.owner === id; },
    /** This pane shows the offer to restart a stalled preview. */
    get offersRestart() { return engine.owner === id && engine.retry.dataset.restart === 'true'; },
  };
}
