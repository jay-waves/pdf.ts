import { AutoGrowingTextarea } from '../components/auto-growing-textarea';
import { PopoverResizeHandle } from '../components/popover-resize-handle';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import { transformPosition, type Rotation } from '@embedpdf/models';
import { CircleCheckBig, MessageSquareMore, Trash } from 'lucide-react';
import { FloatingPopover, IconButton } from '../components';
import { getDocumentState } from '../document/viewer-document';
import { getAnnotationLabel, getAnnotationScope } from './annotations';
import styles from './comments.module.css';

export function CommentEditor({ registry, documentId, annotationId, pointerX, onClose }: {
  registry: PluginRegistry;
  documentId: string;
  annotationId: string;
  pointerX?: number;
  onClose(): void;
}) {
  const scope = getAnnotationScope(registry, documentId)?.scope;
  const annotation = scope?.getAnnotations().find(({ object }) => object.id === annotationId)?.object;
  const [draft, setDraft] = useState(annotation?.contents ?? '');
  const draftRef = useRef(draft);
  const discarded = useRef(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number; height: number } | null>(null);
  const horizontalFraction = useRef<number | null>(null);
  const pageIndex = annotation?.pageIndex;

  // Save on dismissal or when another annotation replaces this editor.
  useEffect(() => () => {
    if (discarded.current || pageIndex === undefined) return;
    const currentScope = getAnnotationScope(registry, documentId)?.scope;
    const current = currentScope?.getAnnotations().find(({ object }) => object.id === annotationId)?.object;
    const contents = draftRef.current.trim();
    if (current && contents !== (current.contents ?? '')) {
      currentScope?.updateAnnotation(pageIndex, annotationId, { contents });
    }
  }, [registry, documentId, annotationId, pageIndex]);

  useEffect(() => scope?.onAnnotationEvent((event) => {
    if (event.type === 'delete' && event.annotation.id === annotationId) {
      discarded.current = true;
      onClose();
    }
  }), [scope, annotationId, onClose]);

  useLayoutEffect(() => {
    if (!annotation) { onClose(); return; }
    let frame = 0;
    const update = () => {
      const state = getDocumentState(registry, documentId);
      const page = state?.document?.pages[annotation.pageIndex];
      const element = document.querySelector<HTMLElement>(`[data-pdf-page-index="${annotation.pageIndex}"]`);
      if (page && state && element) {
        const bounds = element.getBoundingClientRect();
        const rotation = ((page.rotation + state.rotation) % 4) as Rotation;
        const { origin, size } = annotation.rect;
        const corners = [
          origin,
          { x: origin.x + size.width, y: origin.y },
          { x: origin.x, y: origin.y + size.height },
          { x: origin.x + size.width, y: origin.y + size.height },
        ].map((point) => transformPosition(page.size, point, rotation, state.scale));
        const left = bounds.left + Math.min(...corners.map((point) => point.x));
        const right = bounds.left + Math.max(...corners.map((point) => point.x));
        const y = bounds.top + Math.min(...corners.map((point) => point.y));
        const bottom = bounds.top + Math.max(...corners.map((point) => point.y));
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
            scope?.deleteAnnotations([{ pageIndex: annotation.pageIndex, id: annotationId }]);
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
