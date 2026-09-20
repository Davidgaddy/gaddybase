import { OpeningBook } from './OpeningBook';
import type { OpeningEntry } from './types';

/** Bundled locally (public/data/eco.json) — never fetched from a third-party API at runtime. */
const ECO_DATA_URL = '/data/eco.json';

let cached: Promise<OpeningBook> | null = null;

/** Loads and indexes the bundled ECO database exactly once; later calls reuse the same instance. */
export function loadOpeningBook(): Promise<OpeningBook> {
  if (!cached) {
    cached = fetch(ECO_DATA_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load opening book: ${res.status}`);
        return res.json() as Promise<OpeningEntry[]>;
      })
      .then((entries) => new OpeningBook(entries));
  }
  return cached;
}
