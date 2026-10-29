import type { PaneScope } from './pane-scope';
import { AiError, aiFailure, readAiResponse } from './ai-errors';
type Snapshot = { source: string; name: string; board: string; revision: number };
const switchedDocument = Symbol('switched document');

/** Longer than the server's own CLI timeout, so its clearer explanation arrives first. */
const CHECK_TIMEOUT_MS = 7000;
const STATIC_BUILD = 'AI is not available in this build. Run Zoomflow locally with pnpm dev to ask Claude Code or Codex.';

/** A static build has no AI endpoint, so its GET probe answers 404; that answer does not change. */
let endpoint: Promise<boolean> | undefined;
function endpointAvailable(signal: AbortSignal) {
  endpoint ??= fetch('/api/ai/status', { signal }).then((response) => response.status !== 404,
    // The full check reports transport failures; probe again next time.
    () => { endpoint = undefined; return true; });
  return endpoint;
}

/** Both panes check availability with the same settings; share a check that is still running. */
const statusChecks = new Map<string, Promise<Record<string, unknown>>>();
function requestStatus(body: string) {
  let check = statusChecks.get(body);
  if (!check) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    check = endpointAvailable(controller.signal)
      .then((reachable) => reachable
        ? fetch('/api/ai/status', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body }).then(readAiResponse)
        : { available: false, reason: STATIC_BUILD, unsupported: true })
      .catch((error) => { throw controller.signal.aborted ? new AiError('The AI availability check timed out. Check that the local server and selected provider are running, then check again.', `No availability response within ${CHECK_TIMEOUT_MS / 1000} seconds.`) : error; })
      .finally(() => { clearTimeout(timeout); statusChecks.delete(body); });
    statusChecks.set(body, check);
  }
  return check;
}

export type AiAssistantHost = {
  read: () => Snapshot;
  /** Rejects when the proposed source does not compile; an `AiError` rejection reports its own message,
   * for example when the diagram engine cannot check the source at all. */
  validate: (source: string) => Promise<void>;
  /** Apply proposed source and return a summary of the change. */
  apply: (source: string) => string;
  /** A notice while the document must not change: replies still show, proposed source is not applied. */
  readOnly?: () => string | undefined;
  onStatus?: (message: string, kind: 'info' | 'error') => void;
  undo?: () => boolean;
  revealChange?: () => void;
  dismissHighlights?: () => void;
};

export function setupAiAssistant({ root, part }: PaneScope, { read, validate, apply, readOnly = () => undefined, onStatus = () => {}, undo = () => false,
  revealChange = () => {}, dismissHighlights = () => {} }: AiAssistantHost) {
  const form = part<HTMLFormElement>('ai-form');
  const provider = part<HTMLSelectElement>('ai-provider');
  const claudeConfig = part<HTMLElement>('ai-claude-config');
  const claudeConfigDir = part<HTMLInputElement>('ai-claude-config-dir');
  const environment = part<HTMLTextAreaElement>('ai-environment');
  const fullAccess = part<HTMLInputElement>('ai-full-access');
  const workingConfig = part<HTMLElement>('ai-working-config');
  const workingDirectory = part<HTMLInputElement>('ai-working-directory');
  const prompt = part<HTMLTextAreaElement>('ai-prompt');
  const button = part<HTMLButtonElement>('ai-send');
  const status = part<HTMLElement>('ai-status');
  const panel = part<HTMLDetailsElement>('ai-assistant');
  const availability = part<HTMLElement>('ai-availability');
  const retry = part<HTMLButtonElement>('ai-retry');
  const cancel = part<HTMLButtonElement>('ai-cancel');
  const undoButton = part<HTMLButtonElement>('ai-undo');
  const elapsed = part<HTMLElement>('ai-elapsed');
  const changeFeedback = root.querySelector<HTMLElement>('.ai-change-feedback')!;
  const changeSummary = part<HTMLButtonElement>('ai-change-summary');
  const dismiss = part<HTMLButtonElement>('ai-dismiss-highlights');
  changeSummary.addEventListener('click', revealChange);
  dismiss.addEventListener('click', () => {
    dismissHighlights();
    changeSummary.disabled = true;
    dismiss.hidden = true;
    undoButton.focus();
  });
  const tools = root.querySelector<HTMLElement>('.source-tools')!;
  const updateOverflow = () => { tools.dataset.overflow = String(tools.scrollHeight > tools.clientHeight + 1 && tools.scrollTop + tools.clientHeight < tools.scrollHeight - 1); };
  const resize = new ResizeObserver(updateOverflow);
  resize.observe(tools);
  for (const child of tools.children) resize.observe(child);
  tools.addEventListener('scroll', updateOverflow);
  function detailPanel(after: HTMLElement) {
    const panel = document.createElement('details');
    panel.className = 'ai-error-details';
    panel.hidden = true;
    const summary = document.createElement('summary');
    summary.textContent = 'Technical details';
    const text = document.createElement('pre');
    panel.append(summary, text);
    after.after(panel);
    return (value = '') => { panel.hidden = !value; panel.open = false; text.textContent = value; };
  }
  const healthDetails = detailPanel(availability);
  const responseDetails = detailPanel(status);
  let available = false;
  let checking = false;
  let active: AbortController | undefined;
  let health: AbortController | undefined;
  let undoRevision: number | undefined;
  function updateControls() {
    button.disabled = checking || !available || Boolean(active);
    button.hidden = Boolean(active);
    prompt.disabled = !available || Boolean(active);
    provider.disabled = Boolean(active);
    cancel.hidden = !active;
  }
  async function checkAvailability() {
    health?.abort();
    const controller = health = new AbortController();
    checking = true;
    healthDetails();
    retry.hidden = true;
    availability.textContent = 'Checking local AI availability…';
    updateControls();
    try {
      const data = await requestStatus(JSON.stringify({ provider: provider.value, environment: environment.value,
        claudeConfigDir: claudeConfigDir.value }));
      if (typeof data.available !== 'boolean') throw new AiError('The AI server returned an incomplete availability check. Restart the local server and check again.', 'Missing boolean available field.');
      if (health !== controller) return;
      available = data.available === true;
      availability.textContent = available ? `${provider.selectedOptions[0]?.textContent ?? 'AI'} is ready on this computer.`
        : typeof data.reason === 'string' ? data.reason : 'The selected provider is unavailable. Check its installation and sign-in.';
      // A static build cannot gain an AI endpoint by checking again.
      retry.hidden = available || data.unsupported === true;
    } catch (error) {
      if (health !== controller) return;
      available = false;
      const failure = aiFailure(error);
      availability.textContent = failure.message;
      healthDetails(failure.details);
      retry.hidden = false;
    } finally {
      if (health === controller) { health = undefined; checking = false; updateControls(); }
    }
  }
  retry.addEventListener('click', () => void checkAvailability());
  // Provider sign-in checks run a CLI, so wait until the panel first opens.
  let checked = false;
  const recheck = () => { if (checked) void checkAvailability(); };
  cancel.addEventListener('click', () => active?.abort());
  undoButton.addEventListener('click', () => {
    if (undoRevision === read().revision && undo()) {
      status.textContent = 'AI change undone.';
      onStatus('AI change undone.', 'info');
    }
    undoRevision = undefined;
    undoButton.hidden = true;
    changeFeedback.hidden = true;
    // Undo hides itself, so keep keyboard focus in the assistant.
    prompt.focus();
  });
  const panelToggled = () => {
    // WebKit can keep the native select hidden to visibility checks after a
    // details panel opens. A post-toggle style update refreshes its layout.
    provider.style.display = panel.open ? 'inline-block' : '';
    if (panel.open && !checked) { checked = true; void checkAvailability(); }
  };
  panel.addEventListener('toggle', panelToggled);
  // The panel may have been opened before this script ran, without a toggle to observe.
  if (panel.open) panelToggled();
  function showProviderSettings() {
    const isClaude = provider.value === 'claude';
    claudeConfig.hidden = !isClaude;
    claudeConfigDir.disabled = !isClaude;
  }
  function showAccessSettings() {
    workingConfig.hidden = !fullAccess.checked;
    workingDirectory.disabled = !fullAccess.checked;
  }
  fullAccess.addEventListener('change', showAccessSettings);
  showAccessSettings();
  provider.addEventListener('change', () => { showProviderSettings(); recheck(); });
  environment.addEventListener('change', recheck);
  claudeConfigDir.addEventListener('change', recheck);
  showProviderSettings();
  prompt.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || event.isComposing) return;
    event.preventDefault();
    form.requestSubmit();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = prompt.value.trim();
    if (!question || button.disabled) return;
    const snapshot = read();
    const unchanged = () => read().revision === snapshot.revision;
    const controller = active = new AbortController();
    responseDetails();
    // The prompt is disabled and Send hidden while waiting, so Cancel takes their focus.
    const sending = document.activeElement === prompt || document.activeElement === button;
    updateControls();
    if (sending) cancel.focus();
    const started = Date.now();
    elapsed.textContent = '0s elapsed';
    const timer = setInterval(() => { elapsed.textContent = `${Math.floor((Date.now() - started) / 1000)}s elapsed`; }, 1000);
    status.setAttribute('role', 'status');
    status.dataset.kind = 'pending';
    status.textContent = `Waiting for ${provider.selectedOptions[0]?.textContent ?? 'AI'}…`;
    onStatus(status.textContent, 'info');
    try {
      const response = await fetch('/api/ai', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: provider.value, prompt: question, source: snapshot.source, name: snapshot.name,
          board: snapshot.board, environment: environment.value, claudeConfigDir: claudeConfigDir.value,
          fullAccess: fullAccess.checked, workingDirectory: workingDirectory.value }) });
      const data = await readAiResponse(response);
      controller.signal.throwIfAborted();
      if (typeof data.reply !== 'string' || (data.source !== null && typeof data.source !== 'string')) {
        throw new AiError('The AI server returned an incomplete response. Try again; your source is unchanged.', 'Expected reply text and source text or null.');
      }
      // The editor keeps `\n` line breaks: a `\r` left in would become a line of its own.
      const source = data.source === null ? null : (data.source as string).replace(/\r\n?/g, '\n');
      const locked = source !== null && source !== snapshot.source ? readOnly() : undefined;
      if (locked) {
        status.dataset.kind = 'info';
        status.textContent = `${data.reply ? `${data.reply} ` : ''}The proposed source change was not applied. ${locked}`;
        onStatus('AI suggested a change the read-only document cannot take.', 'info');
        prompt.value = '';
        return;
      }
      if (source !== null) {
        controller.signal.throwIfAborted();
        if (!unchanged()) {
          throw new Error('The diagram changed while AI was working. Your edits were kept; send the prompt again.');
        }
        try { await validate(source); }
        catch (error) {
          if (error instanceof AiError) throw error;
          throw new AiError('AI returned invalid D2. Your source is unchanged; try a smaller change or rephrase the request.', String(error));
        }
        controller.signal.throwIfAborted();
        if (!unchanged()) {
          throw new Error('The diagram changed while AI was working. Your edits were kept; send the prompt again.');
        }
        if (source !== snapshot.source) {
          changeSummary.textContent = apply(source);
          changeSummary.disabled = false;
          dismiss.hidden = false;
          undoRevision = read().revision;
          undoButton.hidden = false;
          changeFeedback.hidden = false;
        }
      }
      status.dataset.kind = 'success';
      status.textContent = `${source !== null && source !== snapshot.source ? 'Diagram updated. ' : ''}${data.reply || 'Done.'}`;
      if (!changeFeedback.hidden) requestAnimationFrame(() => {
        if (changeFeedback.hidden || undoRevision !== read().revision) return;
        // Reveal the change summary and Undo within the tools, leaving editor
        // scroll and keyboard focus alone even on a short phone viewport.
        const bottom = changeFeedback.getBoundingClientRect().bottom;
        const visibleBottom = tools.getBoundingClientRect().bottom;
        if (bottom > visibleBottom) tools.scrollTop += bottom - visibleBottom;
      });
      onStatus(source !== null && source !== snapshot.source ? 'AI updated the source.' : 'AI response ready.', 'info');
      prompt.value = '';
    } catch (error) {
      if (controller.signal.aborted) {
        status.dataset.kind = 'info';
        if (controller.signal.reason === switchedDocument) {
          status.textContent = 'AI request canceled because you switched documents. Send the prompt again to ask about this one.';
          onStatus('AI request for the previous document canceled.', 'info');
        } else {
          status.textContent = 'AI request canceled. Your source is unchanged.';
          onStatus('AI request canceled.', 'info');
        }
        return;
      }
      status.setAttribute('role', 'alert');
      status.dataset.kind = 'error';
      const failure = aiFailure(error);
      status.textContent = failure.message;
      responseDetails(failure.details);
      onStatus('AI request failed. See the assistant response.', 'error');
    } finally {
      clearInterval(timer);
      elapsed.textContent = '';
      active = undefined;
      // Return focus that Cancel held, or lost while the prompt was disabled, without taking it from elsewhere.
      const returning = [cancel, document.body, null].includes(document.activeElement as HTMLElement | null);
      updateControls();
      // Without scrolling: the change summary and Undo just revealed must stay in view.
      if (returning && !prompt.disabled) prompt.focus({ preventScroll: true });
    }
  });
  return {
    /** The pane shows another document: a running request must not apply to it. */
    documentSwitched() { active?.abort(switchedDocument); },
    sourceChanged() { undoRevision = undefined; undoButton.hidden = true; changeFeedback.hidden = true; },
    /** Abandon a running request, for example when its document closes. */
    cancel() { active?.abort(); },
    dispose() { active?.abort(); health?.abort(); resize.disconnect(); tools.removeEventListener('scroll', updateOverflow); },
  };
}
