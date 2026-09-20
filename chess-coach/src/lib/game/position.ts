import { Chess, type Square } from 'chess.js';
import { parseUciMove } from './uci';

const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Material balance in pawns, positive favoring White. Parsed straight off the FEN board field. */
export function materialBalance(fen: string): number {
  const board = fen.split(' ')[0];
  let balance = 0;
  for (const ch of board) {
    if (ch === '/' || /\d/.test(ch)) continue;
    const value = PIECE_VALUES[ch.toLowerCase()] ?? 0;
    balance += ch === ch.toUpperCase() ? value : -value;
  }
  return balance;
}

export type GamePhase = 'opening' | 'middlegame' | 'endgame';

/** Rough phase heuristic from move count and remaining non-pawn material — good enough for coaching context, not a scoring input. */
export function gamePhase(fen: string): GamePhase {
  const fields = fen.split(' ');
  const board = fields[0];
  const fullmoveNumber = Number(fields[5]) || 1;

  let nonPawnMaterial = 0;
  let queens = 0;
  for (const ch of board) {
    const lower = ch.toLowerCase();
    if (lower === 'q') queens++;
    if (lower === 'n' || lower === 'b' || lower === 'r' || lower === 'q') {
      nonPawnMaterial += PIECE_VALUES[lower];
    }
  }

  if (fullmoveNumber <= 10) return 'opening';
  if (queens === 0 || nonPawnMaterial <= 10) return 'endgame';
  return 'middlegame';
}

/** Replays a line of UCI moves from `fen` and returns their SAN, stopping early on the first illegal/unparsable move. */
export function uciLineToSan(fen: string, uciMoves: string[]): string[] {
  const chess = new Chess(fen);
  const sanMoves: string[] = [];
  for (const uci of uciMoves) {
    const { from, to, promotion } = parseUciMove(uci);
    try {
      const result = chess.move({ from: from as Square, to: to as Square, promotion });
      if (!result) break;
      sanMoves.push(result.san);
    } catch {
      break;
    }
  }
  return sanMoves;
}
