import { Chess } from 'chess.js';
import type { StockfishEngine } from './StockfishEngine';
import type { EngineLine } from './types';

export type MoveQualityTag = 'Best' | 'Good' | 'Inaccuracy' | 'Mistake' | 'Blunder' | 'Theory';

export interface MoveQuality {
  tag: MoveQualityTag;
  /** Centipawn loss vs. the engine's best move, from the mover's perspective. Always >= 0. */
  cpLoss: number;
  /** Per-move accuracy percentage (0-100), Lichess-style win% swing formula. */
  accuracy: number;
  /** Best move available in the position, UCI format. */
  bestMove: string;
  bestEvalCp: number | null;
  bestMateIn: number | null;
  /** The full multipv result this grade was computed from (pre-move position, mover's perspective). */
  candidates: EngineLine[];
}

/**
 * A mate score is mapped to a large centipawn-equivalent so it can be compared
 * on the same scale as a cp score. Closer mates get a slightly larger
 * magnitude, but the exact distance barely matters once it's this lopsided.
 */
const MATE_COMPARABLE_BASE = 100_000;

function toComparable(line: Pick<EngineLine, 'cpScore' | 'mateIn'>): number {
  if (line.mateIn != null) {
    const magnitude = MATE_COMPARABLE_BASE - Math.min(Math.abs(line.mateIn), 999) * 10;
    return line.mateIn > 0 ? magnitude : -magnitude;
  }
  return line.cpScore ?? 0;
}

/** Lichess's cp -> win% conversion, from the perspective the cp score is given in. */
function winPercent(comparableCp: number): number {
  const cp = Math.max(-1000, Math.min(1000, comparableCp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

/** Lichess's per-move accuracy formula, derived from the win% swing across the move. */
function moveAccuracy(bestComparable: number, actualComparable: number): number {
  const winBefore = winPercent(bestComparable);
  const winAfter = winPercent(actualComparable);
  const raw = 103.1668 * Math.exp(-0.04354 * (winBefore - winAfter)) - 3.1668;
  return Math.max(0, Math.min(100, raw));
}

function tagFromCpLoss(cpLoss: number): MoveQualityTag {
  if (cpLoss <= 10) return 'Best';
  if (cpLoss <= 49) return 'Good';
  if (cpLoss <= 99) return 'Inaccuracy';
  if (cpLoss <= 249) return 'Mistake';
  return 'Blunder';
}

export interface GradeMoveOptions {
  depth?: number;
  multipv?: number;
}

/**
 * Grades a played move against the engine's best alternatives.
 *
 * Compares the position before the move (mover to move) against the position
 * after it (opponent to move, so the opponent's best reply is negated back to
 * the mover's perspective). If the played move is itself one of the returned
 * multipv candidates, its eval is read directly instead of running a second
 * search.
 *
 * Callers are expected to use an engine instance dedicated to analysis,
 * separate from the one picking the opponent's moves, so grading never
 * competes with (or is weakened by) the opponent's Skill Level setting.
 */
export async function gradeMove(
  engine: StockfishEngine,
  fenBefore: string,
  fenAfter: string,
  playedMoveUci: string,
  options: GradeMoveOptions = {},
): Promise<MoveQuality> {
  const depth = options.depth ?? 14;
  const multipv = options.multipv ?? 3;

  const beforeLines = await engine.analyze(fenBefore, { depth, multipv });
  const best = beforeLines[0];
  const bestEvalForMover = best ? toComparable(best) : 0;

  const matched = beforeLines.find((line) => line.move === playedMoveUci);
  let actualEvalForMover: number;

  if (matched) {
    actualEvalForMover = toComparable(matched);
  } else {
    const afterLines = await engine.analyze(fenAfter, { depth, multipv: 1 });
    if (afterLines.length > 0) {
      actualEvalForMover = -toComparable(afterLines[0]);
    } else {
      // No legal reply for the opponent: the played move ended the game.
      const afterBoard = new Chess(fenAfter);
      actualEvalForMover = afterBoard.isCheckmate() ? MATE_COMPARABLE_BASE : 0;
    }
  }

  const cpLoss = Math.max(0, Math.round(bestEvalForMover - actualEvalForMover));

  return {
    tag: tagFromCpLoss(cpLoss),
    cpLoss,
    accuracy: moveAccuracy(bestEvalForMover, actualEvalForMover),
    bestMove: best?.move ?? playedMoveUci,
    bestEvalCp: best?.cpScore ?? null,
    bestMateIn: best?.mateIn ?? null,
    candidates: beforeLines,
  };
}
