import { useCallback, useEffect, useRef, useState } from 'react';
import { ChessBoard } from './components/ChessBoard';
import { STOCKFISH_WORKER_URL, StockfishEngine, getOpponentMove, PRACTICE_BOT } from './lib/engine';
import { parseUciMove } from './lib/game/uci';
import { useChessGame } from './lib/game/useChessGame';

const PLAYER_COLOR: 'w' | 'b' = 'w';

export default function App() {
  const game = useChessGame();
  const opponentEngineRef = useRef<StockfishEngine | null>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [botThinking, setBotThinking] = useState(false);

  useEffect(() => {
    const engine = new StockfishEngine(STOCKFISH_WORKER_URL);
    opponentEngineRef.current = engine;
    engine.newGame().then(() => setEngineReady(true));
    return () => engine.terminate();
  }, []);

  const requestBotMove = useCallback(async () => {
    const engine = opponentEngineRef.current;
    if (!engine) return;
    setBotThinking(true);
    try {
      const uciMove = await getOpponentMove(engine, game.fen, PRACTICE_BOT);
      if (uciMove) {
        game.applyMove(parseUciMove(uciMove));
      }
    } finally {
      setBotThinking(false);
    }
  }, [game]);

  useEffect(() => {
    if (!engineReady) return;
    if (game.isGameOver) return;
    if (game.turn !== PLAYER_COLOR) {
      void requestBotMove();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineReady, game.fen, game.isGameOver, game.turn]);

  const handleUserMove = useCallback(
    (from: string, to: string) => {
      if (game.turn !== PLAYER_COLOR || botThinking) return false;
      const result = game.applyMove({ from, to, promotion: 'q' });
      return result !== null;
    },
    [game, botThinking],
  );

  const statusText = (() => {
    if (game.gameOverReason) return game.gameOverReason;
    if (botThinking) return "Bot is thinking...";
    if (!engineReady) return 'Loading engine...';
    return game.turn === PLAYER_COLOR ? 'Your move' : "Bot's move";
  })();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center gap-6 py-8 px-4">
      <header className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Chess Coach</h1>
        <p className="text-sm text-slate-400">Phase 1: board + engine opponent</p>
      </header>

      <div className="flex flex-col items-center gap-3">
        <ChessBoard
          fen={game.fen}
          orientation={PLAYER_COLOR === 'w' ? 'white' : 'black'}
          interactive={engineReady && !botThinking && game.turn === PLAYER_COLOR && !game.isGameOver}
          onUserMove={handleUserMove}
        />
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-slate-300">{statusText}</span>
          <button
            type="button"
            onClick={() => game.reset()}
            className="rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-100 hover:bg-slate-700"
          >
            New game
          </button>
        </div>
      </div>

      <ol className="w-full max-w-[560px] text-sm text-slate-400 flex flex-wrap gap-x-3 gap-y-1">
        {game.history.map((move, i) => (
          <li key={i}>
            {i % 2 === 0 ? `${i / 2 + 1}. ` : ''}
            {move.san}
          </li>
        ))}
      </ol>
    </div>
  );
}
