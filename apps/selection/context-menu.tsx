import { useEffect, useState } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import {
  PdfActionType,
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
  type PdfDocumentObject,
  type PdfEngine,
  type Rect,
} from '@embedpdf/models';
import type { RenderCapability } from '@embedpdf/plugin-render';
import type { RotateCapability } from '@embedpdf/plugin-rotate';
import { SelectionPlugin, type SelectionCapability } from '@embedpdf/plugin-selection';
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
  Strikethrough,
  Trash2,
  Underline,
} from 'lucide-react';
import { FloatingPopover, IconButton } from '../components';
import { getPluginCapability, normalizePdfText } from '../shared/utils';
import { getExternalUrl, getSelectedExternalUrl } from '../shared/url';
import { platform } from '#platform';
import { getDocument } from '../document/viewer-document';
import type { PdfScroll } from '../renderer/pdf-scroll';
import type { ViewerCommandDispatch } from '../viewer/viewer-controller';

type ContextMenuState = {
  kind: 'selection' | 'annotation';
  x: number;
  y: number;
};

const CAPTURE_PADDING = 3;
const CAPTURE_SCALE = 4;
const MAX_CAPTURE_PIXELS = 16_000_000;

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
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    // The legacy path also works in webviews where the async clipboard API is unavailable.
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Clipboard copy was rejected');
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

function copyAnnotationImage(
  registry: PluginRegistry,
  documentId: string,
  document: PdfDocumentObject,
  annotation: PdfCaptureAnnotation,
) {
  const render = getPluginCapability<RenderCapability>(registry, 'render');
  const page = document.pages[annotation.pageIndex];
  if (!render || !page || !navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    return Promise.reject(new Error('Image clipboard is unavailable'));
  }

  const rect = getCaptureRect(annotation, page.size);
  if (rect.size.width <= 0 || rect.size.height <= 0) {
    return Promise.reject(new Error('Annotation has no visible area'));
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

  return navigator.clipboard.write([new ClipboardItem({ 'image/png': image })]);
}

function getMenuAnchor(
  scroll: PdfScroll,
  container: HTMLElement,
  pageIndex: number,
  rect: Rect,
) {
  const positionedRect = scroll.getRectPosition(pageIndex, rect);
  const scrollerElement = container.querySelector<HTMLElement>('.pdf-scroller');
  if (!positionedRect || !scrollerElement) return null;

  // The scroll plugin returns coordinates relative to the PDF content. Use the
  // actual centered scroller as the viewport-space origin so wide VS Code
  // webviews do not introduce an unaccounted horizontal offset.
  const scrollerRect = scrollerElement.getBoundingClientRect();
  const viewportGap = scroll.getViewportGap();

  return {
    x: scrollerRect.left + positionedRect.origin.x + viewportGap + positionedRect.size.width * 0.65,
    y: scrollerRect.top + positionedRect.origin.y + viewportGap + positionedRect.size.height + 8,
  };
}

export function ContextMenu({
  engine,
  registry,
  documentId,
  scroll,
  container,
  dispatch,
}: {
  engine: PdfEngine<Blob>;
  registry?: PluginRegistry;
  documentId?: string | null;
  scroll?: PdfScroll | null;
  container: HTMLElement | null;
  dispatch: ViewerCommandDispatch;
}) {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  useEffect(() => {
    if (!registry || !documentId || !scroll || !container) return;
    const selectionPlugin = registry.getPlugin('selection') as SelectionPlugin | undefined;
    const annotation = getAnnotationScope(registry, documentId)?.scope;
    let annotationMenuFrame = 0;

    const isViewerEvent = (event: Event) => event.composedPath().some((target) => (
      target instanceof HTMLElement && target.classList.contains('viewer')
    ));

    const preventContextMenu = (event: MouseEvent) => {
      if (!isViewerEvent(event)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const openAnnotationMenu = (event: PointerEvent) => {
      if (!annotation || event.button !== 0 || !isViewerEvent(event)) return;
      const anchor = { x: event.clientX + 12, y: event.clientY + 12 };
      if (annotationMenuFrame) cancelAnimationFrame(annotationMenuFrame);
      annotationMenuFrame = requestAnimationFrame(() => {
        annotationMenuFrame = 0;
        const selected = annotation.getSelectedAnnotations();
        if (!selected[0]) return;
        setMenu({ kind: 'annotation', ...anchor });
      });
    };

    const unsubscribePlacement = selectionPlugin?.onMenuPlacement(documentId, (placement) => {
      if (!placement?.isVisible) {
        setMenu((current) => current?.kind === 'selection' ? null : current);
        return;
      }
      const anchor = getMenuAnchor(scroll, container, placement.pageIndex, placement.rect);
      if (anchor) setMenu({ kind: 'selection', ...anchor });
    });

    container.addEventListener('contextmenu', preventContextMenu, { capture: true });
    container.addEventListener('pointerup', openAnnotationMenu, { capture: true });
    return () => {
      if (annotationMenuFrame) cancelAnimationFrame(annotationMenuFrame);
      unsubscribePlacement?.();
      container.removeEventListener('contextmenu', preventContextMenu, { capture: true });
      container.removeEventListener('pointerup', openAnnotationMenu, { capture: true });
    };
  }, [container, documentId, registry, scroll]);

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

    createTextMarkupAnnotations(annotation, selectionScope, type);
    setMenu(null);
  };

  const selectionItems = [
    { label: 'Copy', icon: Copy, action: () => {
      const selectedText = selectionScope?.getSelectedText();
      setMenu(null);
      selectedText?.toPromise()
        .then((parts) => copyText(parts.join('\n')))
        .catch((error) => console.error('[pdf-ts] failed to copy selected text', error));
    } },
    { label: 'Highlight', icon: Highlighter, action: () => addTextMarkup(PdfAnnotationSubtype.HIGHLIGHT) },
    { label: 'Underline', icon: Underline, action: () => addTextMarkup(PdfAnnotationSubtype.UNDERLINE) },
    { label: 'Strikeout', icon: Strikethrough, action: () => addTextMarkup(PdfAnnotationSubtype.STRIKEOUT) },
    { label: 'Translate', icon: Languages, action: () => {
      dispatch({
        type: 'ui/open-translation',
        documentId,
        anchor: menu,
      });
      setMenu(null);
    } },
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
    { label: commentTarget?.type === PdfAnnotationSubtype.TEXT ? 'Open comment' : 'Add comment', icon: MessageSquareMore, action: () => {
      if (annotation && commentTarget) {
        const isNew = commentTarget.type !== PdfAnnotationSubtype.TEXT;
        const commentId = isNew
          ? createCommentAnnotation(annotation, commentTarget)
          : commentTarget.id;
        dispatch({ type: 'ui/open-comments', annotationId: commentId, isNew });
      }
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
      className="relative z-[2147483646] flex items-center gap-px rounded border border-border bg-elevated p-0.5 text-foreground shadow-float"
      role="toolbar"
      label={menu.kind === 'selection' ? 'Text selection actions' : 'Annotation actions'}
      align={menu.kind === 'selection' ? 'center' : 'start'}
    >
      {items.map(({ label, icon, action }) => (
        <IconButton
          key={label}
          className="size-6 rounded active:bg-selected active:shadow-none"
          label={label}
          icon={icon}
          iconSize={13}
          onClick={action}
        />
      ))}
    </FloatingPopover>
  );
}
