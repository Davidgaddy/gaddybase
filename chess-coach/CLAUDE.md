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
- ECO opening database as a static JSON asset (`public/data/eco.json`, ~2.2MB, 15,999 entries). Sourced from the `JeffML/eco.json` project's raw per-category files (`ecoA-E.json` + `eco_interpolated.json`, MIT-licensed aggregation of ECO/SCID/Wikibooks/lichess-derived opening data — see https://github.com/JeffML/eco.json), fetched once during development and transformed into `{eco, name, moves}` records (dropped FEN keys, aliases, scid — not needed), deduplicated by move path preferring canonical `eco_tsv` sources over the gap-filling `interpolated` ones. It's a one-time data-prep step, not a runtime dependency or API call — the app only ever reads the bundled file.

## Directory layout

```
src/
  lib/
    engine/        # Stockfish wrapper + UCI parsing. No React, no UI concerns.
      types.ts        EngineLine, AnalyzeOptions
      parseUci.ts      defensive UCI "info"/"bestmove" line parsing
      StockfishEngine.ts  one Worker per instance, internal command queue
      opponent.ts      bot move selection (placeholder in Phase 1)
      moveQuality.ts   gradeMove(): cp-loss tagging + per-move accuracy (Phase 2)
      index.ts         public exports + STOCKFISH_WORKER_URL
    game/           # chess.js wrapper, framework-agnostic move helpers
      useChessGame.ts  React hook: fen/turn/history/gameOver + applyMove/reset
      uci.ts           UCI move string <-> {from,to,promotion}
    opening/        # ECO database indexing. No engine calls, no React beyond one hook.
      types.ts         OpeningEntry, OpeningIdentification, OpeningContinuation
      OpeningBook.ts   trie over SAN move sequences; identify/hasLeftBook/continuations
      loadOpeningBook.ts  fetches + parses public/data/eco.json once, memoized
      useOpeningBook.ts   React hook wrapping the loader
      index.ts         public exports
  components/       # UI only. Never talk to the engine directly — go through lib/engine.
    ChessBoard.tsx
  App.tsx           # game screen: wires useChessGame + two engine instances + opening book
public/
  engine/           # bundled Stockfish worker script + wasm (static, not processed by Vite)
  data/
    eco.json          # bundled ECO database (see "Stack" above for provenance)
```

The rule going forward: **engine module, opening module, coaching module, and
UI components are separate.** Components call into `lib/engine`, `lib/opening`,
and (from Phase 4) `lib/coaching` — they never touch `postMessage`/UCI, the
opening trie, or the Anthropic client directly.

## Engine service design

- `StockfishEngine` wraps exactly one Worker. It internally queues commands
  (`enqueue()`) so a caller can never accidentally interleave two
  `position`/`go` pairs on the same instance — each `analyze()` call waits
  for the previous one on that instance to finish.
- **Two `StockfishEngine` instances run side by side** (`App.tsx`): one plays
  the opponent's moves at its configured Skill Level, the other is dedicated
  to grading/analysis and is explicitly pinned to Skill Level 20 (full
  strength) so coaching feedback is never distorted by the opponent's
  artificial weakening. They never share a Worker, so the opponent thinking
  and a grading request never interleave on the same UCI session.
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

## Move quality & accuracy (Phase 2)

- `gradeMove(engine, fenBefore, fenAfter, playedMoveUci, { depth, multipv })`
  (`lib/engine/moveQuality.ts`) grades one played move:
  1. Runs `analyze(fenBefore, { multipv: 3 })` to get the best line and a
     handful of alternatives, all from the mover's perspective.
  2. If the played move matches one of those multipv candidates, its eval is
     read directly — no second search needed.
  3. Otherwise it falls back to `analyze(fenAfter, { multipv: 1 })` (the
     opponent's best reply) and negates that score back to the mover's
     perspective. If there's no legal reply at all (the move ended the
     game), it special-cases checkmate/stalemate via a throwaway chess.js
     board rather than guessing from an empty engine result.
  4. `cpLoss = bestEval - actualEval` (both mover-relative; mate scores are
     mapped onto the same cp-like scale so they compare directly), which
     drives the tag: **Best** ≤10, **Good** ≤49, **Inaccuracy** 50-99,
     **Mistake** 100-249, **Blunder** 250+. The `Theory` tag exists in the
     type but nothing produces it yet — that's wired up once the opening
     database (Phase 3) can say a move is still book.
  5. Per-move accuracy uses Lichess's published win%-swing formula
     (`50 + 50·(2/(1+e^-0.00368208·cp) − 1)` for win%, then
     `103.1668·e^-0.04354·Δwin% − 3.1668` clamped to [0,100]) rather than a
     bespoke one — it's a known-reasonable curve and there's no reason to
     invent a new one. The header's running "Accuracy" is a plain mean of
     these per-move values, which is a simplification of Lichess's actual
     volatility-weighted average; fine for now, revisit if the numbers feel
     off in practice.
- Grading only ever runs on the human player's moves (`App.tsx` calls it from
  `handleUserMove`, never from the bot-move path) and runs in the background
  against the dedicated analysis engine — it doesn't block the board or the
  opponent's reply. Results land in React state keyed by ply index as each
  grading promise resolves, so tags can appear a beat after the move is made.

## Opening service (Phase 3)

- `OpeningBook` (`lib/opening/OpeningBook.ts`) indexes all 15,999 entries into
  a trie keyed by SAN move (from move 1). A trie node can exist without a
  name — most real positions aren't themselves one of the database's *named*
  entries, they're just on the way to one — so "in book" and "named" are
  different questions:
  - `identify(moveHistory)` walks the trie remembering the deepest node that
    *did* carry a name, and reports it with its ply depth and whether that
    name matches the current position exactly (`inBook`) or is a still-valid
    but shallower match.
  - `hasLeftBook(moveHistory)` is a pure walk: true the moment no trie node
    matches the full move sequence at all. A position can be un-named and
    still return `false` here (still in the book's move graph, just not a
    distinctly named point yet).
  - `continuations(moveHistory)` lists the current node's children; each only
    carries a name/ECO when that specific next position is itself named
    (otherwise theory just continues under whatever `identify` already
    reports). Built for Phase 5+ (Guided mode framing, trap warnings) —
    nothing renders it yet.
- `App.tsx` derives `sanHistory` from `game.history`, calls `identify`/
  `hasLeftBook` on every render via `useMemo`, and shows the name/ECO plus an
  "out of book" flag in the header — this is the whole Phase 3 UI surface,
  deliberately just display.
- The `Theory` move-quality tag (typed in Phase 2, unused until now) is now
  wired up: `handleUserMove` checks `!book.hasLeftBook([...sanBefore,
  playedSan])` right when the move is made and overrides `gradeMove`'s tag to
  `Theory` if so. This is a synchronous, free check (no engine call), so it
  happens before the async grading promise even resolves. Theory-tagged
  moves are excluded from the running accuracy average rather than scored,
  matching the original spec ("book moves get tagged Theory instead of
  scored") — a shallow-ish analysis depth calling a completely standard book
  move an "Inaccuracy" just because it isn't the engine's single top pick
  would be misleading, not helpful.
- The book is fetched once (`loadOpeningBook.ts` memoizes the promise) and
  built into the trie client-side; `useOpeningBook()` just re-renders once
  it's ready. ~2.2MB fetched + parsed + indexed on load — fine for a
  local-first single-user app, but if this ever needs to feel snappier on a
  cold load, pre-building the trie into the JSON asset (instead of an array
  of flat records) would remove the client-side index-build cost.

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
2. **Done.** Engine service multipv, move quality tags, accuracy score. No LLM.
3. **Done.** Opening service: bundled ECO database, live name detection, book-exit detection (display only).
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
