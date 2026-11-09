import { AutoGrowingTextarea } from '../components/auto-growing-textarea';
import { PopoverResizeHandle } from '../components/popover-resize-handle';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Kernel } from '@embedpdf/core';
import { annotationKey } from '@embedpdf/core';
import { StageToken } from '@embedpdf/plugin-stage';
import { useAnnotation, useAnnotationList, useAnnotationAnchor } from '@embedpdf/react/annotation';
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
  const scope = useAnnotation();
  const annotations = useAnnotationList();
  const annotation = annotations.find((item) => annotationKey(item.ref) === annotationId);
  const visual = useAnnotationAnchor(annotation?.ref ?? null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Untouched content comes directly from EmbedPDF. Only user edits are local.
  const [draft, setDraft] = useState<{ base: string; text: string } | null>(null);
  const draftRef = useRef(draft);
  const contents = annotation?.contents ?? '';
  const discarded = useRef(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number; height: number } | null>(null);
  const horizontalFraction = useRef<number | null>(null);
  const pageIndex = annotation ? registry.documents.getPageIndex(annotation.page, documentId) : undefined;

  // Save on dismissal or when another annotation replaces this editor.
  useEffect(() => () => {
    if (discarded.current || pageIndex === undefined || !draftRef.current) return;
    const currentScope = getAnnotationScope(registry, documentId)?.scope;
    const current = currentScope?.list().find((item) => annotationKey(item.ref) === annotationId);
    const contents = draftRef.current.text.trim();
    if (current && currentScope?.comments.canSetText(current.ref) && contents !== (current.contents ?? '')) {
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
      const stage = registry.tryCapability(StageToken, documentId);
      const current = scope?.get(annotation.ref);
      const pageFrame = current && stage?.getPageBox(current.page);
      const bounds = visual && pageFrame && stage
        ? visual.boundsIn?.({ zoom: stage.getZoomLevel(), rotation: pageFrame.rotation }) ?? visual.bounds : null;
      const projection = visual && bounds && stage?.pageRectToViewport(visual.page, bounds);
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
      stage?.onSettingsChanged(schedule)];
    window.addEventListener('resize', schedule);
    update();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      cleanups.forEach(cleanup => cleanup?.());
      window.removeEventListener('resize', schedule);
    };
  }, [registry, documentId, scope, annotation, visual, pointerX, onClose]);

  async function saveAndClose() {
    if (busy || !annotation) return;
    const contents = (draftRef.current?.text ?? annotation.contents ?? '').trim();
    if (!scope.comments.canSetText(annotation.ref) || contents === (annotation.contents ?? '')) { onClose(); return; }
    setBusy(true); setError('');
    try {
      await scope.comments.setText(annotation.ref, contents);
      draftRef.current = null;
      setDraft(null);
      onClose();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Failed to save comment.'); }
    finally { setBusy(false); }
  }

  if (!annotation || !anchor) return null;
  return (
    <FloatingPopover
      anchor={anchor}
      sideOffset={10}
      onClose={() => void saveAndClose()}
      dismissOnFocusOutside={false}
      label="Edit comment"
      role="dialog"
      className={`pdf-glass-surface pdf-glass-popover ${styles.commentPopover}`}
    >
      <div className={styles.editorHeading}>
        <MessageSquareMore size={14} className="text-accent" />
        <span className={styles.type}>{getAnnotationLabel(annotation)}</span>
        <div className={styles.actions}>
          <IconButton label="Delete annotation" icon={Trash} disabled={busy || !scope.comments.canDelete(annotation.ref)} onClick={() => {
            setBusy(true); setError('');
            void scope.comments.delete(annotation.ref).then(() => {
              discarded.current = true; onClose();
            }).catch(failure => setError(failure instanceof Error ? failure.message : 'Failed to delete comment.'))
              .finally(() => setBusy(false));
          }} />
          <IconButton label="Done" icon={CircleCheckBig} disabled={busy} onClick={() => void saveAndClose()} />
        </div>
      </div>
      <AutoGrowingTextarea
        className={styles.textarea}
        value={draft?.text ?? contents}
        readOnly={busy || !scope.comments.canSetText(annotation.ref)}
        onChange={(event) => {
          const text = event.currentTarget.value;
          const base = draftRef.current?.base ?? contents;
          const next = text === base ? null : { base, text };
          draftRef.current = next;
          setDraft(next);
        }}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void saveAndClose();
        }}
        placeholder="Write a comment…"
        aria-label="Comment"
        autoFocus
      />
      {error ? <p role="alert">{error}</p> : null}
      <PopoverResizeHandle />
    </FloatingPopover>
  );
}
