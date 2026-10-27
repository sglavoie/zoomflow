import { expect, test } from 'vitest';
import { aiFailure, readAiResponse } from '../src/ai-errors';

test.each([
  [new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }), 'pnpm dev'],
  [new Response('{broken'), 'unreadable response'],
  [Response.json(null), 'incomplete response'],
  [Response.json({ error: 'Provider timed out after 120000ms' }, { status: 504 }), 'took too long'],
  [Response.json({ error: 'spawn failed: internal detail' }, { status: 500 }), 'Check its installation'],
  [Response.json({ error: 'Invalid AI request.' }, { status: 400 }), 'could not read this request'],
  [Response.json({ error: 'The current board is nested too deeply for AI. Open a board nearer the top, then try again.' }, { status: 400 }), 'nested too deeply'],
  [Response.json({ error: 'Request is too large.' }, { status: 413 }), 'too large. Keep the prompt'],
  [Response.json({ error: 'AI is available only from the local Zoomflow server.' }, { status: 403 }), 'opened through localhost'],
  [Response.json({ error: 'Environment line 1 must be NAME=value.' }, { status: 400 }), 'Environment line 1'],
  [Response.json({ error: 'Working directory /missing does not exist or is not a directory.' }, { status: 400 }), 'Working directory /missing does not exist'],
  [Response.json({ error: 'Invalid JSON request.' }, { status: 400 }), 'could not read this request'],
  [Response.json({}, { status: 400 }), 'could not read this request'],
])('transport failures have actionable messages and separate details', async (response, message) => {
  try { await readAiResponse(response); throw new Error('Expected failure'); }
  catch (error) {
    const failure = aiFailure(error);
    expect(failure.message).toContain(message);
    expect(failure.details).not.toBe('');
    expect(failure.message).not.toContain('Unexpected token');
  }
});
