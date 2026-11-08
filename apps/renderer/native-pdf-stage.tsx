import { useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from 'react';
import type { PageRef } from '@embedpdf/core';
import { Stage, Scrollbar } from '@embedpdf/react/stage';
import { useCapability } from '@embedpdf/react/runtime';
import { StageToken } from '@embedpdf/plugin-stage/contract/host';
import type { ViewerStage } from '../viewer/viewer-stage';
import { StageSurface } from './stage-surface';
import { RenderLayer } from './viewer-render-layers';

export function NativePdfStage({ documentId, stage, panMode, renderPage, renderDpr, className, ...props }: HTMLAttributes<HTMLDivElement> & {
  documentId: string;
  stage?: ViewerStage | null;
  panMode: boolean;
  renderDpr?: number;
  renderPage(page: { pageIndex: number; pageRef: PageRef; width: number; height: number }): ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const native = useCapability(StageToken);
  useLayoutEffect(() => {
    const viewport = root.current?.querySelector<HTMLElement>('.viewer');
    if (!viewport) return;
    viewport.tabIndex = 0;
    stage?.attachSurface(viewport);
    return () => stage?.attachSurface(null);
  }, [stage]);
  useLayoutEffect(() => {
    if (renderDpr) native.setDevicePixelRatio(renderDpr);
  }, [native, renderDpr]);
  return <div {...props} ref={root} className="pdf-viewer-scroll-area">
    <Stage className={className ?? `viewer${panMode ? ' is-pan-mode' : ''}`} style={{ width: '100%', height: '100%' }}
      overlay={<>
        <StageSurface documentId={documentId} stage={stage} containerRef={root} />
        <Scrollbar axis="x" autoHide={false} className="pdf-viewer-scrollbar pdf-viewer-scrollbar-horizontal" thumbClassName="pdf-viewer-scrollbar-thumb" />
        <Scrollbar axis="y" autoHide={false} className="pdf-viewer-scrollbar pdf-viewer-scrollbar-vertical" thumbClassName="pdf-viewer-scrollbar-thumb" />
      </>}>
      {page => <div data-pdf-page-index={page.pageIndex} className="pdf-page-surface" style={{ position: 'relative', width: page.transform.contentWidth, height: page.transform.contentHeight }}>
        <RenderLayer />
        {renderPage({ pageIndex: page.pageIndex, pageRef: page.ref, width: page.transform.contentWidth, height: page.transform.contentHeight })}
      </div>}
    </Stage>
  </div>;
}
