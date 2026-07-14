import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import { requestSelectionTranslation } from './selection-translate';
import { ShnctlIconButton } from './tool-button';
import { getActiveDocumentId } from './utils';

type ContextMenuState = {
  kind: 'selection' | 'annotation';
  x: number;
  y: number;
};

type ContextMenuTooltip = {
  label: string;
  left: number;
  top: number;
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
  if (!positionedRect || !viewport) return null;

  const viewportScope = viewport.forDocument(documentId);
  const viewportElement = container.querySelector<HTMLElement>('.viewer');
  const viewportRect = (viewportElement ?? container).getBoundingClientRect();
  const metrics = viewportScope.getMetrics();
  const viewportGap = viewport.getViewportGap();

  return {
    x: viewportRect.left + metrics.clientLeft + positionedRect.origin.x + viewportGap - metrics.scrollLeft + positionedRect.size.width + 8,
    y: viewportRect.top + metrics.clientTop + positionedRect.origin.y + viewportGap - metrics.scrollTop + positionedRect.size.height + 8,
  };
}

export function ShnctlContextMenu({
  registry,
  container,
  onOpenComments,
  onOpenColorPalette,
}: {
  registry?: PluginRegistry;
  container: HTMLElement | null;
  onOpenComments(annotationId: string): void;
  onOpenColorPalette(): void;
}) {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [tooltip, setTooltip] = useState<ContextMenuTooltip | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const tooltipTimerRef = useRef<number | undefined>(undefined);

  const hideTooltip = () => {
    if (tooltipTimerRef.current !== undefined) {
      window.clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = undefined;
    }
    setTooltip(null);
  };

  const scheduleTooltip = (target: EventTarget | null) => {
    const element = target instanceof Element
      ? target.closest<HTMLElement>('.shnctl-context-menu-button[data-shnctl-tooltip]')
      : null;
    const label = element?.dataset.shnctlTooltip;

    hideTooltip();
    if (!element || !label) return;

    tooltipTimerRef.current = window.setTimeout(() => {
      const rect = element.getBoundingClientRect();
      setTooltip({
        label,
        left: rect.left + rect.width / 2,
        top: rect.bottom + 12,
      });
    }, 520);
  };

  useEffect(() => {
    if (!registry || !container) return;
    const documentId = getActiveDocumentId(registry);
    const selectionPlugin = registry.getPlugin('selection') as SelectionPlugin | undefined;
    const annotation = registry.getPlugin('annotation')?.provides?.() as AnnotationCapability | undefined;
    if (!documentId) return;

    const preventContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };

    const openAnnotationMenu = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const anchor = { x: event.clientX + 12, y: event.clientY + 12 };
      requestAnimationFrame(() => {
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
      unsubscribePlacement?.();
      container.removeEventListener('contextmenu', preventContextMenu, { capture: true });
      container.removeEventListener('pointerup', openAnnotationMenu, { capture: true });
    };
  }, [container, registry]);

  useEffect(() => {
    if (!menu) return;

    const closeOnPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    const closeOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };
    const close = () => {
      hideTooltip();
      setMenu(null);
    };

    window.addEventListener('pointerdown', closeOnPointerDown, { capture: true });
    window.addEventListener('keydown', closeOnKeyDown, { capture: true });
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', closeOnPointerDown, { capture: true });
      window.removeEventListener('keydown', closeOnKeyDown, { capture: true });
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, { capture: true });
    };
  }, [menu]);

  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!menu || !element) return;

    const gap = 8;
    const rect = element.getBoundingClientRect();
    const x = Math.min(Math.max(gap, menu.x), Math.max(gap, window.innerWidth - rect.width - gap));
    const y = Math.min(Math.max(gap, menu.y), Math.max(gap, window.innerHeight - rect.height - gap));
    if (x !== menu.x || y !== menu.y) {
      setMenu({ ...menu, x, y });
    }
  }, [menu]);

  useEffect(() => () => {
    if (tooltipTimerRef.current !== undefined) {
      window.clearTimeout(tooltipTimerRef.current);
    }
  }, []);

  if (!menu || !registry) return null;

  const documentId = getActiveDocumentId(registry);
  if (!documentId) return null;

  const selection = registry.getPlugin('selection')?.provides?.() as SelectionCapability | undefined;
  const annotation = registry.getPlugin('annotation')?.provides?.() as AnnotationCapability | undefined;

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
    { label: 'Highlight', icon: Highlighter, action: () => addTextMarkup(PdfAnnotationSubtype.HIGHLIGHT) },
    { label: 'Underline', icon: Underline, action: () => addTextMarkup(PdfAnnotationSubtype.UNDERLINE) },
    { label: 'Strikeout', icon: Strikethrough, action: () => addTextMarkup(PdfAnnotationSubtype.STRIKEOUT) },
    { label: 'Translate', icon: Languages, action: () => { requestSelectionTranslation(documentId); setMenu(null); } },
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

  const items = menu.kind === 'selection' ? selectionItems : annotationItems;
  return (
    <div
      ref={menuRef}
      className="shnctl-context-menu"
      role="menu"
      aria-label={menu.kind === 'selection' ? 'Text selection actions' : 'Annotation actions'}
      style={{ left: menu.x, top: menu.y }}
      onPointerOver={(event) => scheduleTooltip(event.target)}
      onPointerOut={(event) => {
        const next = event.relatedTarget instanceof Element
          ? event.relatedTarget.closest('.shnctl-context-menu-button')
          : null;
        const current = event.target instanceof Element
          ? event.target.closest('.shnctl-context-menu-button')
          : null;
        if (next !== current) hideTooltip();
      }}
      onFocus={(event) => scheduleTooltip(event.target)}
      onBlur={hideTooltip}
    >
      {items.map(({ label, icon, action }) => (
        <ShnctlIconButton
          key={label}
          className="shnctl-context-menu-button"
          label={label}
          icon={icon}
          iconSize={13}
          tooltip="data"
          onClick={() => {
            hideTooltip();
            action();
          }}
        />
      ))}
      {tooltip ? (
        <div
          className="shnctl-toolbar-floating-tooltip shnctl-context-menu-tooltip"
          style={{ left: tooltip.left, top: tooltip.top }}
          role="tooltip"
        >
          {tooltip.label}
        </div>
      ) : null}
    </div>
  );
}
