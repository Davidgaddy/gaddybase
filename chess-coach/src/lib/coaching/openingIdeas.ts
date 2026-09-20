import { getCachedExplanation, openingIdeaCacheKey, setCachedExplanation } from './cache';
import { buildOpeningIdeaPrompt, OPENING_IDEA_SYSTEM } from './promptBuilder';
import { streamCoaching } from './proxyClient';
import type { OpeningIdeaContext } from './types';

/**
 * Explains the plans behind a named opening. Cached by ECO code alone (not
 * FEN) — the idea behind the Najdorf doesn't change between games, so this
 * call is spent at most once per opening, ever.
 */
export async function explainOpeningIdea(ctx: OpeningIdeaContext, onToken?: (delta: string) => void): Promise<string> {
  const key = openingIdeaCacheKey(ctx.eco);
  const cached = await getCachedExplanation(key);
  if (cached) {
    onToken?.(cached);
    return cached;
  }

  const text = await streamCoaching({
    model: 'haiku',
    system: OPENING_IDEA_SYSTEM,
    prompt: buildOpeningIdeaPrompt(ctx),
    maxTokens: 260,
    onToken,
  });
  await setCachedExplanation(key, text);
  return text;
}
