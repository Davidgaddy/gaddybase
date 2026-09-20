import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChessBoard } from './components/ChessBoard';
import { explainLastMove, explainOpeningIdea, type ReactiveCoachingContext } from './lib/coaching';
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
import { gamePhase, materialBalance, uciLineToSan } from './lib/game/position';
import { useOpeningBook } from './lib/opening';

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
  const book = useOpeningBook();
  const opponentEngineRef = useRef<StockfishEngine | null>(null);
  const analysisEngineRef = useRef<StockfishEngine | null>(null);
  const [opponentReady, setOpponentReady] = useState(false);
  const [botThinking, setBotThinking] = useState(false);
  const [moveQualities, setMoveQualities] = useState<Record<number, MoveQuality>>({});

  const [moveCommentary, setMoveCommentary] = useState('');
  const [moveCommentaryLoading, setMoveCommentaryLoading] = useState(false);
  const [moveCommentaryError, setMoveCommentaryError] = useState<string | null>(null);
  const [moveCommentarySan, setMoveCommentarySan] = useState<string | null>(null);

  const [openingIdea, setOpeningIdea] = useState('');
  const [openingIdeaLoading, setOpeningIdeaLoading] = useState(false);
  const [openingIdeaError, setOpeningIdeaError] = useState<string | null>(null);

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

  const requestMoveCommentary = useCallback((ctx: ReactiveCoachingContext) => {
    setMoveCommentarySan(ctx.lastMoveSan);
    setMoveCommentary('');
    setMoveCommentaryError(null);
    setMoveCommentaryLoading(true);
    explainLastMove(ctx, (delta) => setMoveCommentary((prev) => prev + delta))
      .catch((error: unknown) => {
        setMoveCommentaryError(error instanceof Error ? error.message : 'Coaching request failed');
      })
      .finally(() => setMoveCommentaryLoading(false));
  }, []);

  const gradePlayerMove = useCallback(
    (
      plyIndex: number,
      fenBefore: string,
      fenAfter: string,
      playedMoveUci: string,
      playedMoveSan: string,
      isBookMove: boolean,
      openingCtx: ReactiveCoachingContext['opening'],
    ) => {
      const engine = analysisEngineRef.current;
      if (!engine) return;
      gradeMove(engine, fenBefore, fenAfter, playedMoveUci, {
        depth: ANALYSIS_DEPTH,
        multipv: ANALYSIS_MULTIPV,
      })
        .then((quality) => {
          // Book moves are known-sound by definition — tag them Theory rather
          // than let a shallow-ish analysis depth call a standard theoretical
          // move an "Inaccuracy" just because it isn't the engine's top pick.
          const finalQuality: MoveQuality = isBookMove ? { ...quality, tag: 'Theory' } : quality;
          setMoveQualities((prev) => ({ ...prev, [plyIndex]: finalQuality }));

          requestMoveCommentary({
            fen: fenBefore,
            sideToMove: fenBefore.split(' ')[1] as 'w' | 'b',
            lastMoveSan: playedMoveSan,
            lastMoveTag: finalQuality.tag,
            lastMoveCpLoss: finalQuality.cpLoss,
            candidates: quality.candidates.slice(0, 4).map((line) => ({
              san: uciLineToSan(fenBefore, [line.move])[0] ?? line.move,
              cpScore: line.cpScore,
              mateIn: line.mateIn,
              pvSan: uciLineToSan(fenBefore, line.pv.slice(0, 6)),
            })),
            materialBalance: materialBalance(fenBefore),
            gamePhase: gamePhase(fenBefore),
            opening: openingCtx,
          });
        })
        .catch(() => {
          // Grading is best-effort; a failed analysis just leaves that move untagged.
        });
    },
    [requestMoveCommentary],
  );

  const handleUserMove = useCallback(
    (from: string, to: string) => {
      if (game.turn !== PLAYER_COLOR || botThinking) return false;
      const plyIndex = game.history.length;
      const sanBefore = game.history.map((m) => m.san);
      const result = game.applyMove({ from, to, promotion: 'q' });
      if (!result) return false;

      const isBookMove = book ? !book.hasLeftBook([...sanBefore, result.san]) : false;
      const openingBefore = book ? book.identify(sanBefore) : null;
      const openingCtx = openingBefore
        ? { name: openingBefore.name, eco: openingBefore.eco, inBook: openingBefore.inBook }
        : null;

      gradePlayerMove(plyIndex, result.before, result.after, result.lan, result.san, isBookMove, openingCtx);
      return true;
    },
    [game, botThinking, gradePlayerMove, book],
  );

  const handleUndo = useCallback(() => {
    if (botThinking || game.history.length === 0) return;
    const pliesToUndo = game.turn === PLAYER_COLOR && game.history.length >= 2 ? 2 : 1;
    const keepBelow = game.history.length - pliesToUndo;
    game.undo(pliesToUndo);
    setMoveQualities((prev) => {
      const next: Record<number, MoveQuality> = {};
      for (const [key, value] of Object.entries(prev)) {
        if (Number(key) < keepBelow) next[Number(key)] = value;
      }
      return next;
    });
    setMoveCommentary('');
    setMoveCommentarySan(null);
    setMoveCommentaryError(null);
  }, [game, botThinking]);

  const sanHistory = useMemo(() => game.history.map((m) => m.san), [game.history]);
  const opening = useMemo(() => (book ? book.identify(sanHistory) : null), [book, sanHistory]);
  const leftBook = useMemo(() => (book ? book.hasLeftBook(sanHistory) : false), [book, sanHistory]);

  useEffect(() => {
    if (!book || !opening) return;
    const continuations = book
      .continuations(sanHistory.slice(0, opening.depth))
      .map((c) => c.move)
      .slice(0, 6);
    setOpeningIdea('');
    setOpeningIdeaError(null);
    setOpeningIdeaLoading(true);
    explainOpeningIdea({ name: opening.name, eco: opening.eco, mainContinuations: continuations }, (delta) =>
      setOpeningIdea((prev) => prev + delta),
    )
      .catch((error: unknown) => {
        setOpeningIdeaError(error instanceof Error ? error.message : 'Coaching request failed');
      })
      .finally(() => setOpeningIdeaLoading(false));
    // Only re-fetch when the identified opening itself changes, not on every position update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, opening?.eco]);

  const accuracy = useMemo(() => {
    // Theory moves are known-sound by definition, so they're excluded rather than scored.
    const values = Object.values(moveQualities)
      .filter((q) => q.tag !== 'Theory')
      .map((q) => q.accuracy);
    if (values.length === 0) return null;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }, [moveQualities]);

  const statusText = (() => {
    if (game.gameOverReason) return game.gameOverReason;
    if (botThinking) return 'Bot is thinking...';
    if (!opponentReady) return 'Loading engine...';
    return game.turn === PLAYER_COLOR ? 'Your move' : "Bot's move";
  })();

  const canUndo = !botThinking && game.history.length > 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center gap-6 py-8 px-4">
      <header className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Chess Coach</h1>
        <p className="text-sm text-slate-400">Phase 4: reactive coaching</p>
        {opening && (
          <p className="mt-1 text-sm text-slate-300">
            {opening.name} <span className="text-slate-500">({opening.eco})</span>
            {leftBook && <span className="ml-2 text-amber-400">· out of book</span>}
          </p>
        )}
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
            onClick={handleUndo}
            disabled={!canUndo}
            className="rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-100 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={() => {
              game.reset();
              setMoveQualities({});
              setMoveCommentary('');
              setMoveCommentarySan(null);
              setMoveCommentaryError(null);
            }}
            className="rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-100 hover:bg-slate-700"
          >
            New game
          </button>
        </div>
      </div>

      <div className="w-full max-w-[560px] flex flex-col gap-3">
        {(openingIdea || openingIdeaLoading || openingIdeaError) && (
          <div className="rounded-lg border border-sky-900 bg-sky-950/40 p-3 text-sm text-sky-100">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-sky-400">
              {opening?.name} ({opening?.eco})
            </p>
            {openingIdeaError ? (
              <p className="text-sky-300/70">Coaching unavailable: {openingIdeaError}</p>
            ) : (
              <p>
                {openingIdea}
                {openingIdeaLoading && <span className="animate-pulse">▍</span>}
              </p>
            )}
          </div>
        )}

        {(moveCommentary || moveCommentaryLoading || moveCommentaryError) && (
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-sm text-slate-200">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Coach on {moveCommentarySan}
            </p>
            {moveCommentaryError ? (
              <p className="text-slate-500">Coaching unavailable: {moveCommentaryError}</p>
            ) : (
              <p>
                {moveCommentary}
                {moveCommentaryLoading && <span className="animate-pulse">▍</span>}
              </p>
            )}
          </div>
        )}
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
