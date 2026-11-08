import { useEffect, useState } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import {
  restoreRect,
  transformRect,
  transformSize,
  type Rotation,
  PdfActionType,
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
  type PdfDocumentObject,
  type PdfEngine,
  type Rect,
} from '@embedpdf/models';
import type { RenderCapability } from '@embedpdf/plugin-render';
import type { RotateCapability } from '@embedpdf/plugin-rotate';
import type { SelectionCapability } from '@embedpdf/plugin-selection';
import {
  createCommentAnnotation,
  createTextMarkupAnnotations,
  getAnnotationRects,
  getAnnotationScope,
  isCaptureAnnotation,
  isTextMarkupAnnotation,
  rectsIntersect,
  type PdfCaptureAnnotation,
  type PdfTextMarkupAnnotation,
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
import { getPluginCapability, isEditableTarget, normalizePdfText } from '../shared/utils';
import { getExternalUrl, getSelectedExternalUrl } from '../shared/url';
import { platform } from '#platform';
import { supportsLlm } from '../platform/llm';
import { getDocument, getDocumentState } from '../document/viewer-document';
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

function getExternalLink(annotation: PdfAnnotationObject | undefined) {
  if (
    annotation?.type !== PdfAnnotationSubtype.LINK ||
    annotation.target?.type !== 'action' ||
    annotation.target.action.type !== PdfActionType.URI
  ) {
    return null;
  }

  return getExternalUrl(annotation.target.action.uri);
}

async function copyText(value: string) {
  value = normalizePdfText(value);
  if (!value) return;
  await navigator.clipboard.writeText(value);
}

function copySelectedText(selection: ReturnType<SelectionCapability['forDocument']>) {
  return selection.getSelectedText().toPromise()
    .then((parts) => copyText(parts.join('\n')))
    .catch((error) => console.error('[pdf-ts] failed to copy selected text', error));
}

function getPersistedTextSlice(annotation: PdfTextMarkupAnnotation) {
  const slice = annotation.custom?.pdfTs?.textSlice;
  return Number.isInteger(slice?.charIndex) && slice.charIndex >= 0 &&
    Number.isInteger(slice?.charCount) && slice.charCount > 0
    ? { pageIndex: annotation.pageIndex, charIndex: slice.charIndex, charCount: slice.charCount }
    : null;
}

async function getTextMarkupText(
  engine: PdfEngine<Blob>,
  document: PdfDocumentObject,
  annotation: PdfTextMarkupAnnotation,
) {
  const page = document.pages[annotation.pageIndex];
  if (!page) return '';

  const persistedSlice = getPersistedTextSlice(annotation);
  if (persistedSlice) {
    return (await engine.getTextSlices(document, [persistedSlice]).toPromise()).join('\n');
  }

  const annotationRects = getAnnotationRects(annotation);
  const geometry = await engine.getPageGeometry(document, page).toPromise();
  const characterIndexes = geometry.runs.flatMap((run) => run.glyphs.flatMap((glyph, index) => {
    const glyphRect: Rect = {
      origin: { x: glyph.x, y: glyph.y },
      size: { width: glyph.width, height: glyph.height },
    };
    return annotationRects.some((rect) => rectsIntersect(rect, glyphRect))
      ? [run.charStart + index]
      : [];
  }));
  const firstCharacter = characterIndexes[0];
  const lastCharacter = characterIndexes.at(-1);
  if (firstCharacter === undefined || lastCharacter === undefined) return '';

  return (await engine.getTextSlices(document, [{
    pageIndex: annotation.pageIndex,
    charIndex: firstCharacter,
    charCount: lastCharacter - firstCharacter + 1,
  }]).toPromise()).join('\n');
}

function getCaptureRect(
  annotation: PdfCaptureAnnotation,
  pageSize: { width: number; height: number },
) {
  const rects = getAnnotationRects(annotation);
  const left = Math.max(0, Math.min(...rects.map((rect) => rect.origin.x)) - CAPTURE_PADDING);
  const top = Math.max(0, Math.min(...rects.map((rect) => rect.origin.y)) - CAPTURE_PADDING);
  const right = Math.min(
    pageSize.width,
    Math.max(...rects.map((rect) => rect.origin.x + rect.size.width)) + CAPTURE_PADDING,
  );
  const bottom = Math.min(
    pageSize.height,
    Math.max(...rects.map((rect) => rect.origin.y + rect.size.height)) + CAPTURE_PADDING,
  );
  return {
    origin: { x: left, y: top },
    size: { width: right - left, height: bottom - top },
  };
}

async function copyAnnotationImage(
  registry: PluginRegistry,
  documentId: string,
  document: PdfDocumentObject,
  annotation: PdfCaptureAnnotation,
) {
  const render = getPluginCapability<RenderCapability>(registry, 'render');
  const page = document.pages[annotation.pageIndex];
  if (!render || !page) {
    throw new Error('Image clipboard is unavailable');
  }

  const rect = getCaptureRect(annotation, page.size);
  if (rect.size.width <= 0 || rect.size.height <= 0) {
    throw new Error('Annotation has no visible area');
  }

  const scaleFactor = Math.min(
    CAPTURE_SCALE,
    Math.sqrt(MAX_CAPTURE_PIXELS / (rect.size.width * rect.size.height)),
  );
  const rotation = getPluginCapability<RotateCapability>(registry, 'rotate')
    ?.forDocument(documentId).getRotation() ?? 0;
  const image = render.forDocument(documentId).renderPageRect({
    pageIndex: annotation.pageIndex,
    rect,
    options: {
      scaleFactor,
      dpr: 1,
      rotation: ((page.rotation ?? 0) + rotation) % 4,
      imageType: 'image/png',
      withAnnotations: false,
      withForms: true,
    },
  }).toPromise();

  await navigator.clipboard.write([new ClipboardItem({ 'image/png': image })]);
}

export function ContextMenu({
  engine,
  registry,
  documentId,
  container,
  dispatch,
}: {
  engine: PdfEngine<Blob>;
  registry?: PluginRegistry;
  documentId?: string | null;
  container: HTMLElement | null;
  dispatch: ViewerCommandDispatch;
}) {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [selectedText, setSelectedText] = useState('');
  useEffect(() => {
    setSelectedText('');
    if (menu?.kind !== 'selection' || !registry || !documentId) return;
    let active = true;
    const scope = getPluginCapability<SelectionCapability>(registry, 'selection')?.forDocument(documentId);
    void scope?.getSelectedText().toPromise().then((parts) => {
      if (active) setSelectedText(normalizePdfText(parts.join(' ')).trim());
    }).catch(() => {});
    return () => { active = false; };
  }, [menu, registry, documentId]);
  useEffect(() => {
    if (!registry || !documentId) return;
    const selection = getPluginCapability<SelectionCapability>(registry, 'selection')
      ?.forDocument(documentId);
    const annotation = getAnnotationScope(registry, documentId)?.scope;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey
        || event.composedPath().some(isEditableTarget)
        || isEditableTarget(window.document.activeElement)
        || window.document.querySelector('[role="dialog"], [role="alertdialog"]')) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
        if (window.getSelection()?.toString() || !selection
          || !Object.values(selection.getState().slices).some(({ count }) => count > 0)) return;
        event.preventDefault();
        event.stopPropagation();
        void copySelectedText(selection);
      } else if (!event.ctrlKey && !event.metaKey
        && (event.key === 'Delete' || event.key === 'Backspace')) {
        const selected = annotation?.getSelectedAnnotations()
          .filter(({ object }) => !annotation.isAnnotationStructurallyLocked(object));
        if (!selected?.length) return;
        event.preventDefault();
        event.stopPropagation();
        annotation?.deleteAnnotations(selected.map(({ object }) => ({
          pageIndex: object.pageIndex,
          id: object.id,
        })));
      } else {
        return;
      }
      setMenu(null);
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [documentId, registry]);

  useEffect(() => {
    if (!registry || !documentId || !container) return;
    const selection = getPluginCapability<SelectionCapability>(registry, 'selection')
      ?.forDocument(documentId);
    const annotation = getAnnotationScope(registry, documentId)?.scope;

    const isViewerEvent = (event: Event) => event.composedPath().some((target) => (
      target instanceof HTMLElement && target.classList.contains('viewer')
    ));

    const preserveSelection = (event: MouseEvent) => {
      if (event.button !== 2 || !isViewerEvent(event) || !selection
        || !Object.values(selection.getState().slices).some(({ count }) => count > 0)
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
        || !annotation?.getSelectedAnnotations().length) return;
      const selected = annotation.getSelectedAnnotations();
      if (selected.length === 1 && selected[0].object.type === PdfAnnotationSubtype.TEXT) {
        dispatch({ type: 'ui/open-comments', annotationId: selected[0].object.id, pointerX: event.clientX });
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
        && Object.values(selection.getState().slices).some(({ count }) => count > 0));
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
  }, [container, documentId, registry, dispatch]);

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

  const selection = getPluginCapability<SelectionCapability>(registry, 'selection');
  const selectionScope = selection?.forDocument(documentId);
  const annotation = getAnnotationScope(registry, documentId)?.scope;

  const addTextMarkup = (type: TextMarkupSubtype) => {
    if (!selectionScope || !annotation) return;

    const created = createTextMarkupAnnotations(annotation, selectionScope, type);
    setMenu(null);
    return created;
  };

  const selectionItems = [
    { label: 'Copy', icon: Copy, action: () => {
      setMenu(null);
      if (selectionScope) void copySelectedText(selectionScope);
    } },
    { label: 'Highlight', icon: Highlighter, action: () => addTextMarkup(PdfAnnotationSubtype.HIGHLIGHT) },
    { label: 'Comment', icon: MessageSquareMore, action: () => {
      const highlights = addTextMarkup(PdfAnnotationSubtype.HIGHLIGHT);
      if (!highlights?.length) return;
      const page = container?.ownerDocument.elementFromPoint(menu.x - 8, menu.y - 8)
        ?.closest<HTMLElement>('[data-pdf-page-index]')?.dataset.pdfPageIndex;
      openComment(highlights.find((highlight) => String(highlight.pageIndex) === page) ?? highlights[0]);
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
      const selectedText = selectionScope?.getSelectedText();
      setMenu(null);
      selectedText?.toPromise()
        .then((parts) => normalizePdfText(parts.join(' ')).replace(/\s+/g, ' ').trim())
        .then((query) => {
          if (!query) return;
          platform.openExternal(
            getSelectedExternalUrl(query) ?? `https://www.google.com/search?q=${encodeURIComponent(query)}`,
          );
        })
        .catch((error) => console.error('[pdf-ts] failed to search selected text', error));
    } },
  ];

  const selectedAnnotations = annotation?.getSelectedAnnotations() ?? [];
  const selectedLink = selectedAnnotations.length === 1
    ? getExternalLink(selectedAnnotations[0].object)
    : null;
  const commentTarget = selectedAnnotations[0]?.object;
  const selectedTextMarkup = selectedAnnotations.length === 1 && isTextMarkupAnnotation(commentTarget)
    ? commentTarget
    : null;
  const selectedCaptureAnnotation = selectedAnnotations.length === 1 && isCaptureAnnotation(commentTarget)
    ? commentTarget
    : null;
  const document = getDocument(registry, documentId);

  const openComment = (target: PdfAnnotationObject) => {
    if (annotation) {
      let commentId = target.id;
      if (target.type !== PdfAnnotationSubtype.TEXT) {
        const state = getDocumentState(registry, documentId);
        const page = document?.pages[target.pageIndex];
        const surface = container?.querySelector<HTMLElement>(`[data-pdf-page-index="${target.pageIndex}"]`);
        let noteRect: Rect | undefined;
        if (state && page && surface) {
          const rotation = ((page.rotation + state.rotation) % 4) as Rotation;
          const bounds = surface.getBoundingClientRect();
          const displaySize = transformSize(page.size, rotation, state.scale);
          const highlight = transformRect(page.size, target.rect, rotation, state.scale);
          const size = Math.min(24 * state.scale, displaySize.width, displaySize.height);
          const gap = 4 * state.scale;
          const bottom = highlight.origin.y + highlight.size.height + gap;
          const top = highlight.origin.y - size - gap;
          const x = Math.max(0, Math.min(displaySize.width - size, menu.x - 8 - bounds.left));
          // Prefer below the markup; use the space above if below is offscreen.
          const fitsBelow = bottom + size <= Math.min(displaySize.height, window.innerHeight - bounds.top);
          const y = Math.max(0, Math.min(displaySize.height - size, fitsBelow || top < 0 ? bottom : top));
          noteRect = restoreRect(displaySize, {
            origin: { x, y }, size: { width: size, height: size },
          }, rotation, state.scale);
        }
        commentId = createCommentAnnotation(annotation, target, noteRect);
      }
      dispatch({ type: 'ui/open-comments', annotationId: commentId, pointerX: menu.x - 8 });
    }
    setMenu(null);
  };
  const annotationItems = [
    ...(selectedTextMarkup ? [{ label: 'Copy', icon: Copy, action: () => {
      setMenu(null);
      if (!document) return;
      getTextMarkupText(engine, document, selectedTextMarkup)
        .then(copyText)
        .catch((error) => console.error('[pdf-ts] failed to copy text markup', error));
    } }] : []),
    ...(selectedCaptureAnnotation ? [{ label: 'Copy image', icon: ImageIcon, action: () => {
      setMenu(null);
      if (!document) return;
      copyAnnotationImage(registry, documentId, document, selectedCaptureAnnotation)
        .catch((error) => console.error('[pdf-ts] failed to copy annotation image', error));
    } }] : []),
    ...(selectedLink ? [{ label: 'Open link', icon: Link, action: () => {
      platform.openExternal(selectedLink);
      setMenu(null);
    } }] : []),
    ...(commentTarget?.type !== PdfAnnotationSubtype.TEXT && commentTarget?.contents?.trim() ? [{
      label: 'Edit existing comment', icon: MessageSquareMore, action: () => {
        dispatch({ type: 'ui/open-comments', annotationId: commentTarget.id, pointerX: menu.x - 8 });
        setMenu(null);
      },
    }] : []),
    { label: commentTarget?.type === PdfAnnotationSubtype.TEXT ? 'Edit comment' : 'Add nearby note', icon: MessageSquareMore, action: () => {
      if (commentTarget) openComment(commentTarget);
      setMenu(null);
    } },
    { label: 'Colors', icon: PaintBucket, action: () => {
      dispatch({ type: 'ui/open-panel', panel: 'colors' });
      setMenu(null);
    } },
    { label: 'Delete', icon: Trash2, action: () => {
      annotation?.deleteAnnotations(selectedAnnotations.map(({ object }) => ({
        pageIndex: object.pageIndex,
        id: object.id,
      })));
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
