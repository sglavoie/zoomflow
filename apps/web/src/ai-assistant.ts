type AiReply = { reply: string; source: string | null };
type Snapshot = { source: string; name: string; board: string; revision: number };

export function setupAiAssistant(read: () => Snapshot, validate: (source: string) => Promise<void>, apply: (source: string) => void) {
  const form = document.querySelector<HTMLFormElement>('#ai-form')!;
  const provider = document.querySelector<HTMLSelectElement>('#ai-provider')!;
  const claudeConfig = document.querySelector<HTMLElement>('#ai-claude-config')!;
  const claudeConfigDir = document.querySelector<HTMLInputElement>('#ai-claude-config-dir')!;
  const environment = document.querySelector<HTMLTextAreaElement>('#ai-environment')!;
  const prompt = document.querySelector<HTMLTextAreaElement>('#ai-prompt')!;
  const button = document.querySelector<HTMLButtonElement>('#ai-send')!;
  const status = document.querySelector<HTMLElement>('#ai-status')!;
  function showProviderSettings() {
    const isClaude = provider.value === 'claude';
    claudeConfig.hidden = !isClaude;
    claudeConfigDir.disabled = !isClaude;
  }
  provider.addEventListener('change', showProviderSettings);
  showProviderSettings();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = prompt.value.trim();
    if (!question || button.disabled) return;
    const snapshot = read();
    const unchanged = () => read().revision === snapshot.revision;
    button.disabled = true;
    status.setAttribute('role', 'status');
    status.dataset.kind = 'pending';
    status.textContent = `Waiting for ${provider.selectedOptions[0]?.textContent ?? 'AI'}…`;
    try {
      const response = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: provider.value, prompt: question, source: snapshot.source, name: snapshot.name,
          board: snapshot.board, environment: environment.value, claudeConfigDir: claudeConfigDir.value }) });
      const data: AiReply & { error?: string } = await response.json().catch(() => {
        throw new Error('AI needs the local Zoomflow Vite server. Start the app with pnpm dev.');
      });
      if (!response.ok) throw new Error(data.error || `Server returned ${response.status}.`);
      if (typeof data.reply !== 'string' || (data.source !== null && typeof data.source !== 'string')) {
        throw new Error('AI returned an invalid response.');
      }
      if (data.source !== null) {
        if (!unchanged()) {
          throw new Error('The diagram changed while AI was working. Your edits were kept; send the prompt again.');
        }
        try { await validate(data.source); }
        catch (error) { throw new Error(`AI returned invalid D2: ${String(error)}`); }
        if (!unchanged()) {
          throw new Error('The diagram changed while AI was working. Your edits were kept; send the prompt again.');
        }
        if (data.source !== snapshot.source) apply(data.source);
      }
      status.dataset.kind = 'success';
      status.textContent = `${data.source !== null && data.source !== snapshot.source ? 'Diagram updated. ' : ''}${data.reply || 'Done.'}`;
      prompt.value = '';
    } catch (error) {
      status.setAttribute('role', 'alert');
      status.dataset.kind = 'error';
      status.textContent = error instanceof Error ? error.message : String(error);
    } finally { button.disabled = false; }
  });
}
