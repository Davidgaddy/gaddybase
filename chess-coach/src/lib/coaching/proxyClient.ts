import type { CoachModel } from './types';

export interface StreamCoachingOptions {
  model: CoachModel;
  system: string;
  prompt: string;
  maxTokens?: number;
  /** Called with each chunk of text as it streams in from the proxy. */
  onToken?: (delta: string) => void;
}

/**
 * Posts to the local dev-server proxy (see server/coachProxyPlugin.ts) and
 * streams the plain-text response back, calling `onToken` per chunk so the
 * UI can render prose as it arrives instead of waiting for the full reply.
 * The Anthropic API key never reaches this file — it lives server-side only.
 */
export async function streamCoaching({ model, system, prompt, maxTokens, onToken }: StreamCoachingOptions): Promise<string> {
  const response = await fetch('/api/coach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, system, prompt, maxTokens }),
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Coaching request failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    full += chunk;
    onToken?.(chunk);
  }
  return full;
}
