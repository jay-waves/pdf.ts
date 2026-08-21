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
import { Button, PanelContent, PanelState } from '../components';
import {
  TEXT_MARKUP_TYPES,
  getAnnotationLabel,
  getAnnotationRects,
  getAnnotationScope,
  rectsIntersect,
} from './annotations';
import type { PdfScroll } from '../renderer/pdf-scroll';
import { getDocument } from '../document/viewer-document';
import styles from './comments.module.css';

type CommentPageGroup = { pageIndex: number; entries: PdfAnnotationObject[] };
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

function getEntries(registry: PluginRegistry | undefined, documentId: string | null | undefined) {
  const scoped = getAnnotationScope(registry, documentId);
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

function navigateToAnnotation(
  registry: PluginRegistry,
  documentId: string,
  scroll: PdfScroll | null | undefined,
  annotation: PdfAnnotationObject,
) {
  const scoped = getAnnotationScope(registry, documentId);
  if (!scoped) return;

  scoped.scope.selectAnnotation(annotation.pageIndex, annotation.id);
  scroll?.reveal(annotation.pageIndex, getAnnotationRects(annotation));
}

function scrollCommentItemIntoView(root: HTMLElement, item: HTMLElement) {
  const inset = 12;
  const rootRect = root.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  const visibleTop = rootRect.top + inset;
  const visibleBottom = rootRect.bottom - inset;
  const availableHeight = Math.max(0, visibleBottom - visibleTop);
  let delta = 0;

  if (itemRect.height > availableHeight || itemRect.top < visibleTop) {
    delta = itemRect.top - visibleTop;
  } else if (itemRect.bottom > visibleBottom) {
    delta = itemRect.bottom - visibleBottom;
  }

  if (Math.abs(delta) > 0.5) {
    root.scrollTo({
      top: Math.max(0, root.scrollTop + delta),
      behavior: 'auto',
    });
  }
}

function deleteAnnotation(
  registry: PluginRegistry | undefined,
  documentId: string | null | undefined,
  pageIndex: number,
  annotationId: string,
) {
  const scoped = getAnnotationScope(registry, documentId);
  scoped?.scope.deleteAnnotations([{
    pageIndex,
    id: annotationId,
  }]);
}

export function Comments({
  engine,
  registry,
  documentId,
  scroll,
  currentPageNumber,
  targetAnnotationId,
  targetAnnotationIsNew,
}: {
  engine: PdfEngine<Blob>;
  registry?: PluginRegistry;
  documentId?: string | null;
  scroll?: PdfScroll | null;
  currentPageNumber: number;
  targetAnnotationId?: string | null;
  targetAnnotationIsNew?: boolean;
}) {
  const [revision, setRevision] = useState(0);
  const [editingComment, setEditingComment] = useState<EditingComment | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const consumedTargetIdRef = useRef<string | null>(null);
  const pendingCreationRef = useRef<{ annotationId: string; pageIndex: number } | null>(null);
  const summaryCacheRef = useRef(new Map<string, string>());
  const invalidSummaryIdsRef = useRef(new Set<string>());
  const editingAnnotationId = editingComment?.annotationId;
  const entries = useMemo(
    () => getEntries(registry, documentId),
    [documentId, registry, revision],
  );
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
    summaryCacheRef.current.clear();
    invalidSummaryIdsRef.current.clear();
  }, [documentId, registry]);

  useEffect(() => {
    const scoped = getAnnotationScope(registry, documentId);
    if (!scoped) return;
    return scoped.scope.onAnnotationEvent((event) => {
      if (event.documentId !== scoped.documentId) return;

      if (event.type === 'loaded') {
        summaryCacheRef.current.clear();
        invalidSummaryIdsRef.current.clear();
      } else if (event.type === 'delete') {
        summaryCacheRef.current.delete(event.annotation.id);
        invalidSummaryIdsRef.current.delete(event.annotation.id);
      } else if (event.type === 'create' || event.type === 'update') {
        if (TEXT_MARKUP_TYPES.has(event.annotation.type)) {
          invalidSummaryIdsRef.current.add(event.annotation.id);
        } else {
          summaryCacheRef.current.delete(event.annotation.id);
          invalidSummaryIdsRef.current.delete(event.annotation.id);
        }
      }

      setRevision((value) => value + 1);
    });
  }, [documentId, registry]);

  useEffect(() => {
    if (!registry) return;

    const document = getDocument(registry, documentId);
    if (!document) return;

    let cancelled = false;
    const summaryEntries = entries.filter((annotation) => (
      TEXT_MARKUP_TYPES.has(annotation.type) && !annotation.contents?.trim()
    ));
    const visibleIds = new Set(summaryEntries.map((annotation) => annotation.id));
    const cache = summaryCacheRef.current;
    const invalidIds = invalidSummaryIdsRef.current;

    for (const annotationId of cache.keys()) {
      if (!visibleIds.has(annotationId)) cache.delete(annotationId);
    }
    for (const annotationId of invalidIds) {
      if (!visibleIds.has(annotationId)) invalidIds.delete(annotationId);
    }

    const pendingEntries = summaryEntries.filter((annotation) => (
      invalidIds.has(annotation.id) || !cache.has(annotation.id)
    ));

    if (!pendingEntries.length) return;

    const entriesByPage = new Map<number, PdfAnnotationObject[]>();
    for (const annotation of pendingEntries) {
      const pageEntries = entriesByPage.get(annotation.pageIndex);
      if (pageEntries) pageEntries.push(annotation);
      else entriesByPage.set(annotation.pageIndex, [annotation]);
    }

    Promise.all([...entriesByPage].map(async ([pageIndex, pageEntries]) => {
      const page = document.pages[pageIndex];
      if (!page) return [] as Array<[string, string]>;
      const runs = await getPageTextRuns(engine, document, page);
      return pageEntries
        .map((annotation) => [annotation.id, summarizeMarkup(annotation, runs)] as [string, string]);
    })).then((pageSummaries) => {
      if (cancelled) return;
      for (const [annotationId, summary] of pageSummaries.flat()) {
        cache.set(annotationId, summary);
        invalidIds.delete(annotationId);
      }
      setRevision((value) => value + 1);
    }).catch(() => {
      if (cancelled) return;
      for (const annotation of pendingEntries) {
        cache.set(annotation.id, '');
        invalidIds.delete(annotation.id);
      }
      setRevision((value) => value + 1);
    });

    return () => {
      cancelled = true;
    };
  }, [documentId, engine, entries, registry]);

  useEffect(() => {
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
  }, [entries, targetAnnotationId, targetAnnotationIsNew]);

  useEffect(() => () => {
    const pendingCreation = pendingCreationRef.current;
    if (pendingCreation) {
      deleteAnnotation(registry, documentId, pendingCreation.pageIndex, pendingCreation.annotationId);
    }
  }, [documentId, registry]);

  useLayoutEffect(() => {
    if (editingAnnotationId) return;

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
  }, [currentPageNumber, editingAnnotationId, entries.length]);

  useLayoutEffect(() => {
    if (!editingAnnotationId) return;

    const frame = requestAnimationFrame(() => {
      const root = contentRef.current;
      if (!root) return;
      const target = Array.from(root.querySelectorAll<HTMLElement>('[data-comment-annotation-id]'))
        .find((item) => item.dataset.commentAnnotationId === editingAnnotationId);
      if (target) scrollCommentItemIntoView(root, target);
    });

    return () => cancelAnimationFrame(frame);
  }, [editingAnnotationId, revision]);

  const saveComment = (annotation: PdfAnnotationObject) => {
    const scoped = getAnnotationScope(registry, documentId);
    if (!scoped) return;
    const contents = editingComment?.draft.trim() ?? '';
    if (!contents && pendingCreationRef.current?.annotationId === annotation.id) {
      deleteAnnotation(registry, documentId, annotation.pageIndex, annotation.id);
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
      deleteAnnotation(registry, documentId, annotation.pageIndex, annotation.id);
      pendingCreationRef.current = null;
    }
    setEditingComment(null);
  };

  return (
    <PanelContent ref={contentRef} padding="compact" className={styles.panel}>
      {!registry ? <PanelState>Loading comments...</PanelState> : null}
      {registry && !entries.length ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>
            <MessageSquareMore size={20} strokeWidth={1.6} />
          </span>
          <strong className={styles.emptyTitle}>No comments yet</strong>
          <span className={styles.emptyDescription}>
            Annotations and notes added to this PDF will appear here.
          </span>
        </div>
      ) : null}
      {pageGroups.length ? (
        <ol className={styles.list}>
          {pageGroups.map((group) => (
            <li
              key={group.pageIndex}
              className={styles.pageGroup}
              data-comment-page={group.pageIndex + 1}
              data-current={group.pageIndex + 1 === currentPageNumber ? 'true' : undefined}
            >
              <div className={styles.pageHeader}>Page {group.pageIndex + 1}</div>
              <ol className={styles.entries}>
                {group.entries.map((annotation) => {
                  const Icon = getEntryIcon(annotation);
                  const label = getAnnotationLabel(annotation);
                  const contents = annotation.contents?.trim();
                  const isComment = annotation.type === PdfAnnotationSubtype.TEXT;
                  const isEditing = isComment && editingComment?.annotationId === annotation.id;
                  const isTextMarkup = TEXT_MARKUP_TYPES.has(annotation.type);
                  const hasExtractedSummary = summaryCacheRef.current.has(annotation.id);
                  const summary = contents || (isTextMarkup
                    ? hasExtractedSummary
                      ? summaryCacheRef.current.get(annotation.id) || 'Text summary unavailable'
                      : 'Loading text summary…'
                    : 'No text content');

                  return (
                    <li
                      key={annotation.id}
                      className={styles.item}
                      data-comment-annotation-id={annotation.id}
                      data-editing={isEditing ? 'true' : undefined}
                    >
                      {!isEditing ? (
                        <button
                          type="button"
                          className={styles.cardTarget}
                          onClick={() => {
                            if (registry && documentId) {
                              navigateToAnnotation(registry, documentId, scroll, annotation);
                            }
                          }}
                          aria-label={`Go to ${label} on page ${annotation.pageIndex + 1}`}
                        />
                      ) : null}
                      <div className={styles.heading}>
                        <span className={styles.icon}><Icon size={15} strokeWidth={2} /></span>
                        <span className={styles.type}>{label}</span>
                      </div>
                      {isEditing ? (
                        <form
                          className={styles.editor}
                          onSubmit={(event) => {
                            event.preventDefault();
                            saveComment(annotation);
                          }}
                        >
                          <textarea
                            className={styles.textarea}
                            value={editingComment.draft}
                            onChange={(event) => setEditingComment({
                              annotationId: annotation.id,
                              draft: event.currentTarget.value,
                            })}
                            autoFocus
                            aria-label={`Comment for ${label}`}
                          />
                          <div className={styles.actions}>
                            <Button onClick={() => cancelComment(annotation)}>Cancel</Button>
                            <Button type="submit" variant="primary">Save</Button>
                          </div>
                        </form>
                      ) : isComment ? (
                        <button
                          type="button"
                          className={`${styles.body} ${styles.editableBody}`}
                          onClick={() => setEditingComment({
                            annotationId: annotation.id,
                            draft: contents ?? '',
                          })}
                        >
                          {contents || 'Empty comment'}
                        </button>
                      ) : (
                        <div className={`${styles.body} ${styles.readonlyBody}`}>{summary}</div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </li>
          ))}
        </ol>
      ) : null}
    </PanelContent>
  );
}
