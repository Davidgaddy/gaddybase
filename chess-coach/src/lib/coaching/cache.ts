import Dexie, { type Table } from 'dexie';

interface CachedExplanation {
  key: string;
  text: string;
  createdAt: number;
}

class CoachingCacheDb extends Dexie {
  explanations!: Table<CachedExplanation, string>;

  constructor() {
    super('chess-coach-llm-cache');
    this.version(1).stores({
      explanations: 'key',
    });
  }
}

const db = new CoachingCacheDb();

/** Reactive move commentary is cached by FEN + mode — the same position always gets the same review. */
export function reactiveCacheKey(fen: string, mode: string): string {
  return `reactive:${mode}:${fen}`;
}

/** Opening-idea explanations are cached by ECO code alone, so they're reused across every game, not just this one. */
export function openingIdeaCacheKey(eco: string): string {
  return `opening-idea:${eco}`;
}

export async function getCachedExplanation(key: string): Promise<string | null> {
  const row = await db.explanations.get(key);
  return row?.text ?? null;
}

export async function setCachedExplanation(key: string, text: string): Promise<void> {
  await db.explanations.put({ key, text, createdAt: Date.now() });
}
