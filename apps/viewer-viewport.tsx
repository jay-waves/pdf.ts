import { useEffect, useState, type HTMLAttributes, type ReactNode } from 'react';
import {
  ViewportElementContext,
  useIsViewportGated,
  useViewportCapability,
  useViewportRef,
} from '@embedpdf/plugin-viewport/react';
import { ScrollArea } from 'radix-ui';

export function ViewerViewport({
  children,
  documentId,
  className,
  style,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  documentId: string;
}) {
  const [viewportGap, setViewportGap] = useState(0);
  const viewportRef = useViewportRef(documentId);
  const { provides: viewport } = useViewportCapability();
  const isGated = useIsViewportGated(documentId);

  useEffect(() => {
    if (viewport) setViewportGap(viewport.getViewportGap());
  }, [viewport]);

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
