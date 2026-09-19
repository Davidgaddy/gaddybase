import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChessBoard } from './components/ChessBoard';
import {
  STOCKFISH_WORKER_URL,
  StockfishEngine,
  getOpponentMove,
  gradeMove,
  PRACTICE_BOT,
  type MoveQuality,
} from './lib/engine';
import { parseUciMove } from './lib/game/uci';
import { useChessGame } from './lib/game/useChessGame';

const PLAYER_COLOR: 'w' | 'b' = 'w';

/** Analysis engine always plays at full strength — grading must be honest, unlike the opponent. */
const ANALYSIS_SKILL_LEVEL = 20;
const ANALYSIS_DEPTH = 14;
const ANALYSIS_MULTIPV = 3;

const TAG_STYLES: Record<MoveQuality['tag'], string> = {
  Best: 'text-emerald-400',
  Good: 'text-teal-400',
  Theory: 'text-sky-400',
  Inaccuracy: 'text-yellow-400',
  Mistake: 'text-orange-400',
  Blunder: 'text-red-500',
};

export default function App() {
  const game = useChessGame();
  const opponentEngineRef = useRef<StockfishEngine | null>(null);
  const analysisEngineRef = useRef<StockfishEngine | null>(null);
  const [opponentReady, setOpponentReady] = useState(false);
  const [botThinking, setBotThinking] = useState(false);
  const [moveQualities, setMoveQualities] = useState<Record<number, MoveQuality>>({});

  useEffect(() => {
    const opponent = new StockfishEngine(STOCKFISH_WORKER_URL);
    opponentEngineRef.current = opponent;
    opponent.newGame().then(() => setOpponentReady(true));

    const analysis = new StockfishEngine(STOCKFISH_WORKER_URL);
    analysisEngineRef.current = analysis;
    analysis.newGame().then(() => analysis.setSkillLevel(ANALYSIS_SKILL_LEVEL));

    return () => {
      opponent.terminate();
      analysis.terminate();
    };
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
    if (!opponentReady) return;
    if (game.isGameOver) return;
    if (game.turn !== PLAYER_COLOR) {
      void requestBotMove();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opponentReady, game.fen, game.isGameOver, game.turn]);

  const gradePlayerMove = useCallback((plyIndex: number, fenBefore: string, fenAfter: string, playedMoveUci: string) => {
    const engine = analysisEngineRef.current;
    if (!engine) return;
    gradeMove(engine, fenBefore, fenAfter, playedMoveUci, {
      depth: ANALYSIS_DEPTH,
      multipv: ANALYSIS_MULTIPV,
    })
      .then((quality) => {
        setMoveQualities((prev) => ({ ...prev, [plyIndex]: quality }));
      })
      .catch(() => {
        // Grading is best-effort; a failed analysis just leaves that move untagged.
      });
  }, []);

  const handleUserMove = useCallback(
    (from: string, to: string) => {
      if (game.turn !== PLAYER_COLOR || botThinking) return false;
      const plyIndex = game.history.length;
      const result = game.applyMove({ from, to, promotion: 'q' });
      if (!result) return false;
      gradePlayerMove(plyIndex, result.before, result.after, result.lan);
      return true;
    },
    [game, botThinking, gradePlayerMove],
  );

  const accuracy = useMemo(() => {
    const values = Object.values(moveQualities).map((q) => q.accuracy);
    if (values.length === 0) return null;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }, [moveQualities]);

  const statusText = (() => {
    if (game.gameOverReason) return game.gameOverReason;
    if (botThinking) return 'Bot is thinking...';
    if (!opponentReady) return 'Loading engine...';
    return game.turn === PLAYER_COLOR ? 'Your move' : "Bot's move";
  })();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center gap-6 py-8 px-4">
      <header className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Chess Coach</h1>
        <p className="text-sm text-slate-400">Phase 2: move quality + accuracy</p>
        {accuracy !== null && (
          <p className="mt-1 text-sm font-medium text-slate-200">
            Accuracy: <span className="text-emerald-400">{accuracy.toFixed(1)}%</span>
          </p>
        )}
      </header>

      <div className="flex flex-col items-center gap-3">
        <ChessBoard
          fen={game.fen}
          orientation={PLAYER_COLOR === 'w' ? 'white' : 'black'}
          interactive={opponentReady && !botThinking && game.turn === PLAYER_COLOR && !game.isGameOver}
          onUserMove={handleUserMove}
        />
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-slate-300">{statusText}</span>
          <button
            type="button"
            onClick={() => {
              game.reset();
              setMoveQualities({});
            }}
            className="rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-100 hover:bg-slate-700"
          >
            New game
          </button>
        </div>
      </div>

      <ol className="w-full max-w-[560px] text-sm text-slate-400 flex flex-wrap gap-x-3 gap-y-1">
        {game.history.map((move, i) => {
          const quality = moveQualities[i];
          return (
            <li key={i}>
              {i % 2 === 0 ? `${i / 2 + 1}. ` : ''}
              {move.san}
              {quality && <span className={`ml-1 text-xs font-semibold ${TAG_STYLES[quality.tag]}`}>{quality.tag}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
