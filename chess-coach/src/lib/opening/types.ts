/** One named position from the bundled ECO database, keyed by its SAN move path from move 1. */
export interface OpeningEntry {
  eco: string;
  name: string;
  moves: string[];
}

export interface OpeningIdentification {
  eco: string;
  name: string;
  /** Ply count (half-moves) at which this name/ECO was last matched. */
  depth: number;
  /** True if the current position (not just some earlier prefix of it) is itself this named entry. */
  inBook: boolean;
}

export interface OpeningContinuation {
  /** SAN of the candidate next move. */
  move: string;
  /** Name/ECO of the position that move leads to, only when that position is itself a distinctly named entry. */
  eco: string | null;
  name: string | null;
}
