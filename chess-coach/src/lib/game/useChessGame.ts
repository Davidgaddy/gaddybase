import { Chess, type Square } from 'chess.js';
import { useCallback, useRef, useState } from 'react';

export interface MoveRecord {
  san: string;
  from: string;
  to: string;
  color: 'w' | 'b';
}

export interface GameState {
  fen: string;
  turn: 'w' | 'b';
  isGameOver: boolean;
  gameOverReason: string | null;
  history: MoveRecord[];
}

function deriveState(chess: Chess): GameState {
  let gameOverReason: string | null = null;
  if (chess.isCheckmate()) gameOverReason = 'Checkmate';
  else if (chess.isStalemate()) gameOverReason = 'Stalemate';
  else if (chess.isThreefoldRepetition()) gameOverReason = 'Threefold repetition';
  else if (chess.isInsufficientMaterial()) gameOverReason = 'Insufficient material';
  else if (chess.isDraw()) gameOverReason = 'Draw (50-move rule)';

  return {
    fen: chess.fen(),
    turn: chess.turn(),
    isGameOver: chess.isGameOver(),
    gameOverReason,
    history: chess.history({ verbose: true }).map((m) => ({
      san: m.san,
      from: m.from,
      to: m.to,
      color: m.color,
    })),
  };
}

export function useChessGame() {
  const chessRef = useRef(new Chess());
  const [state, setState] = useState<GameState>(() => deriveState(chessRef.current));

  const applyMove = useCallback((move: { from: string; to: string; promotion?: string }) => {
    try {
      const result = chessRef.current.move({
        from: move.from as Square,
        to: move.to as Square,
        promotion: move.promotion,
      });
      if (result) {
        setState(deriveState(chessRef.current));
        return result;
      }
    } catch {
      // Illegal move (chess.js throws rather than returning null for object-form moves).
    }
    return null;
  }, []);

  const reset = useCallback(() => {
    chessRef.current = new Chess();
    setState(deriveState(chessRef.current));
  }, []);

  return {
    ...state,
    applyMove,
    reset,
  };
}
