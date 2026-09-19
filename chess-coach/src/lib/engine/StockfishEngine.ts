import { parseBestMove, parseInfoLine } from './parseUci';
import type { AnalyzeOptions, EngineLine } from './types';

/**
 * Thin wrapper around a single Stockfish Web Worker, speaking raw UCI.
 *
 * One instance == one engine == one position at a time. Commands sent to a
 * single instance are queued internally so callers never have to worry about
 * interleaving `position`/`go` pairs — but if you need two lines of analysis
 * running concurrently (e.g. opponent move + coaching analysis), use two
 * separate StockfishEngine instances rather than sharing one.
 */
export class StockfishEngine {
  private worker: Worker;
  private ready: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(scriptUrl: string) {
    this.worker = new Worker(scriptUrl);
    this.ready = this.handshake();
  }

  private handshake(): Promise<void> {
    return new Promise((resolve) => {
      const onMessage = (event: MessageEvent<string>) => {
        if (event.data === 'uciok') {
          this.worker.postMessage('isready');
        } else if (event.data === 'readyok') {
          this.worker.removeEventListener('message', onMessage);
          resolve();
        }
      };
      this.worker.addEventListener('message', onMessage);
      this.worker.postMessage('uci');
    });
  }

  private waitReady(): Promise<void> {
    return new Promise((resolve) => {
      const onMessage = (event: MessageEvent<string>) => {
        if (event.data === 'readyok') {
          this.worker.removeEventListener('message', onMessage);
          resolve();
        }
      };
      this.worker.addEventListener('message', onMessage);
      this.worker.postMessage('isready');
    });
  }

  /** Runs `fn` after all previously-queued work on this engine has settled. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn);
    // Swallow rejections in the queue chain itself so one failed request
    // doesn't permanently wedge every request after it.
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async setSkillLevel(level: number): Promise<void> {
    const clamped = Math.max(0, Math.min(20, Math.round(level)));
    await this.ready;
    return this.enqueue(async () => {
      this.worker.postMessage(`setoption name Skill Level value ${clamped}`);
      await this.waitReady();
    });
  }

  async newGame(): Promise<void> {
    await this.ready;
    return this.enqueue(async () => {
      this.worker.postMessage('ucinewgame');
      await this.waitReady();
    });
  }

  /**
   * Runs `go depth N` on `fen` with the requested MultiPV and resolves with
   * the final reported line for each multipv slot, ordered 1..N.
   */
  async analyze(fen: string, options: AnalyzeOptions = {}): Promise<EngineLine[]> {
    const depth = options.depth ?? 12;
    const multipv = options.multipv ?? 1;

    await this.ready;
    return this.enqueue(
      () =>
        new Promise<EngineLine[]>((resolve) => {
          const lines = new Map<number, EngineLine>();

          const onMessage = (event: MessageEvent<string>) => {
            const data = event.data;
            if (typeof data !== 'string') return;

            if (data.startsWith('info')) {
              const parsed = parseInfoLine(data);
              if (parsed) lines.set(parsed.multipv, parsed);
            } else if (data.startsWith('bestmove')) {
              this.worker.removeEventListener('message', onMessage);
              const best = parseBestMove(data);
              if (lines.size === 0 && best) {
                // Some depths/positions can report bestmove without a
                // matching info line (e.g. depth 0). Fall back to a
                // single-line result built from bestmove alone.
                lines.set(1, { move: best, pv: [best], cpScore: null, mateIn: null, multipv: 1, depth });
              }
              resolve([...lines.values()].sort((a, b) => a.multipv - b.multipv));
            }
          };

          this.worker.addEventListener('message', onMessage);
          this.worker.postMessage(`setoption name MultiPV value ${Math.max(1, multipv)}`);
          this.worker.postMessage(`position fen ${fen}`);
          this.worker.postMessage(`go depth ${depth}`);
        }),
    );
  }

  terminate(): void {
    this.worker.postMessage('quit');
    this.worker.terminate();
  }
}
