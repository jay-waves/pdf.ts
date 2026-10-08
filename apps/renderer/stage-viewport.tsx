import { useLayoutEffect, type HTMLAttributes, type ReactNode } from 'react';
import { useDocumentState } from '@embedpdf/core/react';
import {
  ViewportElementContext,
  useIsViewportGated,
  useViewportCapability,
  useViewportPlugin,
  useViewportRef,
} from '@embedpdf/plugin-viewport/react';
import { ScrollArea } from 'radix-ui';
import { useZoomCapability } from '@embedpdf/plugin-zoom/react';
import { measureViewport } from './viewport-geometry';
import type { ViewerStage } from '../viewer/viewer-stage';

/** The DOM viewport attached to a ViewerStage. */
export function StageViewport({
  children,
  documentId,
  stage,
  className,
  style,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  documentId: string;
  stage?: ViewerStage | null;
}) {
  const viewportRef = useViewportRef(documentId);
  const { provides: viewport } = useViewportCapability();
  const { plugin: viewportPlugin } = useViewportPlugin();
  const { provides: zoom } = useZoomCapability();
  const documentState = useDocumentState(documentId);
  const isGated = useIsViewportGated(documentId);
  const viewportGap = viewport?.getViewportGap() ?? 0;

  useLayoutEffect(() => {
    stage?.attachSurface(viewportRef.current);
    return () => stage?.attachSurface(null);
  }, [stage, viewportRef]);

  useLayoutEffect(() => {
    const container = viewportRef.current;
    if (!container || !viewportPlugin || documentState?.status !== 'loaded') return;
    const measure = () => {
      const metrics = measureViewport(container);
      viewportPlugin.setViewportResizeMetrics(documentId, metrics);
      // Resize events are deduplicated across document lifetimes. A replacement
      // at the same size still needs its initial zoom gate released. Numeric
      // zoom also needs this: the plugin's automatic resize handler skips it.
      if (metrics.clientWidth > 0 && metrics.clientHeight > 0
        && viewport?.hasGate('zoom', documentId) && zoom) {
        const scope = zoom.forDocument(documentId);
        scope.requestZoom(scope.getState().zoomLevel);
      }
    };
    // Initialize the new document from the mounted viewport before paint.
    // Subsequent size changes are handled by useViewportRef's ResizeObserver.
    measure();
  }, [documentId, documentState?.document, documentState?.status, viewportPlugin, viewportRef, viewport, zoom]);

  return (
    <ViewportElementContext.Provider value={viewportRef}>
      <ScrollArea.Root className="pdf-viewer-scroll-area" type="always">
        <ScrollArea.Viewport
          {...props}
          ref={viewportRef}
          tabIndex={0}
          className={className}
          style={{
            ...style,
            padding: `${viewportGap}px`,
          }}
        >
          {!isGated ? children : null}
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar
          className="pdf-viewer-scrollbar pdf-viewer-scrollbar-horizontal"
          orientation="horizontal"
        >
          <ScrollArea.Thumb className="pdf-viewer-scrollbar-thumb" />
        </ScrollArea.Scrollbar>
        <ScrollArea.Scrollbar
          className="pdf-viewer-scrollbar pdf-viewer-scrollbar-vertical"
          orientation="vertical"
        >
          <ScrollArea.Thumb className="pdf-viewer-scrollbar-thumb" />
        </ScrollArea.Scrollbar>
      </ScrollArea.Root>
    </ViewportElementContext.Provider>
  );
}
