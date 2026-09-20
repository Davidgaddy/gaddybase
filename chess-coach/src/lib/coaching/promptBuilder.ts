import type { OpeningIdeaContext, ReactiveCoachingContext } from './types';

/**
 * The LLM never gets to invent facts here — every number and name in the
 * prompt comes from the engine or the opening database. Its only job is
 * prose: explain the ideas behind numbers the app already computed.
 */
export const REACTIVE_SYSTEM = `You are a warm, direct chess coach reviewing a student's move right after they played it.

Everything you are told is objective fact: the position, the move played, engine evaluations, and material/phase info. Never invent facts, never state an opening name or ECO code that isn't given to you, never claim a line is theory unless you're told it is.

Explain in plain English what the move accomplished (or gave up), and — only if it lost a meaningful amount of evaluation — what would have been better and why, in chess-idea terms (control, weaknesses, king safety, piece activity, development), not just "the engine prefers X." If the move was fine or the best choice, say so briefly and move on; don't manufacture a criticism.

Keep it to 2-4 sentences, no bullet points, no headers, no restating the move in notation more than once. Sound like a knowledgeable human talking, not a report generator.`;

export function buildReactivePrompt(ctx: ReactiveCoachingContext): string {
  const lines: string[] = [];
  lines.push(`Position (FEN): ${ctx.fen}`);
  lines.push(`Side to move now: ${ctx.sideToMove === 'w' ? 'White' : 'Black'}`);
  lines.push(`Move just played: ${ctx.lastMoveSan} (quality: ${ctx.lastMoveTag}, centipawn loss vs. best: ${ctx.lastMoveCpLoss})`);
  lines.push(
    `Material balance: ${
      ctx.materialBalance > 0
        ? `White up ${ctx.materialBalance}`
        : ctx.materialBalance < 0
          ? `Black up ${-ctx.materialBalance}`
          : 'even'
    } (pawns)`,
  );
  lines.push(`Game phase: ${ctx.gamePhase}`);
  if (ctx.opening) {
    lines.push(
      `Opening: ${ctx.opening.name} (${ctx.opening.eco})${ctx.opening.inBook ? ', still in book' : ', now out of book'}`,
    );
  }
  if (ctx.candidates.length > 0) {
    lines.push('Top engine candidates for that position, best first:');
    for (const c of ctx.candidates) {
      const score = c.mateIn != null ? `mate in ${Math.abs(c.mateIn)}` : `${((c.cpScore ?? 0) / 100).toFixed(2)} pawns`;
      lines.push(`- ${c.san} (${score})${c.pvSan.length > 1 ? `, line: ${c.pvSan.join(' ')}` : ''}`);
    }
  }
  lines.push('Explain what the played move accomplished and, if relevant, what was missed.');
  return lines.join('\n');
}

export const OPENING_IDEA_SYSTEM = `You are a chess coach explaining the ideas behind an opening, not its moves.

You are given the opening's name, ECO code, and its known main continuations. Never invent move sequences, never claim moves beyond what's listed, never state a fact about the opening you weren't given.

In 2-3 sentences, explain what each side is trying to achieve, the key pawn breaks or piece placements, and what the resulting middlegame tends to look like. Write like a coach talking to a student, not a textbook entry.`;

export function buildOpeningIdeaPrompt(ctx: OpeningIdeaContext): string {
  const lines: string[] = [];
  lines.push(`Opening: ${ctx.name} (${ctx.eco})`);
  if (ctx.mainContinuations.length > 0) {
    lines.push(`Known main continuations from here: ${ctx.mainContinuations.join(', ')}`);
  }
  lines.push('Explain the plans and ideas for both sides.');
  return lines.join('\n');
}
