import type { Rect } from '@embedpdf/core-geometry';
import type { AbortablePromise, SearchSlice } from '@embedpdf/engine-core/runtime';
export const MatchFlag = { MatchCase: 'matchCase', MatchWholeWord: 'wholeWord' } as const;
export type MatchFlag = typeof MatchFlag[keyof typeof MatchFlag];
export interface SearchResult { pageIndex: number; rects: Rect[] }
import { createStore } from 'zustand/vanilla';
import type { PdfRuntime } from '../engine/pdf-runtime';

export interface PdfSearchState {
  documentId: string | null;
  query: string;
  flags: MatchFlag[];
  results: SearchResult[];
  resultsByPage: ReadonlyMap<number, PageSearchResult[]>;
  activeResultIndex: number;
  loading: boolean;
  attach(pdfium: PdfRuntime): void;
  setDocument(documentId: string | null): void;
  clear(): void;
  run(query: string, flags?: MatchFlag[], nearPage?: number): void;
  toggleFlag(flag: MatchFlag, query?: string, nearPage?: number): void;
  move(direction: -1 | 1): void;
  dispose(): void;
}

export interface PageSearchResult {
  result: SearchResult;
  resultIndex: number;
}

const EMPTY_SEARCH = {
  documentId: null,
  query: '',
  flags: [] as MatchFlag[],
  results: [] as SearchResult[],
  resultsByPage: new Map<number, PageSearchResult[]>(),
  activeResultIndex: -1,
  loading: false,
};

export function createPdfSearchStore() {
  let pdfium: PdfRuntime | null = null;
  let task: AbortablePromise<SearchSlice> | null = null;

  let generation = 0;
  const cancel = (_message: string) => {
    const current = task;
    task = null;
    current?.abort();
    generation++;
  };

  return createStore<PdfSearchState>((set, get) => {
    const clear = () => {
      cancel('search cleared');
      const { documentId, flags } = get();
      set({ ...EMPTY_SEARCH, documentId, flags });
    };

    const run: PdfSearchState['run'] = (query, flags = get().flags, nearPage = 0) => {
      const { documentId } = get();
      const keyword = query.trim();
      if (!pdfium || !documentId || !keyword) {
        clear();
        return;
      }

      cancel('new search');
      set({ query: keyword, flags, results: [], resultsByPage: new Map(), activeResultIndex: -1, loading: true });

      const currentGeneration = generation;
      void (async () => {
        try {
          const document = pdfium!.getDocument(documentId);
          if (!document) throw new Error('Document is not open.');
          const pages = await document.pages.list();
          let cursor: string | undefined;
          const results: SearchResult[] = [];
          do {
            if (generation !== currentGeneration) return;
            const current = document.search.query({ text: keyword, matchCase: flags.includes(MatchFlag.MatchCase), wholeWord: flags.includes(MatchFlag.MatchWholeWord), cursor, limit: { pages: 16, matches: 256 } });
            task = current;
            const batch = await current;
            if (generation !== currentGeneration) return;
            for (const match of batch.matches) {
              const pageIndex = pages.pages.findIndex((page) => JSON.stringify(page.ref) === JSON.stringify(match.page));
              if (pageIndex >= 0) results.push({ pageIndex, rects: match.segments.map((segment) => segment.rect) });
            }
            set({ results: [...results], resultsByPage: indexResultsByPage(results), activeResultIndex: findNearestResult(results, nearPage) });
            cursor = batch.nextCursor ?? undefined;
          } while (cursor);
          task = null;
          set({ loading: false });
        } catch (error) {
          if (generation !== currentGeneration) return;
          console.error('[pdf-ts] PDF search failed', error);
          task = null;
          set({ results: [], resultsByPage: new Map(), activeResultIndex: -1, loading: false });
        }
      })();
    };

    return {
      ...EMPTY_SEARCH,
      attach(nextPdfium) {
        if (pdfium === nextPdfium) return;
        cancel('PDF runtime changed');
        pdfium = nextPdfium;
        set(EMPTY_SEARCH);
      },
      setDocument(documentId) {
        if (get().documentId === documentId) return;
        cancel('document changed');
        set({ ...EMPTY_SEARCH, documentId, flags: get().flags });
      },
      clear,
      run,
      toggleFlag(flag, query = get().query, nearPage = 0) {
        const flags = get().flags.includes(flag)
          ? get().flags.filter((item) => item !== flag)
          : [...get().flags, flag];
        if (query.trim()) run(query, flags, nearPage);
        else set({ flags });
      },
      move(direction) {
        const { results, activeResultIndex } = get();
        if (!results.length) return;
        set({
          activeResultIndex: direction > 0
            ? (activeResultIndex + 1) % results.length
            : (activeResultIndex <= 0 ? results.length : activeResultIndex) - 1,
        });
      },
      dispose() {
        cancel('search disposed');
        pdfium = null;
        set(EMPTY_SEARCH);
      },
    };
  });
}

export const pdfSearchStore = createPdfSearchStore();

function findNearestResult(results: SearchResult[], pageIndex: number) {
  if (!results.length) return -1;
  const next = results.findIndex((result) => result.pageIndex >= pageIndex);
  return next >= 0 ? next : results.length - 1;
}

function indexResultsByPage(results: SearchResult[]) {
  const indexed = new Map<number, PageSearchResult[]>();
  results.forEach((result, resultIndex) => {
    const pageResults = indexed.get(result.pageIndex);
    const entry = { result, resultIndex };
    if (pageResults) pageResults.push(entry);
    else indexed.set(result.pageIndex, [entry]);
  });
  return indexed;
}
