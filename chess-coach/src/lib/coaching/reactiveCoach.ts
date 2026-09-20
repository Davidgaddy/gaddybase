import { getCachedExplanation, reactiveCacheKey, setCachedExplanation } from './cache';
import { buildReactivePrompt, REACTIVE_SYSTEM } from './promptBuilder';
import { streamCoaching } from './proxyClient';
import type { ReactiveCoachingContext } from './types';

/**
 * Explains what a just-played move accomplished and what (if anything) was
 * missed. Cached by FEN so replaying into the same position — in this game
 * or a later one — never re-spends a call on it.
 */
export async function explainLastMove(ctx: ReactiveCoachingContext, onToken?: (delta: string) => void): Promise<string> {
  const key = reactiveCacheKey(ctx.fen, 'reactive');
  const cached = await getCachedExplanation(key);
  if (cached) {
    onToken?.(cached);
    return cached;
  }

  const text = await streamCoaching({
    model: 'haiku',
    system: REACTIVE_SYSTEM,
    prompt: buildReactivePrompt(ctx),
    maxTokens: 300,
    onToken,
  });
  await setCachedExplanation(key, text);
  return text;
}
