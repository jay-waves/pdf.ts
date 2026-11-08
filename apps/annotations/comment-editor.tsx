import { AutoGrowingTextarea } from '../components/auto-growing-textarea';
import { PopoverResizeHandle } from '../components/popover-resize-handle';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Kernel } from '@embedpdf/core';
import { annotationKey } from '@embedpdf/core';
import { StageToken } from '@embedpdf/plugin-stage';
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
  const discarded = useRef(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number; height: number } | null>(null);
  const horizontalFraction = useRef<number | null>(null);
  const pageIndex = annotation ? registry.documents.getPageIndex(annotation.page, documentId) : undefined;

  // Save on dismissal or when another annotation replaces this editor.
  useEffect(() => () => {
    if (discarded.current || pageIndex === undefined) return;
    const currentScope = getAnnotationScope(registry, documentId)?.scope;
    const current = currentScope?.list().find((item) => annotationKey(item.ref) === annotationId);
    const contents = draftRef.current.trim();
    if (current && contents !== (current.contents ?? '')) {
      void currentScope?.comments.setText(current.ref, contents).catch((error) => console.error('[pdf-ts] failed to save comment', error));
    }
  }, [registry, documentId, annotationId, pageIndex]);

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
      const projection = registry.tryCapability(StageToken, documentId)?.pageRectToViewport(annotation.page, annotation.rect);
      const element = document.querySelector<HTMLElement>(`[data-pdf-document-layer="${documentId}"] .viewer`);
      if (projection && element) {
        const bounds = element.getBoundingClientRect();
        const left = bounds.left + projection.x;
        const right = left + projection.width;
        const y = bounds.top + projection.y;
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
      frame = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(frame);
  }, [registry, documentId, annotation, pointerX, onClose]);

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
