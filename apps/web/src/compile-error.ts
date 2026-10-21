import type { PaneScope } from './pane-scope';

/** The source pane's compile error banner and its copy above the phone preview.
 * Both offer one action that goes to the error. */
export function setupCompileError(scope: PaneScope, stage: HTMLElement, goToError: () => void) {
  const banner = scope.part('compile-error');
  const message = scope.part('compile-error-message');
  const action = scope.part<HTMLButtonElement>('go-to-error');
  const mobile = document.createElement('div');
  mobile.id = scope.id('mobile-error');
  mobile.dataset.part = 'mobile-error';
  mobile.className = 'mobile-error';
  mobile.hidden = true;
  mobile.innerHTML = '<span role="status"></span><button type="button">Go to error</button>';
  stage.parentElement!.before(mobile);
  const mobileText = mobile.querySelector('span')!;
  const mobileAction = mobile.querySelector('button')!;
  mobileAction.addEventListener('click', () => action.click());
  action.addEventListener('click', goToError);

  return {
    /** The source changed: the phone copy hides and the action waits for the next result. */
    invalidate() { mobile.hidden = true; action.disabled = true; },
    /** `clear` also forgets the message, once a compile succeeds. */
    hide(clear = false) {
      banner.hidden = true;
      action.hidden = true;
      mobile.hidden = true;
      if (clear) message.textContent = '';
    },
    show(text: string, label: string, enabled: boolean) {
      message.textContent = text;
      action.textContent = label;
      action.title = label;
      action.hidden = false;
      action.disabled = !enabled;
      banner.title = text;
      mobileText.textContent = text;
      mobileAction.textContent = label;
      mobileAction.disabled = !enabled;
      mobile.hidden = false;
      banner.hidden = false;
    },
  };
}
