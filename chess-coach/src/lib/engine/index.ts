export { StockfishEngine } from './StockfishEngine';
export { parseInfoLine, parseBestMove } from './parseUci';
export { getOpponentMove, PRACTICE_BOT } from './opponent';
export type { OpponentConfig } from './opponent';
export type { EngineLine, AnalyzeOptions } from './types';

/** Path to the bundled single-threaded Stockfish worker script, served from /public. */
export const STOCKFISH_WORKER_URL = '/engine/stockfish-19-lite-single.js';
