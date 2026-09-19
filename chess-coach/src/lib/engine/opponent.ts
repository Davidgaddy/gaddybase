import type { StockfishEngine } from './StockfishEngine';

export interface OpponentConfig {
  skillLevel: number;
  depth: number;
}

/**
 * Phase 1 placeholder opponent: fixed Stockfish Skill Level, always plays
 * its top choice. Bot personalities (repertoires, picker strategies, move
 * randomization) land in a later phase — this just proves the engine loop.
 */
export const PRACTICE_BOT: OpponentConfig = {
  skillLevel: 5,
  depth: 8,
};

export async function getOpponentMove(
  engine: StockfishEngine,
  fen: string,
  config: OpponentConfig = PRACTICE_BOT,
): Promise<string | null> {
  await engine.setSkillLevel(config.skillLevel);
  const lines = await engine.analyze(fen, { depth: config.depth, multipv: 1 });
  return lines[0]?.move ?? null;
}
