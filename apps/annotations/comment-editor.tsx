import { AutoGrowingTextarea } from '../components/auto-growing-textarea';
import { PopoverResizeHandle } from '../components/popover-resize-handle';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Kernel } from '@embedpdf/core';
import { annotationKey } from '@embedpdf/core';
import { StageToken } from '@embedpdf/plugin-stage';
import { annotationAnchor, fromDTO, initialModel } from '@embedpdf/core-annotation';
import { CircleCheckBig, MessageSquareMore, Trash } from 'lucide-react';
import { FloatingPopover, IconButton } from '../components';
import { getAnnotationLabel, getAnnotationScope } from './annotations';
import styles from './comments.module.css';

export function CommentEditor({ registry, documentId, annotationId, pointerX, onClose }: {
  registry: Kernel;
  documentId: string;
  annotationId: string;
  pointerX?: number;
  onClose(): void;
}) {
  const scope = getAnnotationScope(registry, documentId)?.scope;
  const annotation = scope?.list().find((item) => annotationKey(item.ref) === annotationId);
  const [draft, setDraft] = useState(annotation?.contents ?? '');
  const draftRef = useRef(draft);
  const initialText = useRef(draft);
  const discarded = useRef(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number; height: number } | null>(null);
  const horizontalFraction = useRef<number | null>(null);
  const pageIndex = annotation ? registry.documents.getPageIndex(annotation.page, documentId) : undefined;

  // Save on dismissal or when another annotation replaces this editor.
  useEffect(() => () => {
    if (discarded.current || pageIndex === undefined || draftRef.current === initialText.current) return;
    const currentScope = getAnnotationScope(registry, documentId)?.scope;
    const current = currentScope?.list().find((item) => annotationKey(item.ref) === annotationId);
    const contents = draftRef.current.trim();
    if (current && contents !== (current.contents ?? '')) {
      void currentScope?.comments.setText(current.ref, contents).catch((error) => console.error('[pdf-ts] failed to save comment', error));
    }
  }, [registry, documentId, annotationId, pageIndex]);

  useEffect(() => {
    if (!scope) return;
    const sync = () => {
      if (draftRef.current !== initialText.current) return;
      const current = scope.list().find(item => annotationKey(item.ref) === annotationId);
      if (!current) return;
      const contents = current.contents ?? '';
      initialText.current = contents; draftRef.current = contents;
      setDraft(contents);
    };
    const cleanups = [scope.onUpdated(sync), scope.onResynced(sync)];
    sync();
    return () => cleanups.forEach(cleanup => cleanup());
  }, [scope, annotationId]);

  useEffect(() => scope?.onDeleted((event) => {
    if (event.refs.some((ref) => annotationKey(ref) === annotationId)) {
      discarded.current = true;
      onClose();
    }
  }), [scope, annotationId, onClose]);

  useLayoutEffect(() => {
    if (!annotation) { onClose(); return; }
    let frame = 0;
    const update = () => {
      const stage = registry.tryCapability(StageToken, documentId);
      const current = scope?.get(annotation.ref);
      const pageFrame = current && stage?.getPageBox(current.page);
      const record = current && fromDTO(current);
      const visual = record && pageFrame && stage && annotationAnchor(
        { ...initialModel, byId: { [record.id]: record }, order: [record.id] }, record.id,
        { zoom: stage.getZoomLevel(), rotation: pageFrame.rotation },
      );
      const projection = visual && stage?.pageRectToViewport(visual.page, visual.bounds);
      const element = document.querySelector<HTMLElement>(`[data-pdf-document-layer="${documentId}"] .viewer`);
      if (projection && element) {
        const bounds = element.getBoundingClientRect();
        const left = bounds.left + element.clientLeft + projection.x;
        const right = left + projection.width;
        const y = bounds.top + element.clientTop + projection.y;
        const bottom = y + projection.height;
        // Keep the clicked horizontal position attached to the annotation as the view changes.
        horizontalFraction.current ??= pointerX === undefined || right === left
          ? 0
          : Math.max(0, Math.min(1, (pointerX - left) / (right - left)));
        const x = left + (right - left) * horizontalFraction.current;
        // A full-height anchor lets collision handling flip above the entire highlight.
        const height = bottom - y;
        setAnchor((previous) => previous?.x === x && previous.y === y && previous.height === height
          ? previous : { x, y, height });
      } else {
        setAnchor(null);
      }
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; update(); });
    };
    const stage = registry.tryCapability(StageToken, documentId);
    const element = document.querySelector<HTMLElement>(`[data-pdf-document-layer="${documentId}"] .viewer`);
    const observer = new ResizeObserver(schedule);
    if (element) observer.observe(element);
    const cleanups = [stage?.onCameraChanged(schedule), stage?.onViewportChanged(schedule),
      stage?.onSettingsChanged(schedule), scope?.onUpdated(schedule), scope?.onResynced(schedule)];
    window.addEventListener('resize', schedule);
    update();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      cleanups.forEach(cleanup => cleanup?.());
      window.removeEventListener('resize', schedule);
    };
  }, [registry, documentId, scope, annotation, pointerX, onClose]);

  if (!annotation || !anchor) return null;
  return (
    <FloatingPopover
      anchor={anchor}
      sideOffset={10}
      onClose={onClose}
      dismissOnFocusOutside={false}
      label="Edit comment"
      role="dialog"
      className={`pdf-glass-surface pdf-glass-popover ${styles.commentPopover}`}
    >
      <div className={styles.editorHeading}>
        <MessageSquareMore size={14} className="text-accent" />
        <span className={styles.type}>{getAnnotationLabel(annotation)}</span>
        <div className={styles.actions}>
          <IconButton label="Delete annotation" icon={Trash} onClick={() => {
            discarded.current = true;
            void scope?.comments.delete(annotation.ref).catch((error) => console.error('[pdf-ts] failed to delete annotation', error));
            onClose();
          }} />
          <IconButton label="Done" icon={CircleCheckBig} onClick={onClose} />
        </div>
      </div>
      <AutoGrowingTextarea
        className={styles.textarea}
        value={draft}
        onChange={(event) => {
          draftRef.current = event.currentTarget.value;
          setDraft(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') onClose();
        }}
        placeholder="Write a comment…"
        aria-label="Comment"
        autoFocus
      />
      <PopoverResizeHandle />
    </FloatingPopover>
  );
}
