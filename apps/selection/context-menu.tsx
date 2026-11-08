import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Kernel } from '@embedpdf/core';
import { annotationKey, type DocumentHandle, type Engine } from '@embedpdf/core';
import type { Annotation } from '@embedpdf/plugin-annotation';
import type { Rect } from '@embedpdf/core-geometry';
import { RenderToken } from '@embedpdf/plugin-render';
import { StageToken } from '@embedpdf/plugin-stage';
import { SelectionToken, type SelectionCapability } from '@embedpdf/plugin-selection';
import {
  createCommentAnnotation,
  createTextMarkupAnnotations,
  getAnnotationRects,
  getAnnotationScope,
  isCaptureAnnotation,
  isTextMarkupAnnotation,
  rectsIntersect,
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
import { supportsLlm } from '../platform/llm';
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

function isTextSelectionHit(container: HTMLElement, x: number, y: number) {
  const page = container.ownerDocument.elementFromPoint(x, y)?.closest('.pdf-page-surface');
  const selection = page?.querySelector<HTMLElement>('.pdf-text-selection-layer > div');
  if (!selection) return false;
  const rect = selection.getBoundingClientRect();
  return x >= rect.left - TEXT_SELECTION_HIT_PADDING
    && x <= rect.right + TEXT_SELECTION_HIT_PADDING
    && y >= rect.top - TEXT_SELECTION_HIT_PADDING
    && y <= rect.bottom + TEXT_SELECTION_HIT_PADDING;
}

function getExternalLink(annotation: Annotation | undefined) {
  return annotation?.subtype === 'link' && annotation.target?.kind === 'uri' ? getExternalUrl(annotation.target.uri) : null;
}
async function copyText(value: string) { const text = normalizePdfText(value); if (text) await navigator.clipboard.writeText(text); }
function copySelectedText(selection: SelectionCapability) {
  return selection.readText().then(copyText).catch((error) => console.error('[pdf-ts] failed to copy selected text', error));
}
async function getTextMarkupText(document: DocumentHandle, annotation: TextMarkupAnnotation) {
  const page = document.page(annotation.page);
  const geometry = await page.text.layout();
  const rects = getAnnotationRects(annotation);
  let first: number | undefined, last: number | undefined;
  for (let index = 0; index < geometry.charCount; index++) {
    const quad = geometry.charQuad(index);
    if (!quad) continue;
    const points = [quad.upperLeft, quad.upperRight, quad.lowerLeft, quad.lowerRight];
    const x = Math.min(...points.map((p) => p.x)), y = Math.min(...points.map((p) => p.y));
    const rect = { x, y, width: Math.max(...points.map((p) => p.x)) - x, height: Math.max(...points.map((p) => p.y)) - y };
    if (rects.some((target) => rectsIntersect(target, rect))) { first ??= index; last = index; }
  }
  return first === undefined || last === undefined ? '' : page.text.slice({ start: first, count: last - first + 1 });
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
  engine: _engine,
  registry,
  documentId,
  container,
  dispatch,
}: {
  engine: Engine;
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

    const preserveSelection = (event: MouseEvent) => {
      if (event.button !== 2 || !isViewerEvent(event) || !selection
        || !selection.hasSelection()
        || !isTextSelectionHit(container, event.clientX, event.clientY)) return;
      // The selection plugin clears on pointerdown, before contextmenu fires.
      event.stopPropagation();
      event.preventDefault();
    };

    const openAnnotationMenu = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const commentBadge = target?.closest<HTMLElement>('[data-annotation-comment-id]');
      if (event.button === 0 && commentBadge?.dataset.annotationCommentId) {
        dispatch({
          type: 'ui/open-comments',
          annotationId: commentBadge.dataset.annotationCommentId,
          pointerX: event.clientX,
        });
        setMenu(null);
        return;
      }
      const layer = target?.closest('.pdf-annotation-layer');
      if (event.button !== 0 || !layer || target === layer
        || event.composedPath().some(isEditableTarget)
        || !annotation?.selection.getSelected().length) return;
      const selected = annotation.selection.getSelected();
      if (selected.length === 1 && selected[0].subtype === 'text') {
        dispatch({ type: 'ui/open-comments', annotationId: annotationKey(selected[0].ref), pointerX: event.clientX });
        setMenu(null);
        return;
      }
      setMenu({ kind: 'annotation', x: event.clientX + 8, y: event.clientY + 8 });
    };

    const openContextMenu = (event: MouseEvent) => {
      if (!isViewerEvent(event)) return;
      event.preventDefault();
      event.stopPropagation();

      const hasSelection = Boolean(selection
        && selection.hasSelection());
      if (!hasSelection || !isTextSelectionHit(container, event.clientX, event.clientY)) return;
      setMenu({
        kind: 'selection',
        x: event.clientX + 8,
        y: event.clientY + 8,
      });
    };

    container.addEventListener('pointerdown', preserveSelection, { capture: true });
    container.addEventListener('click', openAnnotationMenu);
    container.addEventListener('contextmenu', openContextMenu, { capture: true });
    return () => {
      container.removeEventListener('pointerdown', preserveSelection, { capture: true });
      container.removeEventListener('click', openAnnotationMenu);
      container.removeEventListener('contextmenu', openContextMenu, { capture: true });
    };
  }, [container, documentId, registry, dispatch, documentStatus]);

  useEffect(() => {
    if (!menu) return;

    const close = () => setMenu(null);

    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, { capture: true, passive: true });
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, { capture: true });
    };
  }, [menu]);

  if (!menu || !registry || !documentId) return null;

  const selectionScope = registry.tryCapability(SelectionToken, documentId);
  const annotation = getAnnotationScope(registry, documentId)?.scope;

  const addTextMarkup = async (type: TextMarkupSubtype) => {
    if (!selectionScope || !annotation) return;

    const created = await createTextMarkupAnnotations(annotation, selectionScope, type);
    setMenu(null);
    return created;
  };

  const selectionItems = [
    { label: 'Copy', icon: Copy, action: () => {
      setMenu(null);
      if (selectionScope) void copySelectedText(selectionScope);
    } },
    { label: 'Highlight', icon: Highlighter, action: () => addTextMarkup('highlight') },
    { label: 'Comment', icon: MessageSquareMore, action: async () => {
      const highlights = await addTextMarkup('highlight');
      if (!highlights?.length) return;
      const page = container?.ownerDocument.elementFromPoint(menu.x - 8, menu.y - 8)
        ?.closest<HTMLElement>('[data-pdf-page-index]')?.dataset.pdfPageIndex;
      openComment(highlights.find((highlight) => String(registry.documents.getPageIndex(highlight.page, documentId)) === page) ?? highlights[0]);
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
          openLlm: () => dispatch({ type: 'ui/open-translation', documentId, anchor: menu, mode: 'translate' }),
          openExternal: platform.openExternal,
        });
        setMenu(null);
    } }] : []),
    ...(supportsLlm(platform) && isLlmEnabled(platform.getPreference) ? [{ label: 'LLM', icon: Send, action: () => {
      dispatch({ type: 'ui/open-translation', documentId, anchor: menu, mode: 'llm' });
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

  const openComment = async (target: Annotation) => {
    if (annotation) {
      let commentId = annotationKey(target.ref);
      if (target.subtype !== 'text') {
        const stage = registry.tryCapability(StageToken, documentId);
        const viewport = container?.querySelector<HTMLElement>('.viewer')?.getBoundingClientRect();
        let noteRect: Rect | undefined;
        if (stage && viewport) {
          const point = stage.viewportToPage(target.page, { x: menu.x - 8 - viewport.left, y: menu.y - viewport.top });
          if (point) noteRect = { x: Math.max(0, point.x), y: Math.max(0, point.y), width: 24, height: 24 };
        }
        commentId = await createCommentAnnotation(annotation, target, noteRect);
      }
      dispatch({ type: 'ui/open-comments', annotationId: commentId, pointerX: menu.x - 8 });
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
        dispatch({ type: 'ui/open-comments', annotationId: annotationKey(commentTarget.ref), pointerX: menu.x - 8 });
        setMenu(null);
      },
    }] : []),
    { label: commentTarget?.subtype === 'text' ? 'Edit comment' : 'Add nearby note', icon: MessageSquareMore, action: () => {
      if (commentTarget) openComment(commentTarget);
      setMenu(null);
    } },
    { label: 'Colors', icon: PaintBucket, action: () => {
      dispatch({ type: 'ui/open-panel', panel: 'colors' });
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
