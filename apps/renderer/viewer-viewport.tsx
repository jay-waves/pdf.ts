import { useLayoutEffect, type HTMLAttributes, type ReactNode } from 'react';
import {
  ViewportElementContext,
  useIsViewportGated,
  useViewportCapability,
  useViewportRef,
} from '@embedpdf/plugin-viewport/react';
import { ScrollArea } from 'radix-ui';
import type { PdfScroll } from './pdf-scroll';

export function ViewerViewport({
  children,
  documentId,
  scroll,
  className,
  style,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  documentId: string;
  scroll?: PdfScroll | null;
}) {
  const viewportRef = useViewportRef(documentId);
  const { provides: viewport } = useViewportCapability();
  const isGated = useIsViewportGated(documentId);
  const viewportGap = viewport?.getViewportGap() ?? 0;

  useLayoutEffect(() => {
    scroll?.attachViewport(viewportRef.current);
    return () => scroll?.attachViewport(null);
  }, [scroll, viewportRef]);

  return (
    <ViewportElementContext.Provider value={viewportRef}>
      <ScrollArea.Root className="pdf-viewer-scroll-area" type="always">
        <ScrollArea.Viewport
          {...props}
          ref={viewportRef}
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
