import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { annotationKey, type Engine, type Kernel } from '@embedpdf/core';
import type { Annotation } from '@embedpdf/plugin-annotation';
import { sliceText } from '@embedpdf/engine-core';
import { Highlighter, MessageSquareMore, PenLine, Shapes, Strikethrough, Type, Underline } from 'lucide-react';
import { PanelContent, PanelState } from '../components';
import { TEXT_MARKUP_TYPES, getAnnotationLabel, getAnnotationRects, getAnnotationScope, rectsIntersect } from './annotations';
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
export function Comments({ engine, registry, documentId, stage, currentPageNumber }: {
  engine: Engine; registry?: Kernel; documentId?: string | null; stage?: ViewerStage | null; currentPageNumber: number;
}) {
  const [revision, setRevision] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const summaryCacheRef = useRef(new Map<string, string>());
  const entries = useMemo(() => {
    const scope = getAnnotationScope(registry, documentId)?.scope;
    if (!scope || !registry || !documentId) return [];
    return scope.list().filter((annotation) => !['link', 'popup', 'widget'].includes(annotation.subtype))
      .toSorted((a, b) => registry.documents.getPageIndex(a.page, documentId) - registry.documents.getPageIndex(b.page, documentId) || a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  }, [registry, documentId, revision]);
  const pageGroups = useMemo(() => entries.reduce<{ pageIndex: number; entries: Annotation[] }[]>((groups, annotation) => {
    const pageIndex = registry!.documents.getPageIndex(annotation.page, documentId!);
    const previous = groups.at(-1);
    if (previous?.pageIndex === pageIndex) previous.entries.push(annotation);
    else groups.push({ pageIndex, entries: [annotation] });
    return groups;
  }, []), [entries, registry, documentId]);
  useEffect(() => {
    summaryCacheRef.current.clear();
    const scope = getAnnotationScope(registry, documentId)?.scope;
    if (!scope) return;
    const sync = () => { summaryCacheRef.current.clear(); setRevision((value) => value + 1); };
    const cleanups = [scope.onCreated(sync), scope.onUpdated(sync), scope.onDeleted(sync), scope.onResynced(sync)];
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [registry, documentId]);
  useEffect(() => {
    const doc = getDocument(registry, documentId);
    if (!doc) return;
    let cancelled = false;
    const pending = entries.filter((annotation) => TEXT_MARKUP_TYPES.has(annotation.subtype) && !annotation.contents?.trim() && !summaryCacheRef.current.has(annotationKey(annotation.ref)));
    if (!pending.length) return;
    // Both text and geometry are requested through the v3 page service. Keep
    // character-space slicing so ligatures and supplementary characters survive.
    const pages = new Map<string, Promise<[Awaited<ReturnType<ReturnType<typeof doc.page>['text']['get']>>, Awaited<ReturnType<ReturnType<typeof doc.page>['text']['layout']>>]>>();
    void Promise.all(pending.map(async (annotation) => {
      const key = JSON.stringify(annotation.page);
      let page = pages.get(key);
      if (!page) { const handle = doc.page(annotation.page); page = Promise.all([handle.text.get(), handle.text.layout()]); pages.set(key, page); }
      let summary = '';
      try {
        const [text, layout] = await page;
        const rects = getAnnotationRects(annotation);
        const pieces: string[] = [];
        for (let index = 0; index < layout.charCount; index++) {
          const quad = layout.charQuad(index);
          if (!quad) continue;
          const points = [quad.upperLeft, quad.upperRight, quad.lowerLeft, quad.lowerRight];
          const x = Math.min(...points.map((point) => point.x)), y = Math.min(...points.map((point) => point.y));
          const rect = { x, y, width: Math.max(...points.map((point) => point.x)) - x, height: Math.max(...points.map((point) => point.y)) - y };
          if (rects.some((target) => rectsIntersect(target, rect))) pieces.push(sliceText(text, { start: index, count: 1 }));
        }
        summary = pieces.join('').replace(/\s+/g, ' ').trim().slice(0, 160);
      } catch { /* The panel still shows the annotation when text is unavailable. */ }
      return [annotationKey(annotation.ref), summary] as const;
    })).then((summaries) => {
      if (cancelled) return;
      summaries.forEach(([id, summary]) => summaryCacheRef.current.set(id, summary));
      setRevision((value) => value + 1);
    });
    return () => { cancelled = true; };
  }, [documentId, engine, entries, registry]);

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
                <div className={styles.pageHeader}>
                  <span>Page {group.pageIndex + 1}</span>
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
                        ? summaryCacheRef.current.get(annotationKey(annotation.ref)) || 'Text summary unavailable'
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
