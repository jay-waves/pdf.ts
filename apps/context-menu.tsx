import { useEffect, useState } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import { PdfActionType, PdfAnnotationSubtype, type PdfAnnotationObject, type Rect } from '@embedpdf/models';
import type { AnnotationCapability } from '@embedpdf/plugin-annotation';
import { SelectionPlugin, type SelectionCapability } from '@embedpdf/plugin-selection';
import type { ScrollCapability } from '@embedpdf/plugin-scroll';
import type { ViewportCapability } from '@embedpdf/plugin-viewport';
import {
  Copy,
  ExternalLink,
  Highlighter,
  Languages,
  Link,
  MessageSquareMore,
  PaintBucket,
  Strikethrough,
  Trash2,
  Underline,
} from 'lucide-react';
import { FloatingPopover, IconButton } from './components';
import { createCommentAnnotation } from './comment-annotation';
import { getActiveDocumentId, getPluginCapability } from './utils';
import { platform } from '#platform';

type ContextMenuState = {
  kind: 'selection' | 'annotation';
  x: number;
  y: number;
};

function parseExternalUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function getSelectedExternalUrl(text: string) {
  const value = text.trim();
  if (!value || /\s|@/.test(value)) return null;
  if (/^https?:\/\//i.test(value)) return parseExternalUrl(value);
  if (/^(?:www\.)?(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i.test(value)) {
    return parseExternalUrl(`https://${value}`);
  }
  return null;
}

function getExternalLink(annotation: PdfAnnotationObject | undefined) {
  if (
    annotation?.type !== PdfAnnotationSubtype.LINK ||
    annotation.target?.type !== 'action' ||
    annotation.target.action.type !== PdfActionType.URI
  ) {
    return null;
  }

  return parseExternalUrl(annotation.target.action.uri);
}

function getMenuAnchor(
  registry: PluginRegistry,
  container: HTMLElement,
  documentId: string,
  pageIndex: number,
  rect: Rect,
) {
  const scroll = getPluginCapability<ScrollCapability>(registry, 'scroll');
  const viewport = getPluginCapability<ViewportCapability>(registry, 'viewport');
  const positionedRect = scroll?.forDocument(documentId).getRectPositionForPage(pageIndex, rect);
  const scrollerElement = container.querySelector<HTMLElement>('.pdf-scroller');
  if (!positionedRect || !viewport || !scrollerElement) return null;

  // The scroll plugin returns coordinates relative to the PDF content. Use the
  // actual centered scroller as the viewport-space origin so wide VS Code
  // webviews do not introduce an unaccounted horizontal offset.
  const scrollerRect = scrollerElement.getBoundingClientRect();
  const viewportGap = viewport.getViewportGap();

  return {
    x: scrollerRect.left + positionedRect.origin.x + viewportGap + positionedRect.size.width * 0.65,
    y: scrollerRect.top + positionedRect.origin.y + viewportGap + positionedRect.size.height + 8,
  };
}

export function ContextMenu({
  registry,
  container,
  canEdit,
  canTranslate,
  onOpenComments,
  onOpenColorPalette,
  onTranslate,
}: {
  registry?: PluginRegistry;
  container: HTMLElement | null;
  canEdit: boolean;
  canTranslate: boolean;
  onOpenComments(annotationId: string, isNew: boolean): void;
  onOpenColorPalette(): void;
  onTranslate(documentId: string, anchor: { x: number; y: number }): void;
}) {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  useEffect(() => {
    if (!registry || !container) return;
    const documentId = getActiveDocumentId(registry);
    const selectionPlugin = registry.getPlugin('selection') as SelectionPlugin | undefined;
    const annotation = canEdit
      ? getPluginCapability<AnnotationCapability>(registry, 'annotation')
      : undefined;
    if (!documentId) return;
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
        const selected = annotation.forDocument(documentId).getSelectedAnnotations();
        if (!selected[0]) return;
        setMenu({ kind: 'annotation', ...anchor });
      });
    };

    const unsubscribePlacement = selectionPlugin?.onMenuPlacement(documentId, (placement) => {
      if (!placement?.isVisible) {
        setMenu((current) => current?.kind === 'selection' ? null : current);
        return;
      }
      const anchor = getMenuAnchor(registry, container, documentId, placement.pageIndex, placement.rect);
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
  }, [canEdit, container, registry]);

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

  if (!menu || !registry) return null;

  const documentId = getActiveDocumentId(registry);
  if (!documentId) return null;

  const selection = getPluginCapability<SelectionCapability>(registry, 'selection');
  const annotation = canEdit
    ? getPluginCapability<AnnotationCapability>(registry, 'annotation')
    : undefined;

  const addTextMarkup = (
    type: PdfAnnotationSubtype.HIGHLIGHT | PdfAnnotationSubtype.UNDERLINE | PdfAnnotationSubtype.STRIKEOUT,
  ) => {
    const selectionScope = selection?.forDocument(documentId);
    const annotationScope = annotation?.forDocument(documentId);
    if (!selectionScope || !annotationScope) return;

    const strokeColor = type === PdfAnnotationSubtype.HIGHLIGHT ? '#facc15' : '#ef4444';
    for (const formatted of selectionScope.getFormattedSelection()) {
      annotationScope.createAnnotation(formatted.pageIndex, {
        id: crypto.randomUUID(),
        type,
        pageIndex: formatted.pageIndex,
        rect: formatted.rect,
        segmentRects: formatted.segmentRects,
        strokeColor,
        opacity: 1,
      });
    }
    selectionScope.clear();
    setMenu(null);
  };

  const selectionItems = [
    { label: 'Copy', icon: Copy, action: () => { selection?.forDocument(documentId).copyToClipboard(); setMenu(null); } },
    ...(canEdit ? [
      { label: 'Highlight', icon: Highlighter, action: () => addTextMarkup(PdfAnnotationSubtype.HIGHLIGHT) },
      { label: 'Underline', icon: Underline, action: () => addTextMarkup(PdfAnnotationSubtype.UNDERLINE) },
      { label: 'Strikeout', icon: Strikethrough, action: () => addTextMarkup(PdfAnnotationSubtype.STRIKEOUT) },
    ] : []),
    ...(canTranslate ? [
      { label: 'Translate', icon: Languages, action: () => { onTranslate(documentId, menu); setMenu(null); } },
    ] : []),
    { label: 'Search', icon: ExternalLink, action: () => {
      const selectedText = selection?.forDocument(documentId).getSelectedText();
      setMenu(null);
      selectedText?.toPromise()
        .then((parts) => parts.join(' ').replace(/\s+/g, ' ').trim())
        .then((query) => {
          if (!query) return;
          platform.openExternal(
            getSelectedExternalUrl(query) ?? `https://www.google.com/search?q=${encodeURIComponent(query)}`,
          );
        })
        .catch((error) => console.error('[pdf-ts] failed to search selected text', error));
    } },
  ];

  const selectedAnnotations = annotation?.forDocument(documentId).getSelectedAnnotations() ?? [];
  const selectedLink = selectedAnnotations.length === 1
    ? getExternalLink(selectedAnnotations[0].object)
    : null;
  const commentTarget = selectedAnnotations[0]?.object;
  const annotationItems = [
    ...(selectedLink ? [{ label: 'Open link', icon: Link, action: () => {
      platform.openExternal(selectedLink);
      setMenu(null);
    } }] : []),
    { label: commentTarget?.type === PdfAnnotationSubtype.TEXT ? 'Open comment' : 'Add comment', icon: MessageSquareMore, action: () => {
      if (annotation && commentTarget) {
        const isNew = commentTarget.type !== PdfAnnotationSubtype.TEXT;
        const commentId = isNew
          ? createCommentAnnotation(annotation, documentId, commentTarget)
          : commentTarget.id;
        onOpenComments(commentId, isNew);
      }
      setMenu(null);
    } },
    { label: 'Colors', icon: PaintBucket, action: () => { onOpenColorPalette(); setMenu(null); } },
    { label: 'Delete', icon: Trash2, action: () => {
      annotation?.forDocument(documentId).deleteAnnotations(selectedAnnotations.map(({ object }) => ({
        pageIndex: object.pageIndex,
        id: object.id,
      })));
      setMenu(null);
    } },
  ];

  const items = menu.kind === 'selection' ? selectionItems : canEdit ? annotationItems : [];
  if (!items.length) return null;
  return (
    <FloatingPopover
      onClose={() => setMenu(null)}
      anchor={menu}
      className="shnctl-context-menu"
      role="toolbar"
      label={menu.kind === 'selection' ? 'Text selection actions' : 'Annotation actions'}
      align={menu.kind === 'selection' ? 'center' : 'start'}
    >
      {items.map(({ label, icon, action }) => (
        <IconButton
          key={label}
          className="shnctl-context-menu-button"
          label={label}
          icon={icon}
          iconSize={13}
          onClick={action}
        />
      ))}
    </FloatingPopover>
  );
}
