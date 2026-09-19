# Chess Coach — architecture notes

Local-first, single-player chess coaching app. No auth, no backend database,
no multiplayer. Built incrementally per an agreed 9-phase build order — see
"Build order" below for what's done and what's next. Each phase should leave
the app in a playable state before the next one starts.

## Stack

- Vite + React + TypeScript
- Tailwind CSS v4 (via `@tailwindcss/vite`, CSS-first config — no `tailwind.config.js`, styling lives in `src/index.css` + utility classes)
- `chess.js` 1.x for rules/state (note: `.move()` throws on illegal moves when passed an object, unlike some older versions — always wrap in try/catch)
- `react-chessboard` 5.x for the board. This major version has a different API from v4: a single `<Chessboard options={...} />` component, no more `boardWidth`/`onDrop` props — position, orientation, and all handlers live inside `options`. `onPieceDrop` receives `{ piece, sourceSquare, targetSquare }` and returns a boolean (accept/reject, controls snap-back).
- Stockfish via the `stockfish` npm package (nmrugg/stockfish.js), **lite single-threaded build** (`stockfish-19-lite-single.js/.wasm`, ~1.8MB). Chosen deliberately over the full build (99MB wasm, multi-threaded, needs COOP/COEP) and over the plain single-threaded build (also ~99MB) — lite is still far stronger than any human, loads fast, and needs no cross-origin isolation headers. The engine files are copied into `public/engine/` (not imported through the bundler) and loaded via `new Worker('/engine/stockfish-19-lite-single.js')`.
- Dexie (IndexedDB) — not yet added, lands in Phase 7 (persistence).
- Anthropic API via a server-side proxy — not yet added, lands in Phase 4. The key must never reach the client bundle.

## Directory layout

```
src/
  lib/
    engine/        # Stockfish wrapper + UCI parsing. No React, no UI concerns.
      types.ts        EngineLine, AnalyzeOptions
      parseUci.ts      defensive UCI "info"/"bestmove" line parsing
      StockfishEngine.ts  one Worker per instance, internal command queue
      opponent.ts      bot move selection (placeholder in Phase 1)
      index.ts         public exports + STOCKFISH_WORKER_URL
    game/           # chess.js wrapper, framework-agnostic move helpers
      useChessGame.ts  React hook: fen/turn/history/gameOver + applyMove/reset
      uci.ts           UCI move string <-> {from,to,promotion}
  components/       # UI only. Never talk to the engine directly — go through lib/engine.
    ChessBoard.tsx
  App.tsx           # phase-1 game screen: wires useChessGame + one engine instance
public/
  engine/           # bundled Stockfish worker script + wasm (static, not processed by Vite)
```

The rule going forward: **engine module, opening module, coaching module, and
UI components are separate.** Components call into `lib/engine` and (from
Phase 3) `lib/opening` and (from Phase 4) `lib/coaching` — they never touch
`postMessage`/UCI or the Anthropic client directly.

## Engine service design

- `StockfishEngine` wraps exactly one Worker. It internally queues commands
  (`enqueue()`) so a caller can never accidentally interleave two
  `position`/`go` pairs on the same instance — each `analyze()` call waits
  for the previous one on that instance to finish.
- Per the spec, **opponent-move analysis and coaching analysis will use two
  separate `StockfishEngine` instances** (two Workers) once coaching lands in
  Phase 4, rather than sharing one and depending on the queue for isolation.
  Phase 1 only needs the opponent instance.
- `analyze(fen, { depth, multipv })` resolves with `EngineLine[]`, one entry
  per multipv slot, sorted ascending. `cpScore`/`mateIn` are from the
  perspective of the side to move (raw UCI convention) — anything that wants
  a White-relative score converts at the call site, not in the engine layer.
- UCI `info` line parsing (`parseUci.ts`) is defensive on purpose: it walks
  tokens looking for known keys instead of assuming fixed field order/
  presence, because Stockfish builds vary (e.g. `multipv` is sometimes
  omitted when multipv=1). `pv` is assumed to run to the end of the line —
  true across all known builds — so parsing bails out and doesn't force a
  parse if a required field is missing.
- Move quality tagging, accuracy %, and the second (coaching) engine instance
  are Phase 2 work — not implemented yet.

## Known simplifications (revisit later)

- Pawn promotion always defaults to queen on drag-drop (`ChessBoard.tsx` /
  `App.tsx` hardcode `promotion: 'q'`). A promotion picker is a small UI
  addition; not needed for Phase 1's "is it playable" bar.
- The Phase 1 opponent (`PRACTICE_BOT` in `lib/engine/opponent.ts`) is a
  single fixed-strength placeholder (Skill Level 5, depth 8, always top
  move). The full bot personality system (Rook/Blitz/Anchor/Trade/Iron,
  picker strategies, opening repertoires) is Phase 6.

## Build order (stop-and-play after each phase)

1. **Done.** Board, chess.js, legal moves, one hardcoded Stockfish opponent.
2. Engine service multipv, move quality tags, accuracy score. No LLM.
3. Opening service: bundled ECO database, live name detection, book-exit detection (display only).
4. Coaching panel, Reactive mode only, server-side Anthropic proxy, opening-idea explanations, LLM response cache in IndexedDB.
5. Guided mode, blunder guard + one takeback, opening trap warnings.
6. Bot personalities with repertoires (picker-strategy interface, one file per bot), pre-game selection screen.
7. Post-game review, Dexie persistence, mistake/opening stats.
8. Repertoire trainer mode (book-only correctness, spaced repetition).
9. Adaptive difficulty (rolling CPL, per-bot skill adjustment) + tactical-theme weakness tracking.

## Conventions

- No new dependency without asking first — the approved stack is listed above.
- Desktop-first layout; board must remain usable on mobile viewports (verified via Playwright screenshot at 390×844 in Phase 1).
- Never call the LLM for anything the engine or the opening database can answer numerically/factually — LLM is prose only, and its outputs are cached by FEN+mode (moves) or ECO code (opening ideas) once Phase 4 lands.
