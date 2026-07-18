import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import {
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
  type PdfDocumentObject,
  type PdfEngine,
  type PdfPageObject,
  type PdfTextRun,
  type Rect,
} from '@embedpdf/models';
import type { AnnotationCapability } from '@embedpdf/plugin-annotation';
import { Highlighter, MessageSquareMore, PenLine, Shapes, Strikethrough, Type, Underline } from 'lucide-react';
import { Dialog } from './components';
import { getActiveDocumentId, type ScrollCapability } from './utils';

type CommentEntry = { annotation: PdfAnnotationObject; pageIndex: number };
type CommentPageGroup = { pageIndex: number; entries: CommentEntry[] };
type AnnotationSummaries = Record<string, string>;

const SUMMARY_MAX_LENGTH = 160;
const pageTextRunsCache = new WeakMap<PdfDocumentObject, Map<number, Promise<PdfTextRun[]>>>();

const HIDDEN_ANNOTATION_TYPES = new Set([
  PdfAnnotationSubtype.LINK,
  PdfAnnotationSubtype.POPUP,
  PdfAnnotationSubtype.WIDGET,
]);

const TEXT_MARKUP_TYPES = new Set([
  PdfAnnotationSubtype.HIGHLIGHT,
  PdfAnnotationSubtype.UNDERLINE,
  PdfAnnotationSubtype.STRIKEOUT,
  PdfAnnotationSubtype.SQUIGGLY,
]);

function getTextMarkupRects(annotation: PdfAnnotationObject): Rect[] {
  switch (annotation.type) {
    case PdfAnnotationSubtype.HIGHLIGHT:
    case PdfAnnotationSubtype.UNDERLINE:
    case PdfAnnotationSubtype.STRIKEOUT:
    case PdfAnnotationSubtype.SQUIGGLY:
      return annotation.segmentRects.length ? annotation.segmentRects : [annotation.rect];
    default:
      return [];
  }
}

function rectsIntersect(left: Rect, right: Rect) {
  return left.origin.x < right.origin.x + right.size.width &&
    left.origin.x + left.size.width > right.origin.x &&
    left.origin.y < right.origin.y + right.size.height &&
    left.origin.y + left.size.height > right.origin.y;
}

function normalizeSummary(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > SUMMARY_MAX_LENGTH
    ? `${normalized.slice(0, SUMMARY_MAX_LENGTH).trimEnd()}…`
    : normalized;
}

function summarizeMarkup(annotation: PdfAnnotationObject, runs: PdfTextRun[]) {
  const annotationRects = getTextMarkupRects(annotation);
  const pieces = runs
    .filter((run) => annotationRects.some((rect) => rectsIntersect(rect, run.rect)))
    .map((run) => run.text.trim())
    .filter((text, index, items) => Boolean(text) && items.indexOf(text) === index);
  return normalizeSummary(pieces.join(' '));
}

function getPageTextRuns(
  engine: PdfEngine<Blob>,
  document: PdfDocumentObject,
  page: PdfPageObject,
) {
  let cache = pageTextRunsCache.get(document);
  if (!cache) {
    cache = new Map();
    pageTextRunsCache.set(document, cache);
  }

  let pending = cache.get(page.index);
  if (!pending) {
    pending = engine.getPageTextRuns(document, page).toPromise().then(({ runs }) => runs);
    cache.set(page.index, pending);
    pending.catch(() => cache?.delete(page.index));
  }
  return pending;
}

function getAnnotationCapability(registry: PluginRegistry | undefined) {
  const documentId = registry ? getActiveDocumentId(registry) : undefined;
  const annotation = registry?.getPlugin('annotation')?.provides?.() as AnnotationCapability | undefined;
  return documentId && annotation ? { documentId, annotation } : null;
}

function getEntries(registry: PluginRegistry | undefined): CommentEntry[] {
  const capability = getAnnotationCapability(registry);
  if (!capability) return [];

  return capability.annotation.forDocument(capability.documentId).getAnnotations()
    .map(({ object }) => ({ annotation: object, pageIndex: object.pageIndex }))
    .filter(({ annotation }) => !HIDDEN_ANNOTATION_TYPES.has(annotation.type))
    .sort((left, right) => left.pageIndex - right.pageIndex ||
      left.annotation.rect.origin.y - right.annotation.rect.origin.y ||
      left.annotation.rect.origin.x - right.annotation.rect.origin.x ||
      left.annotation.id.localeCompare(right.annotation.id));
}

function getEntryLabel(annotation: PdfAnnotationObject) {
  switch (annotation.type) {
    case PdfAnnotationSubtype.TEXT: return 'Comment';
    case PdfAnnotationSubtype.HIGHLIGHT: return 'Highlight';
    case PdfAnnotationSubtype.UNDERLINE: return 'Underline';
    case PdfAnnotationSubtype.STRIKEOUT: return 'Strikeout';
    case PdfAnnotationSubtype.SQUIGGLY: return 'Squiggly';
    case PdfAnnotationSubtype.FREETEXT: return 'Text';
    case PdfAnnotationSubtype.STAMP: return 'Stamp';
    case PdfAnnotationSubtype.INK: return 'Drawing';
    default: return 'Annotation';
  }
}

function getEntryIcon(annotation: PdfAnnotationObject) {
  switch (annotation.type) {
    case PdfAnnotationSubtype.TEXT: return MessageSquareMore;
    case PdfAnnotationSubtype.HIGHLIGHT: return Highlighter;
    case PdfAnnotationSubtype.UNDERLINE: return Underline;
    case PdfAnnotationSubtype.STRIKEOUT: return Strikethrough;
    case PdfAnnotationSubtype.FREETEXT: return Type;
    case PdfAnnotationSubtype.STAMP: return Shapes;
    case PdfAnnotationSubtype.INK: return PenLine;
    default: return Shapes;
  }
}

function navigateToAnnotation(registry: PluginRegistry, entry: CommentEntry) {
  const capability = getAnnotationCapability(registry);
  const scroll = registry.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;
  if (!capability || !scroll) return;

  capability.annotation.forDocument(capability.documentId).selectAnnotation(entry.pageIndex, entry.annotation.id);
  scroll.forDocument(capability.documentId).scrollToPage({
    pageNumber: entry.pageIndex + 1,
    pageCoordinates: { x: entry.annotation.rect.origin.x, y: entry.annotation.rect.origin.y },
    behavior: 'instant',
  });
}

export function Comments({ engine, registry, open, currentPageNumber, targetAnnotationId, targetAnnotationIsNew, onClose }: {
  engine?: PdfEngine<Blob> | null;
  registry?: PluginRegistry;
  open: boolean;
  currentPageNumber: number;
  targetAnnotationId?: string | null;
  targetAnnotationIsNew?: boolean;
  onClose(): void;
}) {
  const [revision, setRevision] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [summaries, setSummaries] = useState<AnnotationSummaries>({});
  const contentRef = useRef<HTMLDivElement>(null);
  const consumedTargetIdRef = useRef<string | null>(null);
  const pendingCreationIdRef = useRef<string | null>(null);
  const entries = useMemo(() => open ? getEntries(registry) : [], [open, registry, revision]);
  const pageGroups = useMemo(() => entries.reduce<CommentPageGroup[]>((groups, entry) => {
    const lastGroup = groups.at(-1);
    if (lastGroup?.pageIndex === entry.pageIndex) {
      lastGroup.entries.push(entry);
    } else {
      groups.push({ pageIndex: entry.pageIndex, entries: [entry] });
    }
    return groups;
  }, []), [entries]);

  useEffect(() => {
    if (!open) return;
    const capability = getAnnotationCapability(registry);
    if (!capability) return;
    return capability.annotation.onAnnotationEvent((event) => {
      if (event.documentId === capability.documentId) setRevision((value) => value + 1);
    });
  }, [open, registry]);

  useEffect(() => {
    if (!open || !engine || !registry) {
      setSummaries({});
      return;
    }

    const documentId = getActiveDocumentId(registry);
    const document = documentId
      ? registry.getStore().getState().core.documents[documentId]?.document
      : null;
    if (!document) return;

    let cancelled = false;
    const markupEntries = entries.filter(({ annotation }) => TEXT_MARKUP_TYPES.has(annotation.type));
    const pageIndexes = [...new Set(markupEntries.map(({ pageIndex }) => pageIndex))];
    Promise.all(pageIndexes.map(async (pageIndex) => {
      const page = document.pages[pageIndex];
      if (!page) return [] as Array<[string, string]>;
      const runs = await getPageTextRuns(engine, document, page);
      return markupEntries
        .filter((entry) => entry.pageIndex === pageIndex)
        .map(({ annotation }) => [annotation.id, summarizeMarkup(annotation, runs)] as [string, string]);
    })).then((pageSummaries) => {
      if (!cancelled) setSummaries(Object.fromEntries(pageSummaries.flat()));
    }).catch(() => {
      if (!cancelled) {
        setSummaries(Object.fromEntries(markupEntries.map(({ annotation }) => [annotation.id, ''])));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [engine, entries, open, registry]);

  useEffect(() => {
    if (!open) {
      consumedTargetIdRef.current = null;
      pendingCreationIdRef.current = null;
      return;
    }
    if (!targetAnnotationId || consumedTargetIdRef.current === targetAnnotationId) return;
    const target = entries.find(({ annotation }) => annotation.id === targetAnnotationId);
    if (!target) return;
    consumedTargetIdRef.current = targetAnnotationId;
    pendingCreationIdRef.current = targetAnnotationIsNew ? targetAnnotationId : null;
    setEditingId(target.annotation.id);
    setDraft(target.annotation.contents?.trim() ?? '');
  }, [entries, open, targetAnnotationId, targetAnnotationIsNew]);

  useLayoutEffect(() => {
    if (!open) {
      setEditingId(null);
      return;
    }
    const frame = requestAnimationFrame(() => {
      const root = contentRef.current;
      if (!root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>('[data-comment-page]'));
      const exact = items.find((item) => Number(item.dataset.commentPage) === currentPageNumber);
      const current = exact
        ?? items.find((item) => Number(item.dataset.commentPage) > currentPageNumber)
        ?? items.at(-1);
      if (!current) {
        root.scrollTo({ top: 0, behavior: 'auto' });
        return;
      }
      const rootRect = root.getBoundingClientRect();
      const currentRect = current.getBoundingClientRect();
      root.scrollTo({ top: Math.max(0, root.scrollTop + currentRect.top - rootRect.top - 12), behavior: 'auto' });
    });
    return () => cancelAnimationFrame(frame);
  }, [currentPageNumber, entries.length, open]);

  const saveComment = (entry: CommentEntry) => {
    const capability = getAnnotationCapability(registry);
    if (!capability) return;
    const contents = draft.trim();
    capability.annotation.forDocument(capability.documentId)
      .updateAnnotation(entry.pageIndex, entry.annotation.id, { contents });
    if (pendingCreationIdRef.current === entry.annotation.id) pendingCreationIdRef.current = null;
    setEditingId(null);
  };

  const cancelComment = (entry: CommentEntry) => {
    if (pendingCreationIdRef.current === entry.annotation.id) {
      const capability = getAnnotationCapability(registry);
      capability?.annotation.forDocument(capability.documentId).deleteAnnotations([{
        pageIndex: entry.pageIndex,
        id: entry.annotation.id,
      }]);
      pendingCreationIdRef.current = null;
    }
    setEditingId(null);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="PDF Comments"
      contentClassName="shnctl-panel"
    >
          <div className="shnctl-content shnctl-comment-content" ref={contentRef}>
            {!registry ? <div className="shnctl-state">Loading comments...</div> : null}
            {registry && !entries.length ? <div className="shnctl-comment-empty">
              <span className="shnctl-comment-empty-icon"><MessageSquareMore size={20} strokeWidth={1.6} /></span>
              <strong>No comments yet</strong>
              <span>Annotations and notes added to this PDF will appear here.</span>
            </div> : null}
            {pageGroups.length ? <ol className="shnctl-comment-list">
              {pageGroups.map((group) => <li key={group.pageIndex} className="shnctl-comment-page-group" data-comment-page={group.pageIndex + 1} data-current={group.pageIndex + 1 === currentPageNumber ? 'true' : undefined}>
                <div className="shnctl-comment-page-header">
                  <span>Page {group.pageIndex + 1}</span>
                  <span className="shnctl-comment-page-count">{group.entries.length}</span>
                </div>
                <ol className="shnctl-comment-page-entries">
                  {group.entries.map((entry) => {
                    const { annotation } = entry;
                    const Icon = getEntryIcon(annotation);
                    const label = getEntryLabel(annotation);
                    const contents = annotation.contents?.trim();
                    const isComment = annotation.type === PdfAnnotationSubtype.TEXT;
                    const isEditing = isComment && editingId === annotation.id;
                    const isTextMarkup = TEXT_MARKUP_TYPES.has(annotation.type);
                    const hasExtractedSummary = Object.hasOwn(summaries, annotation.id);
                    const summary = contents || (isTextMarkup
                      ? hasExtractedSummary ? summaries[annotation.id] || 'Text summary unavailable' : 'Loading text summary…'
                      : 'No text content');
                    return <li key={annotation.id} className="shnctl-comment-item" data-editing={isEditing ? 'true' : undefined}>
                      <button type="button" className="shnctl-action shnctl-comment-target" onClick={() => registry && navigateToAnnotation(registry, entry)}>
                        <span className="shnctl-comment-icon"><Icon size={15} strokeWidth={2} /></span>
                        <span className="shnctl-comment-meta"><span className="shnctl-comment-type">{label}</span></span>
                      </button>
                      {isEditing ? <form className="shnctl-comment-editor" onSubmit={(event) => { event.preventDefault(); saveComment(entry); }}>
                        <textarea value={draft} onChange={(event) => setDraft(event.currentTarget.value)} autoFocus aria-label={`Comment for ${label}`} />
                        <div className="shnctl-comment-editor-actions"><button type="button" onClick={() => cancelComment(entry)}>Cancel</button><button type="submit" className="shnctl-comment-save">Save</button></div>
                      </form> : isComment
                        ? <button type="button" className="shnctl-comment-body" onClick={() => { setEditingId(annotation.id); setDraft(contents ?? ''); }}>{contents || 'Empty comment'}</button>
                        : <div className="shnctl-comment-body shnctl-comment-body-readonly">{summary}</div>}
                    </li>;
                  })}
                </ol>
              </li>)}
            </ol> : null}
          </div>
    </Dialog>
  );
}
