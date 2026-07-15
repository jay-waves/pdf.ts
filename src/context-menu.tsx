import { useEffect, useState } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import { PdfActionType, PdfAnnotationSubtype, type PdfAnnotationObject, type Rect } from '@embedpdf/models';
import type { AnnotationCapability } from '@embedpdf/plugin-annotation';
import { SelectionPlugin, type SelectionCapability } from '@embedpdf/plugin-selection';
import type { ScrollCapability } from '@embedpdf/plugin-scroll';
import type { ViewportCapability } from '@embedpdf/plugin-viewport';
import {
  Copy,
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
import { getActiveDocumentId } from './utils';

type ContextMenuState = {
  kind: 'selection' | 'annotation';
  x: number;
  y: number;
};

function getExternalLink(annotation: PdfAnnotationObject | undefined) {
  if (
    annotation?.type !== PdfAnnotationSubtype.LINK ||
    annotation.target?.type !== 'action' ||
    annotation.target.action.type !== PdfActionType.URI
  ) {
    return null;
  }

  try {
    const url = new URL(annotation.target.action.uri);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function getMenuAnchor(
  registry: PluginRegistry,
  container: HTMLElement,
  documentId: string,
  pageIndex: number,
  rect: Rect,
) {
  const scroll = registry.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;
  const viewport = registry.getPlugin('viewport')?.provides?.() as ViewportCapability | undefined;
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
  onOpenComments(annotationId: string): void;
  onOpenColorPalette(): void;
  onTranslate(documentId: string, anchor: { x: number; y: number }): void;
}) {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  useEffect(() => {
    if (!registry || !container) return;
    const documentId = getActiveDocumentId(registry);
    const selectionPlugin = registry.getPlugin('selection') as SelectionPlugin | undefined;
    const annotation = canEdit
      ? registry.getPlugin('annotation')?.provides?.() as AnnotationCapability | undefined
      : undefined;
    if (!documentId) return;
    let annotationMenuFrame = 0;

    const preventContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };

    const openAnnotationMenu = (event: PointerEvent) => {
      if (!annotation || event.button !== 0) return;
      const anchor = { x: event.clientX + 12, y: event.clientY + 12 };
      if (annotationMenuFrame) cancelAnimationFrame(annotationMenuFrame);
      annotationMenuFrame = requestAnimationFrame(() => {
        annotationMenuFrame = 0;
        const selected = annotation?.forDocument(documentId).getSelectedAnnotations() ?? [];
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

  const selection = registry.getPlugin('selection')?.provides?.() as SelectionCapability | undefined;
  const annotation = canEdit
    ? registry.getPlugin('annotation')?.provides?.() as AnnotationCapability | undefined
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
  ];

  const selectedAnnotations = annotation?.forDocument(documentId).getSelectedAnnotations() ?? [];
  const selectedLink = selectedAnnotations.length === 1
    ? getExternalLink(selectedAnnotations[0]?.object)
    : null;
  const annotationItems = [
    ...(selectedLink ? [{ label: 'Open link', icon: Link, action: () => {
      window.open(selectedLink, '_blank', 'noopener,noreferrer');
      setMenu(null);
    } }] : []),
    { label: 'Add comment', icon: MessageSquareMore, action: () => {
      const annotationId = selectedAnnotations[0]?.object.id;
      if (annotationId) onOpenComments(annotationId);
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
