import type { EngineLine } from './types';

/**
 * Parses a single UCI "info" line into an EngineLine.
 *
 * Stockfish builds vary in field order and in whether "multipv" is present
 * at all (some omit it when multipv=1), so this walks tokens looking for
 * known keys rather than assuming a fixed layout. "pv" is assumed to run
 * to the end of the line, which holds across all known Stockfish builds.
 *
 * Returns null for info lines that carry no principal variation (e.g.
 * "info currmove ..." during move ordering) since those aren't candidates.
 */
export function parseInfoLine(line: string): EngineLine | null {
  if (!line.startsWith('info ')) return null;

  const tokens = line.trim().split(/\s+/);
  let depth = 0;
  let multipv = 1;
  let cpScore: number | null = null;
  let mateIn: number | null = null;
  let pv: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === 'depth') {
      depth = Number(tokens[++i]) || 0;
    } else if (token === 'multipv') {
      multipv = Number(tokens[++i]) || 1;
    } else if (token === 'score') {
      const kind = tokens[++i];
      const value = Number(tokens[++i]);
      if (kind === 'cp') {
        cpScore = value;
      } else if (kind === 'mate') {
        mateIn = value;
      }
      // Some builds tack on "lowerbound"/"upperbound" right after the score.
      if (tokens[i + 1] === 'lowerbound' || tokens[i + 1] === 'upperbound') {
        i++;
      }
    } else if (token === 'pv') {
      pv = tokens.slice(i + 1);
      break;
    }
  }

  if (pv.length === 0) return null;

  return {
    move: pv[0],
    pv,
    cpScore,
    mateIn,
    multipv,
    depth,
  };
}

/** Parses a "bestmove <move> [ponder <move>]" line. Returns null for "bestmove (none)". */
export function parseBestMove(line: string): string | null {
  const match = line.match(/^bestmove\s+(\S+)/);
  if (!match) return null;
  const move = match[1];
  return move === '(none)' ? null : move;
}
