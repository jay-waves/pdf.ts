import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import {
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
  type PdfDocumentObject,
  type PdfEngine,
  type PdfPageObject,
  type PdfTextRun,
} from '@embedpdf/models';
import { Highlighter, MessageSquareMore, PenLine, Shapes, Strikethrough, Type, Underline } from 'lucide-react';
import {
  TEXT_MARKUP_TYPES,
  getAnnotationFocusPosition,
  getAnnotationLabel,
  getAnnotationRects,
  getAnnotationScope,
  rectsIntersect,
} from './annotations';
import { Dialog } from './components';
import { getActiveDocumentId, getPluginCapability, type ScrollCapability } from './utils';

type CommentPageGroup = { pageIndex: number; entries: PdfAnnotationObject[] };
type AnnotationSummaries = Record<string, string>;
type EditingComment = { annotationId: string; draft: string };

const SUMMARY_MAX_LENGTH = 160;
const pageTextRunsCache = new WeakMap<PdfDocumentObject, Map<number, Promise<PdfTextRun[]>>>();

const HIDDEN_ANNOTATION_TYPES = new Set([
  PdfAnnotationSubtype.LINK,
  PdfAnnotationSubtype.POPUP,
  PdfAnnotationSubtype.WIDGET,
]);

function normalizeSummary(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > SUMMARY_MAX_LENGTH
    ? `${normalized.slice(0, SUMMARY_MAX_LENGTH).trimEnd()}…`
    : normalized;
}

function summarizeMarkup(annotation: PdfAnnotationObject, runs: PdfTextRun[]) {
  const annotationRects = getAnnotationRects(annotation);
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

function getEntries(registry: PluginRegistry | undefined) {
  const scoped = getAnnotationScope(registry);
  if (!scoped) return [];

  return scoped.scope.getAnnotations()
    .map(({ object }) => object)
    .filter((annotation) => !HIDDEN_ANNOTATION_TYPES.has(annotation.type))
    .sort((left, right) => left.pageIndex - right.pageIndex ||
      left.rect.origin.y - right.rect.origin.y ||
      left.rect.origin.x - right.rect.origin.x ||
      left.id.localeCompare(right.id));
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

function navigateToAnnotation(registry: PluginRegistry, annotation: PdfAnnotationObject) {
  const scoped = getAnnotationScope(registry);
  const scroll = getPluginCapability<ScrollCapability>(registry, 'scroll');
  if (!scoped || !scroll) return;

  scoped.scope.selectAnnotation(annotation.pageIndex, annotation.id);
  scroll.forDocument(scoped.documentId).scrollToPage({
    pageNumber: annotation.pageIndex + 1,
    pageCoordinates: getAnnotationFocusPosition(annotation),
    behavior: 'instant',
    alignX: 50,
    alignY: 50,
  });
}

function deleteAnnotation(registry: PluginRegistry | undefined, pageIndex: number, annotationId: string) {
  const scoped = getAnnotationScope(registry);
  scoped?.scope.deleteAnnotations([{
    pageIndex,
    id: annotationId,
  }]);
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
  const [editingComment, setEditingComment] = useState<EditingComment | null>(null);
  const [summaries, setSummaries] = useState<AnnotationSummaries>({});
  const contentRef = useRef<HTMLDivElement>(null);
  const consumedTargetIdRef = useRef<string | null>(null);
  const pendingCreationRef = useRef<{ annotationId: string; pageIndex: number } | null>(null);
  const entries = useMemo(() => open ? getEntries(registry) : [], [open, registry, revision]);
  const pageGroups = useMemo(() => entries.reduce<CommentPageGroup[]>((groups, annotation) => {
    const lastGroup = groups.at(-1);
    if (lastGroup?.pageIndex === annotation.pageIndex) {
      lastGroup.entries.push(annotation);
    } else {
      groups.push({ pageIndex: annotation.pageIndex, entries: [annotation] });
    }
    return groups;
  }, []), [entries]);

  useEffect(() => {
    if (!open) return;
    const scoped = getAnnotationScope(registry);
    if (!scoped) return;
    return scoped.scope.onAnnotationEvent((event) => {
      if (event.documentId === scoped.documentId) setRevision((value) => value + 1);
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
    const markupEntries = entries.filter((annotation) => TEXT_MARKUP_TYPES.has(annotation.type));
    const pageIndexes = [...new Set(markupEntries.map((annotation) => annotation.pageIndex))];
    Promise.all(pageIndexes.map(async (pageIndex) => {
      const page = document.pages[pageIndex];
      if (!page) return [] as Array<[string, string]>;
      const runs = await getPageTextRuns(engine, document, page);
      return markupEntries
        .filter((annotation) => annotation.pageIndex === pageIndex)
        .map((annotation) => [annotation.id, summarizeMarkup(annotation, runs)] as [string, string]);
    })).then((pageSummaries) => {
      if (!cancelled) setSummaries(Object.fromEntries(pageSummaries.flat()));
    }).catch(() => {
      if (!cancelled) {
        setSummaries(Object.fromEntries(markupEntries.map((annotation) => [annotation.id, ''])));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [engine, entries, open, registry]);

  useEffect(() => {
    if (!open) {
      const pendingCreation = pendingCreationRef.current;
      if (pendingCreation) {
        deleteAnnotation(registry, pendingCreation.pageIndex, pendingCreation.annotationId);
      }
      consumedTargetIdRef.current = null;
      pendingCreationRef.current = null;
      return;
    }
    if (!targetAnnotationId || consumedTargetIdRef.current === targetAnnotationId) return;
    const target = entries.find((annotation) => annotation.id === targetAnnotationId);
    if (!target) return;
    consumedTargetIdRef.current = targetAnnotationId;
    pendingCreationRef.current = targetAnnotationIsNew
      ? { annotationId: targetAnnotationId, pageIndex: target.pageIndex }
      : null;
    setEditingComment({
      annotationId: target.id,
      draft: target.contents?.trim() ?? '',
    });
  }, [entries, open, targetAnnotationId, targetAnnotationIsNew]);

  useLayoutEffect(() => {
    if (!open) {
      setEditingComment(null);
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

  const saveComment = (annotation: PdfAnnotationObject) => {
    const scoped = getAnnotationScope(registry);
    if (!scoped) return;
    const contents = editingComment?.draft.trim() ?? '';
    if (!contents && pendingCreationRef.current?.annotationId === annotation.id) {
      deleteAnnotation(registry, annotation.pageIndex, annotation.id);
      pendingCreationRef.current = null;
      setEditingComment(null);
      return;
    }
    scoped.scope.updateAnnotation(annotation.pageIndex, annotation.id, { contents });
    if (pendingCreationRef.current?.annotationId === annotation.id) pendingCreationRef.current = null;
    setEditingComment(null);
  };

  const cancelComment = (annotation: PdfAnnotationObject) => {
    if (pendingCreationRef.current?.annotationId === annotation.id) {
      deleteAnnotation(registry, annotation.pageIndex, annotation.id);
      pendingCreationRef.current = null;
    }
    setEditingComment(null);
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
                </div>
                <ol className="shnctl-comment-page-entries">
                  {group.entries.map((annotation) => {
                    const Icon = getEntryIcon(annotation);
                    const label = getAnnotationLabel(annotation);
                    const contents = annotation.contents?.trim();
                    const isComment = annotation.type === PdfAnnotationSubtype.TEXT;
                    const isEditing = isComment && editingComment?.annotationId === annotation.id;
                    const isTextMarkup = TEXT_MARKUP_TYPES.has(annotation.type);
                    const hasExtractedSummary = Object.hasOwn(summaries, annotation.id);
                    const summary = contents || (isTextMarkup
                      ? hasExtractedSummary ? summaries[annotation.id] || 'Text summary unavailable' : 'Loading text summary…'
                      : 'No text content');
                    return <li key={annotation.id} className="shnctl-comment-item" data-editing={isEditing ? 'true' : undefined}>
                      {!isEditing ? <button
                        type="button"
                        className="shnctl-comment-card-target"
                        onClick={() => registry && navigateToAnnotation(registry, annotation)}
                        aria-label={`Go to ${label} on page ${annotation.pageIndex + 1}`}
                      /> : null}
                      <div className="shnctl-comment-heading">
                        <span className="shnctl-comment-icon"><Icon size={15} strokeWidth={2} /></span>
                        <span className="shnctl-comment-meta"><span className="shnctl-comment-type">{label}</span></span>
                      </div>
                      {isEditing ? <form className="shnctl-comment-editor" onSubmit={(event) => { event.preventDefault(); saveComment(annotation); }}>
                        <textarea
                          value={editingComment.draft}
                          onChange={(event) => setEditingComment({
                            annotationId: annotation.id,
                            draft: event.currentTarget.value,
                          })}
                          autoFocus
                          aria-label={`Comment for ${label}`}
                        />
                        <div className="shnctl-comment-editor-actions"><button type="button" onClick={() => cancelComment(annotation)}>Cancel</button><button type="submit" className="shnctl-comment-save">Save</button></div>
                      </form> : isComment
                        ? <button
                            type="button"
                            className="shnctl-comment-body"
                            onClick={() => setEditingComment({ annotationId: annotation.id, draft: contents ?? '' })}
                          >{contents || 'Empty comment'}</button>
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
