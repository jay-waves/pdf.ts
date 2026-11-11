import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Kernel } from '@embedpdf/core';
import { annotationKey, type DocumentHandle } from '@embedpdf/core';
import type { Annotation } from '@embedpdf/plugin-annotation';
import type { Rect } from '@embedpdf/core-geometry';
import { RenderToken } from '@embedpdf/plugin-render';
import { StageToken } from '@embedpdf/plugin-stage';
import { readMarkupPage } from '../annotations/markup-text';
import { SelectionToken, type SelectionCapability } from '@embedpdf/plugin-selection';
import {
  createCommentAnnotation,
  createTextMarkupAnnotations,
  getAnnotationRects,
  getAnnotationScope,
  isCaptureAnnotation,
  isTextMarkupAnnotation,
  type CaptureAnnotation,
  type TextMarkupAnnotation,
  type TextMarkupSubtype,
} from '../annotations/annotations';
import {
  Copy,
  ExternalLink,
  Highlighter,
  Image as ImageIcon,
  Languages,
  Link,
  MessageSquareMore,
  PaintBucket,
  Send,
  Trash2,
} from 'lucide-react';
import { FloatingPopover, IconButton } from '../components';
import { isEditableTarget, normalizePdfText } from '../shared/utils';
import { getExternalUrl, getSelectedExternalUrl } from '../shared/url';
import { platform } from '#platform';
import { getDocument } from '../document/viewer-document';
import type { ViewerCommandDispatch } from '../viewer/viewer-controller';
import { runTranslateAction, isTranslationEnabled, isLlmEnabled } from './translation-settings';

type ContextMenuState = {
  kind: 'selection' | 'annotation';
  x: number;
  y: number;
};

const CAPTURE_PADDING = 3;
const CAPTURE_SCALE = 4;
const MAX_CAPTURE_PIXELS = 16_000_000;
const TEXT_SELECTION_HIT_PADDING = 6;

function isTextSelectionHit(container: HTMLElement, registry: Kernel, documentId: string, selection: SelectionCapability, x: number, y: number) {
  const viewport = container.querySelector<HTMLElement>('.viewer');
  const stage = registry.tryCapability(StageToken, documentId);
  if (!viewport || !stage) return false;
  const bounds = viewport.getBoundingClientRect();
  const vx = x - bounds.left - viewport.clientLeft;
  const vy = y - bounds.top - viewport.clientTop;
  return selection.getSnapshot().pages.some(({ page, segments }) => segments.some(({ rect }) => {
    const corners = [
      { x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y },
      { x: rect.x, y: rect.y + rect.height }, { x: rect.x + rect.width, y: rect.y + rect.height },
    ].map(point => stage.pageToViewport(page, point));
    if (corners.some(point => !point)) return false;
    const points = corners.filter(point => point !== null);
    return vx >= Math.min(...points.map(point => point.x)) - TEXT_SELECTION_HIT_PADDING
      && vx <= Math.max(...points.map(point => point.x)) + TEXT_SELECTION_HIT_PADDING
      && vy >= Math.min(...points.map(point => point.y)) - TEXT_SELECTION_HIT_PADDING
      && vy <= Math.max(...points.map(point => point.y)) + TEXT_SELECTION_HIT_PADDING;
  }));
}

function getExternalLink(annotation: Annotation | undefined) {
  return annotation?.subtype === 'link' && annotation.target?.kind === 'uri' ? getExternalUrl(annotation.target.uri) : null;
}
async function copyText(value: string) { const text = normalizePdfText(value); if (text) await navigator.clipboard.writeText(text); }
function copySelectedText(selection: SelectionCapability) {
  return selection.readText().then(copyText).catch((error) => console.error('[pdf-ts] failed to copy selected text', error));
}
async function getTextMarkupText(document: DocumentHandle, annotation: TextMarkupAnnotation) {
  const text = await readMarkupPage(document.page(annotation.page));
  return text(getAnnotationRects(annotation));
}
async function copyAnnotationImage(registry: Kernel, documentId: string, annotation: CaptureAnnotation) {
  const render = registry.tryCapability(RenderToken, documentId);
  const page = registry.documents.getPage(annotation.page, documentId);
  if (!render || !page) throw new Error('Image clipboard is unavailable');
  const rects = getAnnotationRects(annotation);
  const x = Math.max(0, Math.min(...rects.map((rect) => rect.x)) - CAPTURE_PADDING);
  const y = Math.max(0, Math.min(...rects.map((rect) => rect.y)) - CAPTURE_PADDING);
  const right = Math.min(page.size.width, Math.max(...rects.map((rect) => rect.x + rect.width)) + CAPTURE_PADDING);
  const bottom = Math.min(page.size.height, Math.max(...rects.map((rect) => rect.y + rect.height)) + CAPTURE_PADDING);
  const rect = { x, y, width: right - x, height: bottom - y };
  if (rect.width <= 0 || rect.height <= 0) throw new Error('Annotation has no visible area');
  const image = render.renderPage(annotation.page, { rect,
    scale: Math.min(CAPTURE_SCALE, Math.sqrt(MAX_CAPTURE_PIXELS / (rect.width * rect.height))),
    rotation: registry.tryCapability(StageToken, documentId)?.getViewRotation() ?? 0,
    format: 'png', includeAnnotations: false, includeFormFields: true,
  }).then((image) => image.blob());
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': image })]);
}

export function ContextMenu({
  registry,
  documentId,
  container,
  dispatch,
}: {
  registry?: Kernel;
  documentId?: string | null;
  container: HTMLElement | null;
  dispatch: ViewerCommandDispatch;
}) {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [selectedText, setSelectedText] = useState('');
  const documentStatus = useSyncExternalStore(
    (listener) => registry?.subscribe(listener) ?? (() => {}),
    () => documentId ? registry?.documents.get(documentId)?.status ?? null : null,
  );
  useEffect(() => {
    setSelectedText('');
    if (menu?.kind !== 'selection' || !registry || !documentId) return;
    let active = true;
    const scope = registry.tryCapability(SelectionToken, documentId);
    void scope?.readText().then((parts) => {
      if (active) setSelectedText(normalizePdfText(parts).trim());
    }).catch(() => {});
    return () => { active = false; };
  }, [menu, registry, documentId]);
  useEffect(() => {
    if (!registry || !documentId) return;
    const selection = registry.tryCapability(SelectionToken, documentId);
    const annotation = getAnnotationScope(registry, documentId)?.scope;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey
        || event.composedPath().some(isEditableTarget)
        || isEditableTarget(window.document.activeElement)
        || window.document.querySelector('[role="dialog"], [role="alertdialog"]')) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
        if (window.getSelection()?.toString() || !selection
          || !selection.hasSelection()) return;
        event.preventDefault();
        event.stopPropagation();
        void copySelectedText(selection);
      } else if (!event.ctrlKey && !event.metaKey
        && (event.key === 'Delete' || event.key === 'Backspace')) {
        const selected = annotation?.selection.getSelected().filter((item) => annotation.canDelete(item.ref));
        if (!selected?.length) return;
        event.preventDefault();
        event.stopPropagation();
        void annotation?.selection.delete();
      } else {
        return;
      }
      setMenu(null);
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [documentId, registry, documentStatus]);

  useEffect(() => {
    if (!registry || !documentId || !container) return;
    const selection = registry.tryCapability(SelectionToken, documentId);
    const annotation = getAnnotationScope(registry, documentId)?.scope;

    const isViewerEvent = (event: Event) => event.composedPath().some((target) => (
      target instanceof HTMLElement && target.classList.contains('viewer')
    ));

    const annotationAt = (event: MouseEvent) => {
      const viewport = container.querySelector<HTMLElement>('.viewer');
      const stage = registry.tryCapability(StageToken, documentId);
      if (!viewport || !stage || !annotation) return null;
      const bounds = viewport.getBoundingClientRect();
      const hit = stage.getPageAt({ x: event.clientX - bounds.left - viewport.clientLeft,
        y: event.clientY - bounds.top - viewport.clientTop });
      return hit ? annotation.getAt(hit.ref, hit.point) : null;
    };

    const openAnnotationMenu = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const commentBadge = target?.closest<HTMLElement>('[data-annotation-comment-id]');
      if (event.button === 0 && commentBadge?.dataset.annotationCommentId) {
        dispatch({ type: 'ui/open-overlay', overlay: {
          type: 'comment-editor', annotationId: commentBadge.dataset.annotationCommentId, pointerX: event.clientX,
        } });
        setMenu(null);
        return;
      }
      if (event.button !== 0 || !isViewerEvent(event) || event.composedPath().some(isEditableTarget)) return;
      const hit = annotationAt(event);
      const selected = annotation?.selection.getSelected() ?? [];
      // Native v3 annotation painting is pointer-transparent. Hit-test the model,
      // and only open after a click actually selected the annotation.
      if (!hit || !selected.some(item => annotationKey(item.ref) === annotationKey(hit.ref))) return;
      if (selected.length === 1 && selected[0].subtype === 'text') {
        dispatch({ type: 'ui/open-overlay', overlay: { type: 'comment-editor', annotationId: annotationKey(selected[0].ref), pointerX: event.clientX } });
        setMenu(null);
        return;
      }
      setMenu({ kind: 'annotation', x: event.clientX + 8, y: event.clientY + 8 });
    };

    const openContextMenu = (event: MouseEvent) => {
      if (!isViewerEvent(event) || event.composedPath().some(isEditableTarget)) return;
      event.preventDefault();
      event.stopPropagation();

      if (selection?.hasSelection() && isTextSelectionHit(container, registry, documentId, selection, event.clientX, event.clientY)) {
        setMenu({ kind: 'selection', x: event.clientX + 8, y: event.clientY + 8 });
        return;
      }
      const hit = annotationAt(event);
      if (!hit || !annotation) { setMenu(null); return; }
      if (!annotation.selection.getSelected().some(item => annotationKey(item.ref) === annotationKey(hit.ref))) {
        annotation.selection.select([hit.ref]);
      }
      setMenu({ kind: 'annotation', x: event.clientX + 8, y: event.clientY + 8 });
    };

    container.addEventListener('click', openAnnotationMenu);
    container.addEventListener('contextmenu', openContextMenu, { capture: true });
    return () => {
      container.removeEventListener('click', openAnnotationMenu);
      container.removeEventListener('contextmenu', openContextMenu, { capture: true });
    };
  }, [container, documentId, registry, dispatch, documentStatus]);

  useEffect(() => {
    if (!menu) return;

    const close = () => setMenu(null);

    window.addEventListener('resize', close);
    const unsubscribeCamera = documentId ? registry?.tryCapability(StageToken, documentId)?.onCameraChanged(close) : undefined;
    return () => {
      window.removeEventListener('resize', close);
      unsubscribeCamera?.();
    };
  }, [menu, registry, documentId]);

  if (!menu || !registry || !documentId) return null;

  const selectionScope = registry.tryCapability(SelectionToken, documentId);
  const annotation = getAnnotationScope(registry, documentId)?.scope;

  const addTextMarkup = async (type: TextMarkupSubtype) => {
    if (!selectionScope || !annotation) return;

    await createTextMarkupAnnotations(annotation, type);
    setMenu(null);
  };

  const selectionItems = [
    { label: 'Copy', icon: Copy, action: () => {
      setMenu(null);
      if (selectionScope) void copySelectedText(selectionScope);
    } },
    { label: 'Highlight', icon: Highlighter, action: () => addTextMarkup('highlight') },
    { label: 'Comment', icon: MessageSquareMore, action: async () => {
      // Capture geometry before authoring clears the selection. The worker can
      // confirm creation before the plugin's returned annotation lookup catches up.
      const anchor = selectionScope?.getAnchor();
      if (!anchor || !annotation) return;
      try {
        await createTextMarkupAnnotations(annotation, 'highlight');
        await openComment({ subtype: 'highlight', page: anchor.page, rect: anchor.bounds });
      } catch (error) { console.error('[pdf-ts] failed to add selection comment', error); }
    } },
    ...(isTranslationEnabled(platform.getPreference) ? [{
      label: isLlmEnabled(platform.getPreference) ? 'Translate' : 'Translate (Google Translate)',
      icon: Languages,
      disabled: !isLlmEnabled(platform.getPreference) && !selectedText,
      action: () => {
        // Open external translation synchronously from the click to preserve user activation.
        runTranslateAction({
          text: selectedText,
          llmEnabled: isLlmEnabled(platform.getPreference),
          openLlm: () => dispatch({ type: 'ui/open-overlay', overlay: { type: 'translation', request: { documentId, anchor: menu, mode: 'translate' } } }),
          openExternal: platform.openExternal,
        });
        setMenu(null);
    } }] : []),
    ...(Boolean(platform.ai) && isLlmEnabled(platform.getPreference) ? [{ label: 'LLM', icon: Send, action: () => {
      dispatch({ type: 'ui/open-overlay', overlay: { type: 'translation', request: { documentId, anchor: menu, mode: 'llm' } } });
      setMenu(null);
    } }] : []),
    { label: 'Search', icon: ExternalLink, action: () => {
      const selectedText = selectionScope?.readText();
      setMenu(null);
      selectedText?.then((parts) => normalizePdfText(parts).replace(/\s+/g, ' ').trim())
        .then((query) => {
          if (!query) return;
          platform.openExternal(
            getSelectedExternalUrl(query) ?? `https://www.google.com/search?q=${encodeURIComponent(query)}`,
          );
        })
        .catch((error) => console.error('[pdf-ts] failed to search selected text', error));
    } },
  ];

  const selectedAnnotations = annotation?.selection.getSelected() ?? [];
  const selectedLink = selectedAnnotations.length === 1
    ? getExternalLink(selectedAnnotations[0])
    : null;
  const commentTarget = selectedAnnotations[0];
  const selectedTextMarkup = selectedAnnotations.length === 1 && isTextMarkupAnnotation(commentTarget)
    ? commentTarget
    : null;
  const selectedCaptureAnnotation = selectedAnnotations.length === 1 && isCaptureAnnotation(commentTarget)
    ? commentTarget
    : null;
  const document = getDocument(registry, documentId);

  const openComment = async (target: Annotation | { subtype: 'highlight'; page: Annotation['page']; rect: Rect }) => {
    if (annotation) {
      let commentId = target.subtype === 'text' ? annotationKey(target.ref) : '';
      if (target.subtype !== 'text') {
        const stage = registry.tryCapability(StageToken, documentId);
        const viewport = container?.querySelector<HTMLElement>('.viewer');
        const page = registry.documents.getPage(target.page, documentId);
        let noteRect: Rect | undefined;
        if (stage && viewport && page) {
          const bounds = viewport.getBoundingClientRect();
          const pageBox = stage.pageRectToViewport(target.page, { x: 0, y: 0, ...page.size });
          const targetBox = stage.pageRectToViewport(target.page, target.rect);
          if (pageBox && targetBox) {
            const size = Math.min(24, page.size.width, page.size.height);
            const screenSize = size * pageBox.width / ((stage.getPageBox(target.page)?.rotation ?? 0) % 180 ? page.size.height : page.size.width);
            const gap = 4;
            const below = targetBox.y + targetBox.height + gap;
            const above = targetBox.y - screenSize - gap;
            const fitsBelow = below + screenSize <= Math.min(pageBox.y + pageBox.height, viewport.clientHeight);
            const x = Math.max(pageBox.x, Math.min(pageBox.x + pageBox.width - screenSize, menu.x - 8 - bounds.left - viewport.clientLeft));
            const y = Math.max(pageBox.y, Math.min(pageBox.y + pageBox.height - screenSize, fitsBelow || above < pageBox.y ? below : above));
            const first = stage.viewportToPage(target.page, { x, y });
            const last = stage.viewportToPage(target.page, { x: x + screenSize, y: y + screenSize });
            if (first && last) noteRect = { x: Math.max(0, Math.min(page.size.width - size, first.x, last.x)),
              y: Math.max(0, Math.min(page.size.height - size, first.y, last.y)), width: size, height: size };
          }
        }
        commentId = await createCommentAnnotation(annotation, target, noteRect);
      }
      dispatch({ type: 'ui/open-overlay', overlay: { type: 'comment-editor', annotationId: commentId, pointerX: menu.x - 8 } });
    }
    setMenu(null);
  };

  const annotationItems = [
    ...(selectedTextMarkup ? [{ label: 'Copy', icon: Copy, action: () => {
      setMenu(null);
      if (!document) return;
      getTextMarkupText(document, selectedTextMarkup)
        .then(copyText)
        .catch((error) => console.error('[pdf-ts] failed to copy text markup', error));
    } }] : []),
    ...(selectedCaptureAnnotation ? [{ label: 'Copy image', icon: ImageIcon, action: () => {
      setMenu(null);
      if (!document) return;
      copyAnnotationImage(registry, documentId, selectedCaptureAnnotation)
        .catch((error) => console.error('[pdf-ts] failed to copy annotation image', error));
    } }] : []),
    ...(selectedLink ? [{ label: 'Open link', icon: Link, action: () => {
      platform.openExternal(selectedLink);
      setMenu(null);
    } }] : []),
    ...(commentTarget?.subtype !== 'text' && commentTarget?.contents?.trim() ? [{
      label: 'Edit existing comment', icon: MessageSquareMore, action: () => {
        dispatch({ type: 'ui/open-overlay', overlay: { type: 'comment-editor', annotationId: annotationKey(commentTarget.ref), pointerX: menu.x - 8 } });
        setMenu(null);
      },
    }] : []),
    { label: commentTarget?.subtype === 'text' ? 'Edit comment' : 'Add nearby note', icon: MessageSquareMore, action: () => {
      if (commentTarget) openComment(commentTarget);
      setMenu(null);
    } },
    { label: 'Colors', icon: PaintBucket, action: () => {
      dispatch({ type: 'ui/open-overlay', overlay: { type: 'side-panel', panel: 'colors' } });
      setMenu(null);
    } },
    { label: 'Delete', icon: Trash2, action: () => {
      void annotation?.selection.delete();
      setMenu(null);
    } },
  ];

  const items = menu.kind === 'selection' ? selectionItems : annotationItems;
  if (!items.length) return null;
  return (
    <FloatingPopover
      onClose={() => setMenu(null)}
      anchor={menu}
      className="pdf-glass-surface pdf-glass-popover relative z-[2147483646] flex items-center gap-px rounded-lg border p-0.5 text-foreground"
      role="toolbar"
      label={menu.kind === 'selection' ? 'Text selection actions' : 'Annotation actions'}
      align={menu.kind === 'selection' ? 'center' : 'start'}
    >
      {items.map((item) => (
        <IconButton
          key={item.label}
          className="size-6 rounded active:bg-selected active:shadow-none"
          label={item.label}
          icon={item.icon}
          iconSize={13}
          onClick={item.action}
          disabled={'disabled' in item && Boolean(item.disabled)}
        />
      ))}
    </FloatingPopover>
  );
}
