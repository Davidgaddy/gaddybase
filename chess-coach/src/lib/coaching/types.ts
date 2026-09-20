export type CoachModel = 'haiku' | 'sonnet';

export interface CandidateMoveInfo {
  san: string;
  cpScore: number | null;
  mateIn: number | null;
  pvSan: string[];
}

export interface OpeningContext {
  name: string;
  eco: string;
  inBook: boolean;
}

export interface ReactiveCoachingContext {
  fen: string;
  sideToMove: 'w' | 'b';
  lastMoveSan: string;
  lastMoveTag: string;
  lastMoveCpLoss: number;
  candidates: CandidateMoveInfo[];
  materialBalance: number;
  gamePhase: 'opening' | 'middlegame' | 'endgame';
  opening: OpeningContext | null;
}

export interface OpeningIdeaContext {
  name: string;
  eco: string;
  mainContinuations: string[];
}
