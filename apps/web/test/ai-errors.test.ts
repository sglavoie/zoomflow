import { expect, test } from 'vitest';
import { aiFailure, readAiResponse } from '../src/ai-errors';

test.each([
  [new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }), 'pnpm dev'],
  [new Response('{broken'), 'unreadable response'],
  [Response.json(null), 'incomplete response'],
  [Response.json({ error: 'Provider timed out after 120000ms' }, { status: 504 }), 'took too long'],
  [Response.json({ error: 'spawn failed: internal detail' }, { status: 500 }), 'Check its installation'],
])('transport failures have actionable messages and separate details', async (response, message) => {
  try { await readAiResponse(response); throw new Error('Expected failure'); }
  catch (error) {
    const failure = aiFailure(error);
    expect(failure.message).toContain(message);
    expect(failure.details).not.toBe('');
    expect(failure.message).not.toContain('Unexpected token');
  }
});
