import {
  MatchFlag,
  PdfErrorCode,
  type PdfPageSearchProgress,
  type PdfTask,
  type SearchAllPagesResult,
  type SearchResult,
} from '@embedpdf/models';
import type { PdfiumCapability } from './pdf-engine';

export interface PdfSearchState {
  documentId: string | null;
  query: string;
  flags: MatchFlag[];
  results: SearchResult[];
  activeResultIndex: number;
  loading: boolean;
}

const EMPTY_SEARCH: PdfSearchState = {
  documentId: null,
  query: '',
  flags: [],
  results: [],
  activeResultIndex: -1,
  loading: false,
};

/** A small observable around PDFium's search task, shared by the toolbar and page layers. */
export class PdfSearch {
  private state = EMPTY_SEARCH;
  private task: PdfTask<SearchAllPagesResult, PdfPageSearchProgress> | null = null;
  private listeners = new Set<() => void>();

  constructor(private readonly pdfium: PdfiumCapability) {}

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = () => this.state;

  setDocument(documentId: string | null) {
    if (this.state.documentId === documentId) return;
    this.cancel('document changed');
    this.publish({ ...EMPTY_SEARCH, documentId, flags: this.state.flags });
  }

  clear() {
    this.cancel('search cleared');
    this.publish({
      ...EMPTY_SEARCH,
      documentId: this.state.documentId,
      flags: this.state.flags,
    });
  }

  run(query: string, flags = this.state.flags, nearPage = 0) {
    const documentId = this.state.documentId;
    const keyword = query.trim();
    if (!documentId || !keyword) {
      this.clear();
      return;
    }

    this.cancel('new search');
    this.publish({
      ...this.state,
      query: keyword,
      flags,
      results: [],
      activeResultIndex: -1,
      loading: true,
    });

    try {
      const task = this.pdfium.withDocument(documentId, (engine, document) => (
        engine.searchAllPages(document, keyword, { flags })
      ));
      this.task = task;
      task.onProgress(({ results }) => {
        if (this.task === task && results.length) {
          this.publish({ ...this.state, results: [...this.state.results, ...results] });
        }
      });
      task.wait(
        ({ results }) => {
          if (this.task !== task) return;
          this.task = null;
          this.publish({
            ...this.state,
            results,
            activeResultIndex: findNearestResult(results, nearPage),
            loading: false,
          });
        },
        (error) => {
          if (this.task !== task) return;
          this.task = null;
          if (error.reason.code !== PdfErrorCode.Cancelled) {
            console.error('[pdf-ts] PDF search failed', error);
            this.publish({ ...this.state, results: [], activeResultIndex: -1, loading: false });
          }
        },
      );
    } catch (error) {
      console.error('[pdf-ts] failed to start PDF search', error);
      this.publish({ ...this.state, loading: false });
    }
  }

  toggleFlag(flag: MatchFlag, query = this.state.query, nearPage = 0) {
    const flags = this.state.flags.includes(flag)
      ? this.state.flags.filter((item) => item !== flag)
      : [...this.state.flags, flag];
    if (query.trim()) this.run(query, flags, nearPage);
    else this.publish({ ...this.state, flags });
  }

  move(direction: -1 | 1) {
    const { results, activeResultIndex } = this.state;
    if (!results.length) return;
    const index = direction > 0
      ? (activeResultIndex + 1) % results.length
      : (activeResultIndex <= 0 ? results.length : activeResultIndex) - 1;
    this.publish({ ...this.state, activeResultIndex: index });
  }

  dispose() {
    this.cancel('search disposed');
    this.listeners.clear();
  }

  private cancel(message: string) {
    const task = this.task;
    this.task = null;
    task?.abort({ code: PdfErrorCode.Cancelled, message });
  }

  private publish(state: PdfSearchState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

function findNearestResult(results: SearchResult[], pageIndex: number) {
  if (!results.length) return -1;
  const next = results.findIndex((result) => result.pageIndex >= pageIndex);
  return next >= 0 ? next : results.length - 1;
}
