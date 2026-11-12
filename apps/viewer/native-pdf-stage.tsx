import { EnergySavingMotion } from '../renderer/energy-motion';
/**
 * React bridge to the native camera surface and scrollbars. Native pointer input
 * owns selection, touch pan, pinch and momentum; StageSurface adds middle-button
 * pan, application wheel policy and control visibility. The viewport is not a DOM
 * scroll container: browser checks must use wheel, scrollbars or navigation controls,
 * not assignments to .viewer.scrollTop.
 */
import { useEffect, useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from 'react';
import type { PageRef } from '@embedpdf/core';
import { Stage, Scrollbar } from '@embedpdf/react/stage';
import { useCapability, useKernel } from '@embedpdf/react/runtime';
import { RenderToken } from '@embedpdf/plugin-render/contract/host';
import { installPagePrefetch } from '../renderer/page-prefetch';
import { StageToken } from '@embedpdf/plugin-stage/contract/host';
import type { ViewerStage } from './viewer-stage';
import { StageSurface } from './stage-surface';
import { RenderLayer } from './viewer-render-layers';

export function NativePdfStage({ stage, renderPage, renderDpr, className, ...props }: HTMLAttributes<HTMLDivElement> & {
  stage?: ViewerStage | null;
  renderDpr?: number;
  renderPage(page: { pageIndex: number; pageRef: PageRef; width: number; height: number }): ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const native = useCapability(StageToken);
  const render = useCapability(RenderToken);
  const kernel = useKernel();
  useEffect(() => installPagePrefetch(native, render, update => kernel.subscribe(update)), [native, render, kernel]);
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
  return <EnergySavingMotion stage={native} surfaceRef={root}><div {...props} ref={root} className="pdf-scroll-area">
    <Stage className={className} style={{ width: '100%', height: '100%' }}
      overlay={<>
        <StageSurface stage={stage} containerRef={root} />
        <Scrollbar axis="x" autoHide={false} style={{ height: 'var(--pdf-scrollbar-size)' }} className="pdf-scrollbar pdf-scrollbar-x" thumbClassName="pdf-scroll-thumb" />
        <Scrollbar axis="y" autoHide={false} style={{ width: 'var(--pdf-scrollbar-size)' }} className="pdf-scrollbar pdf-scrollbar-y" thumbClassName="pdf-scroll-thumb" />
      </>}>
      {page => {
        // Stage queries can include offscreen candidates; only their layout shells
        // belong here. Adjacent base warming is handled without mounting layers.
        const visible = page.getViewDemand?.()?.visibleRect;
        if (visible && (visible.width <= 0 || visible.height <= 0)) return null;
        return <div data-pdf-page-index={page.pageIndex} className="pdf-page" style={{ position: 'relative', width: page.transform.contentWidth, height: page.transform.contentHeight }}>
          <RenderLayer />
          {renderPage({ pageIndex: page.pageIndex, pageRef: page.ref, width: page.transform.contentWidth, height: page.transform.contentHeight })}
        </div>;
      }}
    </Stage>
  </div></EnergySavingMotion>;
}
