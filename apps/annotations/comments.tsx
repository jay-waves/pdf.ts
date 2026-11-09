import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { annotationKey, type Kernel } from '@embedpdf/core';
import type { Annotation } from '@embedpdf/plugin-annotation';
import { usePageList } from '@embedpdf/react/runtime';
import { useAnnotationList, useAnnotationState, useAnnotationEvent } from '@embedpdf/react/annotation';
import { readMarkupPage } from './markup-text';
import { Highlighter, MessageSquareMore, PenLine, Shapes, Strikethrough, Type, Underline } from 'lucide-react';
import { PanelContent, PanelState } from '../components';
import { TEXT_MARKUP_TYPES, getAnnotationLabel, getAnnotationRects, getAnnotationScope } from './annotations';
import type { ViewerStage } from '../viewer/viewer-stage';
import { getDocument } from '../document/viewer-document';
import styles from './comments.module.css';

function getEntryIcon(subtype: string) {
  switch (subtype) {
    case 'text': return MessageSquareMore;
    case 'highlight': return Highlighter;
    case 'underline': return Underline;
    case 'strikeout': return Strikethrough;
    case 'free-text': return Type;
    case 'stamp': return Shapes;
    case 'ink': return PenLine;
    default: return Shapes;
  }
}
export function Comments({ registry, documentId, stage, currentPageNumber }: {
  registry?: Kernel; documentId?: string | null; stage?: ViewerStage | null; currentPageNumber: number;
}) {
  const [, setRevision] = useState(0);
  const [textRevision, setTextRevision] = useState(0);
  const annotations = useAnnotationList();
  const pages = usePageList();
  const pageIndices = useMemo(() => new Map(pages.map((page, index) => [page.ref.objectNumber, index])), [pages]);
  const status = useAnnotationState(state => state.status);
  const contentRef = useRef<HTMLDivElement>(null);
  const summaryCacheRef = useRef(new Map<string, { geometry: string; text: string }>());
  useAnnotationEvent(annotation => annotation.onResynced, event => {
    if (event.pages === 'all') summaryCacheRef.current.clear();
    else {
      const changed = new Set(event.pages.map(page => page.objectNumber));
      for (const annotation of annotations) if (changed.has(annotation.page.objectNumber)) summaryCacheRef.current.delete(annotationKey(annotation.ref));
    }
    setTextRevision(value => value + 1);
  });
  const entries = useMemo(() => {
    return annotations.filter((annotation) => pageIndices.has(annotation.page.objectNumber) && !['link', 'popup', 'widget'].includes(annotation.subtype))
      .toSorted((a, b) => pageIndices.get(a.page.objectNumber)! - pageIndices.get(b.page.objectNumber)! || a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  }, [annotations, pageIndices]);
  const pageGroups = useMemo(() => entries.reduce<{ pageIndex: number; entries: Annotation[] }[]>((groups, annotation) => {
    const pageIndex = pageIndices.get(annotation.page.objectNumber)!;
    const previous = groups.at(-1);
    if (previous?.pageIndex === pageIndex) previous.entries.push(annotation);
    else groups.push({ pageIndex, entries: [annotation] });
    return groups;
  }, []), [entries, pageIndices]);
  useEffect(() => { summaryCacheRef.current.clear(); }, [documentId]);
  useEffect(() => {
    const doc = getDocument(registry, documentId);
    if (!doc) return;
    const controller = new AbortController();
    const live = new Set(entries.map(annotation => annotationKey(annotation.ref)));
    for (const key of summaryCacheRef.current.keys()) if (!live.has(key)) summaryCacheRef.current.delete(key);
    const geometryKey = (annotation: Annotation) => JSON.stringify([annotation.page, getAnnotationRects(annotation)]);
    const pending = entries.filter((annotation) => TEXT_MARKUP_TYPES.has(annotation.subtype) && !annotation.contents?.trim() && summaryCacheRef.current.get(annotationKey(annotation.ref))?.geometry !== geometryKey(annotation));
    if (!pending.length) return;
    const pages = new Map<number, ReturnType<typeof readMarkupPage>>();
    void Promise.all(pending.map(async (annotation) => {
      const key = annotation.page.objectNumber;
      let page = pages.get(key);
      if (!page) { page = readMarkupPage(doc.page(annotation.page), controller.signal); pages.set(key, page); }
      let summary = '';
      try { summary = (await page)(getAnnotationRects(annotation)).replace(/\s+/g, ' ').trim().slice(0, 160); }
      catch { /* The panel still shows the annotation when copying text is unavailable. */ }
      return [annotationKey(annotation.ref), { geometry: geometryKey(annotation), text: summary }] as const;
    })).then((summaries) => {
      if (controller.signal.aborted) return;
      summaries.forEach(([id, summary]) => summaryCacheRef.current.set(id, summary));
      setRevision((value) => value + 1);
    });
    return () => controller.abort();
  }, [documentId, entries, registry, textRevision]);

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      const root = contentRef.current;
      if (!root) return;
      const items = [...root.querySelectorAll<HTMLElement>('[data-comment-page]')];
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
  }, [currentPageNumber, entries.length]);

  return (
    <div className={styles.layout}>
      <PanelContent ref={contentRef} padding="compact" className={styles.panel}>
        {status === 'loading' ? <PanelState>Loading comments...</PanelState> : null}
        {status === 'forbidden' || status === 'error' ? <PanelState>Comments are unavailable.</PanelState> : null}
        {status === 'ready' && !entries.length ? (
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
                <div className={styles.pageHeader}>
                  <span>Page {pages[group.pageIndex]?.label ?? group.pageIndex + 1}</span>
                  <span className={styles.pageCount}>{group.entries.length}</span>
                </div>
                <ol className={styles.entries}>
                  {group.entries.map((annotation) => {
                    const Icon = getEntryIcon(annotation.subtype);
                    const label = getAnnotationLabel(annotation);
                    const contents = annotation.contents?.trim();
                    const isTextMarkup = TEXT_MARKUP_TYPES.has(annotation.subtype);
                    const hasExtractedSummary = summaryCacheRef.current.has(annotationKey(annotation.ref));
                    const summary = contents || (isTextMarkup
                      ? hasExtractedSummary
                        ? summaryCacheRef.current.get(annotationKey(annotation.ref))?.text || 'Text summary unavailable'
                        : 'Loading text summary…'
                      : 'No text content');

                    return (
                      <li
                        key={annotationKey(annotation.ref)}
                        className={styles.item}
                        data-comment-annotation-id={annotationKey(annotation.ref)}
                      >
                        <button
                          type="button"
                          className={styles.cardTarget}
                          onClick={() => {
                            if (registry && documentId) {
                              getAnnotationScope(registry, documentId)?.scope.selection.select([annotation.ref]);
                              stage?.reveal(group.pageIndex, getAnnotationRects(annotation));
                            }
                          }}
                          aria-label={`Go to ${label} on page ${group.pageIndex + 1}`}
                        />
                        <div className={styles.heading}>
                          <span className={styles.icon}><Icon size={15} strokeWidth={2} /></span>
                          <span className={styles.type}>{label}</span>
                        </div>
                        <div className={`${styles.body} ${styles.readonlyBody}`}>{summary}</div>
                      </li>
                    );
                  })}
                </ol>
              </li>
            ))}
          </ol>
        ) : null}
      </PanelContent>
    </div>
  );
}
