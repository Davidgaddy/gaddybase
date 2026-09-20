import type { OpeningContinuation, OpeningEntry, OpeningIdentification } from './types';

interface TrieNode {
  children: Map<string, TrieNode>;
  /** Set only when this exact move path is itself a named entry in the database. */
  entry: OpeningEntry | null;
}

function buildTrie(entries: OpeningEntry[]): TrieNode {
  const root: TrieNode = { children: new Map(), entry: null };
  for (const entry of entries) {
    let node = root;
    for (const move of entry.moves) {
      let child = node.children.get(move);
      if (!child) {
        child = { children: new Map(), entry: null };
        node.children.set(move, child);
      }
      node = child;
    }
    if (!node.entry) node.entry = entry;
  }
  return root;
}

/**
 * Indexes the bundled ECO database by move sequence (a trie keyed by SAN
 * moves from move 1) so a live game can be matched against it ply by ply.
 *
 * Most positions in a real game aren't themselves a *named* entry — the
 * dataset only names specific well-known points — so a trie node can exist
 * (meaning "still within known theory") without carrying a name. `identify`
 * walks down remembering the deepest node that *did* carry a name; the walk
 * itself running out of matching children is what "left book" means.
 */
export class OpeningBook {
  private root: TrieNode;

  constructor(entries: OpeningEntry[]) {
    this.root = buildTrie(entries);
  }

  private walk(moveHistory: string[]): TrieNode | null {
    let node = this.root;
    for (const move of moveHistory) {
      const next = node.children.get(move);
      if (!next) return null;
      node = next;
    }
    return node;
  }

  /**
   * Returns the deepest named opening matched by any prefix of `moveHistory`,
   * or null if not even the first move is in the database.
   */
  identify(moveHistory: string[]): OpeningIdentification | null {
    let node = this.root;
    let best: { entry: OpeningEntry; depth: number } | null = null;

    for (let i = 0; i < moveHistory.length; i++) {
      const next = node.children.get(moveHistory[i]);
      if (!next) break;
      node = next;
      if (node.entry) best = { entry: node.entry, depth: i + 1 };
    }

    if (!best) return null;
    return {
      eco: best.entry.eco,
      name: best.entry.name,
      depth: best.depth,
      inBook: best.depth === moveHistory.length,
    };
  }

  /**
   * True once `moveHistory` no longer matches any known theoretical line at
   * all (not merely "the current position isn't itself named" — that can
   * still be true theory heading toward a named position a few plies later).
   */
  hasLeftBook(moveHistory: string[]): boolean {
    if (moveHistory.length === 0) return false;
    return this.walk(moveHistory) === null;
  }

  /**
   * The known theoretical replies to `moveHistory`. A continuation only
   * carries a name/ECO when the resulting position is itself a distinctly
   * named entry — otherwise theory continues under whatever `identify`
   * already reports for the current position.
   */
  continuations(moveHistory: string[]): OpeningContinuation[] {
    const node = this.walk(moveHistory);
    if (!node) return [];

    const results: OpeningContinuation[] = [];
    for (const [move, child] of node.children) {
      results.push({
        move,
        eco: child.entry?.eco ?? null,
        name: child.entry?.name ?? null,
      });
    }
    return results;
  }
}
