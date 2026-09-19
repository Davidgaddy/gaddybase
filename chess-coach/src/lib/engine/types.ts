/** One line of engine analysis for a single candidate move. */
export interface EngineLine {
  /** Best move for this line, UCI format (e.g. "e2e4", "e7e8q"). */
  move: string;
  /** Full principal variation, UCI format. */
  pv: string[];
  /** Centipawn score from the perspective of the side to move. Null if this line is a forced mate. */
  cpScore: number | null;
  /** Mate in N (positive = side to move mates, negative = side to move gets mated). Null if not a mate. */
  mateIn: number | null;
  /** 1-indexed rank among the multipv lines requested. */
  multipv: number;
  /** Search depth this line was last reported at. */
  depth: number;
}

export interface AnalyzeOptions {
  /** Search depth. Default 12. */
  depth?: number;
  /** Number of candidate lines to return. Default 1. */
  multipv?: number;
}
