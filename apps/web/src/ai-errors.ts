export class AiError extends Error {
  constructor(message: string, readonly details: string) { super(message); }
}

const localServer = 'AI needs the local Zoomflow server. Start it with pnpm dev, then check again.';

/** Keep transport and provider diagnostics out of the primary user message. */
export async function readAiResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  let data: unknown;
  try { data = JSON.parse(text); }
  catch {
    throw new AiError(/^\s*</.test(text) || response.status === 404 ? localServer
      : 'The AI server returned an unreadable response. Check that the local server is running, then try again.',
    `HTTP ${response.status}; ${response.headers.get('content-type') ?? 'unknown content type'}. Response was not valid JSON.`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new AiError('The AI server returned an incomplete response. Try again; your source is unchanged.', `HTTP ${response.status}; expected a JSON object.`);
  }
  const result = data as Record<string, unknown>;
  if (!response.ok) {
    const detail = typeof result.error === 'string' ? result.error : `HTTP ${response.status}`;
    const message = response.status === 404 ? localServer
      : /timed? ?out|timeout/i.test(detail) || response.status === 504
        ? 'The AI request took too long. Try a smaller change or check the selected provider, then send again.'
        : /not installed|not on.*PATH|sign in|login|environment|config/i.test(detail) ? detail
          : 'The AI provider could not complete the request. Check its installation and sign-in, then try again.';
    throw new AiError(message, detail);
  }
  return result;
}

export function aiFailure(error: unknown): { message: string; details: string } {
  if (error instanceof AiError) return { message: error.message, details: error.details };
  if (error instanceof TypeError) return { message: 'Could not reach the local AI server. Start it with pnpm dev, then try again.', details: error.message };
  return { message: error instanceof Error ? error.message : 'AI could not complete the request. Please try again.', details: '' };
}
