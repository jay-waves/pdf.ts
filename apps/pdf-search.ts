import {
  MatchFlag,
  PdfErrorCode,
  type PdfPageSearchProgress,
  type PdfTask,
  type SearchAllPagesResult,
  type SearchResult,
} from '@embedpdf/models';
import { createStore } from 'zustand/vanilla';
import type { PdfRuntime } from './pdf-engine';

export interface PdfSearchState {
  documentId: string | null;
  query: string;
  flags: MatchFlag[];
  results: SearchResult[];
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

const EMPTY_SEARCH = {
  documentId: null,
  query: '',
  flags: [] as MatchFlag[],
  results: [] as SearchResult[],
  activeResultIndex: -1,
  loading: false,
};

export function createPdfSearchStore() {
  let pdfium: PdfRuntime | null = null;
  let task: PdfTask<SearchAllPagesResult, PdfPageSearchProgress> | null = null;

  const cancel = (message: string) => {
    const current = task;
    task = null;
    current?.abort({ code: PdfErrorCode.Cancelled, message });
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
      set({ query: keyword, flags, results: [], activeResultIndex: -1, loading: true });

      try {
        const current = pdfium.withDocument(documentId, (engine, document) => (
          engine.searchAllPages(document, keyword, { flags })
        ));
        task = current;
        current.onProgress(({ results }) => {
          if (task === current && results.length) {
            set((state) => ({ results: [...state.results, ...results] }));
          }
        });
        current.wait(
          ({ results }) => {
            if (task !== current) return;
            task = null;
            set({ results, activeResultIndex: findNearestResult(results, nearPage), loading: false });
          },
          (error) => {
            if (task !== current) return;
            task = null;
            if (error.reason.code !== PdfErrorCode.Cancelled) {
              console.error('[pdf-ts] PDF search failed', error);
              set({ results: [], activeResultIndex: -1, loading: false });
            }
          },
        );
      } catch (error) {
        console.error('[pdf-ts] failed to start PDF search', error);
        set({ loading: false });
      }
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
