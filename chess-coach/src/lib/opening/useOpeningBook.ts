import { useEffect, useState } from 'react';
import { loadOpeningBook } from './loadOpeningBook';
import type { OpeningBook } from './OpeningBook';

/** Loads the opening book once and re-renders when it's ready. Null while loading. */
export function useOpeningBook(): OpeningBook | null {
  const [book, setBook] = useState<OpeningBook | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadOpeningBook().then((loaded) => {
      if (!cancelled) setBook(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return book;
}
