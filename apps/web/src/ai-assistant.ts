import { AiError, aiFailure, readAiResponse } from './ai-errors';
type Snapshot = { source: string; name: string; board: string; revision: number };

export function setupAiAssistant(root: HTMLElement, idSuffix: string, read: () => Snapshot, validate: (source: string) => Promise<void>, apply: (source: string) => string,
  onStatus: (message: string, kind: 'info' | 'error') => void = () => {}, undo: () => boolean = () => false,
  revealChange: () => void = () => {}, dismissHighlights: () => void = () => {}) {
  const part = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}${idSuffix}`)!;
  const form = part<HTMLFormElement>('ai-form');
  const provider = part<HTMLSelectElement>('ai-provider');
  const claudeConfig = part<HTMLElement>('ai-claude-config');
  const claudeConfigDir = part<HTMLInputElement>('ai-claude-config-dir');
  const environment = part<HTMLTextAreaElement>('ai-environment');
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
    const timeout = setTimeout(() => controller.abort(), 5000);
    checking = true;
    healthDetails();
    retry.hidden = true;
    availability.textContent = 'Checking local AI availability…';
    updateControls();
    try {
      const response = await fetch('/api/ai/status', { method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: provider.value, environment: environment.value,
          claudeConfigDir: claudeConfigDir.value }) });
      const data = await readAiResponse(response);
      if (typeof data.available !== 'boolean') throw new AiError('The AI server returned an incomplete availability check. Restart the local server and check again.', 'Missing boolean available field.');
      if (health !== controller) return;
      available = data.available === true;
      availability.textContent = available ? `${provider.selectedOptions[0]?.textContent ?? 'AI'} is ready on this computer.`
        : typeof data.reason === 'string' ? data.reason : 'The selected provider is unavailable. Check its installation and sign-in.';
      retry.hidden = available;
    } catch (error) {
      if (health !== controller) return;
      available = false;
      const failure = controller.signal.aborted
        ? { message: 'The AI availability check timed out. Check that the local server and selected provider are running, then check again.', details: 'No availability response within 5 seconds.' }
        : aiFailure(error);
      availability.textContent = failure.message;
      healthDetails(failure.details);
      retry.hidden = false;
    } finally {
      clearTimeout(timeout);
      if (health === controller) { health = undefined; checking = false; updateControls(); }
    }
  }
  retry.addEventListener('click', () => void checkAvailability());
  void checkAvailability();
  cancel.addEventListener('click', () => active?.abort());
  undoButton.addEventListener('click', () => {
    if (undoRevision === read().revision && undo()) {
      status.textContent = 'AI change undone.';
      onStatus('AI change undone.', 'info');
    }
    undoRevision = undefined;
    undoButton.hidden = true;
    changeFeedback.hidden = true;
  });
  panel.addEventListener('toggle', () => {
    // WebKit can keep the native select hidden to visibility checks after a
    // details panel opens. A post-toggle style update refreshes its layout.
    provider.style.display = panel.open ? 'inline-block' : '';
  });
  function showProviderSettings() {
    const isClaude = provider.value === 'claude';
    claudeConfig.hidden = !isClaude;
    claudeConfigDir.disabled = !isClaude;
  }
  provider.addEventListener('change', () => { showProviderSettings(); void checkAvailability(); });
  environment.addEventListener('change', () => void checkAvailability());
  claudeConfigDir.addEventListener('change', () => void checkAvailability());
  showProviderSettings();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = prompt.value.trim();
    if (!question || button.disabled) return;
    const snapshot = read();
    const unchanged = () => read().revision === snapshot.revision;
    const controller = active = new AbortController();
    responseDetails();
    updateControls();
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
          board: snapshot.board, environment: environment.value, claudeConfigDir: claudeConfigDir.value }) });
      const data = await readAiResponse(response);
      controller.signal.throwIfAborted();
      if (typeof data.reply !== 'string' || (data.source !== null && typeof data.source !== 'string')) {
        throw new AiError('The AI server returned an incomplete response. Try again; your source is unchanged.', 'Expected reply text and source text or null.');
      }
      if (data.source !== null) {
        controller.signal.throwIfAborted();
        if (!unchanged()) {
          throw new Error('The diagram changed while AI was working. Your edits were kept; send the prompt again.');
        }
        try { await validate(data.source); }
        catch (error) { throw new AiError('AI returned invalid D2. Your source is unchanged; try a smaller change or rephrase the request.', String(error)); }
        controller.signal.throwIfAborted();
        if (!unchanged()) {
          throw new Error('The diagram changed while AI was working. Your edits were kept; send the prompt again.');
        }
        if (data.source !== snapshot.source) {
          changeSummary.textContent = apply(data.source);
          changeSummary.disabled = false;
          dismiss.hidden = false;
          undoRevision = read().revision;
          undoButton.hidden = false;
          changeFeedback.hidden = false;
        }
      }
      status.dataset.kind = 'success';
      status.textContent = `${data.source !== null && data.source !== snapshot.source ? 'Diagram updated. ' : ''}${data.reply || 'Done.'}`;
      if (!changeFeedback.hidden) requestAnimationFrame(() => {
        if (changeFeedback.hidden || undoRevision !== read().revision) return;
        // Reveal the change summary and Undo within the tools, leaving editor
        // scroll and keyboard focus alone even on a short phone viewport.
        const bottom = changeFeedback.getBoundingClientRect().bottom;
        const visibleBottom = tools.getBoundingClientRect().bottom;
        if (bottom > visibleBottom) tools.scrollTop += bottom - visibleBottom;
      });
      onStatus(data.source !== null && data.source !== snapshot.source ? 'AI updated the source.' : 'AI response ready.', 'info');
      prompt.value = '';
    } catch (error) {
      if (controller.signal.aborted) {
        status.dataset.kind = 'info';
        status.textContent = 'AI request canceled. Your source is unchanged.';
        onStatus('AI request canceled.', 'info');
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
      updateControls();
    }
  });
  return {
    sourceChanged() { undoRevision = undefined; undoButton.hidden = true; changeFeedback.hidden = true; },
    dispose() { active?.abort(); health?.abort(); resize.disconnect(); tools.removeEventListener('scroll', updateOverflow); },
  };
}
