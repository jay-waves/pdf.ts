import { type ReactNode, useLayoutEffect, useRef } from 'react';
import { useViewportCapability, useViewportElement } from '@embedpdf/plugin-viewport/react';
import { ZoomGestureWrapper, useZoomCapability } from '@embedpdf/plugin-zoom/react';

const WHEEL_COMMIT_DELAY_MS = 150;
const WHEEL_DELTA_LIMIT_PX = 50;
const WHEEL_SENSITIVITY = 0.0012;
const CROSS_AXIS_WHEEL_SPEED = 0.35;
const MIN_ZOOM_LEVEL = 0.2;
const MAX_ZOOM_LEVEL = 60;
const MIN_COMMIT_SCALE_STEP = 0.8;
const MAX_COMMIT_SCALE_STEP = 1.25;

function normalizeWheelDelta(event: WheelEvent, pageHeight: number) {
  const deltaInPixels = event.deltaMode === WheelEvent.DOM_DELTA_LINE
    ? event.deltaY * 16
    : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
      ? event.deltaY * pageHeight
      : event.deltaY;

  return Math.max(-WHEEL_DELTA_LIMIT_PX, Math.min(WHEEL_DELTA_LIMIT_PX, deltaInPixels));
}

function normalizePanDelta(delta: number, deltaMode: number, pageSize: number) {
  return deltaMode === WheelEvent.DOM_DELTA_LINE
    ? delta * 16
    : deltaMode === WheelEvent.DOM_DELTA_PAGE
      ? delta * pageSize
      : delta;
}

function NormalizedWheelZoom({ documentId, children }: { documentId: string; children: ReactNode }) {
  const { provides: zoomProvides } = useZoomCapability();
  const { provides: viewportProvides } = useViewportCapability();
  const viewportElementRef = useViewportElement();
  const elementRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = elementRef.current;
    const container = viewportElementRef?.current;
    if (!element || !container || !zoomProvides) return;

    const zoomScope = zoomProvides.forDocument(documentId);
    const viewportGap = viewportProvides?.getViewportGap() ?? 0;
    let commitTimer = 0;
    let initialZoom = 0;
    let accumulatedScale = 1;
    let initialWidth = 0;
    let initialHeight = 0;
    let initialLeft = 0;
    let initialTop = 0;
    let containerWidth = 0;
    let containerHeight = 0;
    let layoutWidth = 0;
    let layoutCenterX = 0;
    let pointerLocalY = 0;
    let pointerContainerX = 0;
    let pointerContainerY = 0;
    let pivotLocalX = 0;

    const calculateTransform = (scale: number) => {
      const finalWidth = initialWidth * scale;
      const finalHeight = initialHeight * scale;
      let translateY = pointerLocalY * (1 - scale);
      const centeredX = layoutCenterX - finalWidth / 2 - initialLeft;
      const pointerX = pointerContainerX - pivotLocalX * scale - initialLeft;
      const blendRange = layoutWidth * 0.3;
      const blend = blendRange > 0 ? Math.min(1, Math.max(0, finalWidth - layoutWidth) / blendRange) : 1;
      let translateX = centeredX + (pointerX - centeredX) * blend;

      if (finalHeight > containerHeight - viewportGap * 2) {
        const constrainedTop = Math.max(
          containerHeight - viewportGap - finalHeight,
          Math.min(viewportGap, initialTop + translateY),
        );
        translateY = constrainedTop - initialTop;
      }

      if (finalWidth > containerWidth - viewportGap * 2) {
        const constrainedLeft = Math.max(
          containerWidth - viewportGap - finalWidth,
          Math.min(viewportGap, initialLeft + translateX),
        );
        translateX = constrainedLeft - initialLeft;
      }

      return { finalWidth, translateX, translateY };
    };

    const initializeGesture = (event: WheelEvent) => {
      const containerRect = container.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      initialZoom = zoomScope.getState().currentZoomLevel;
      initialWidth = elementRect.width;
      initialHeight = elementRect.height;
      initialLeft = elementRect.left - containerRect.left;
      initialTop = elementRect.top - containerRect.top;
      containerWidth = containerRect.width;
      containerHeight = containerRect.height;
      layoutWidth = container.clientWidth;
      layoutCenterX = container.clientLeft + layoutWidth / 2;
      pointerLocalY = event.clientY - elementRect.top;
      pointerContainerX = event.clientX - containerRect.left;
      pointerContainerY = event.clientY - containerRect.top;
      const pointerLocalX = event.clientX - elementRect.left;
      pivotLocalX = initialWidth < layoutWidth
        ? (pointerContainerX * initialWidth) / layoutWidth
        : pointerLocalX;
    };

    const resetTransform = () => {
      element.style.transform = 'none';
      element.style.transformOrigin = '0 0';
      accumulatedScale = 1;
    };

    const requestZoomInSteps = (targetZoom: number, anchor: { vx: number; vy: number }) => {
      let currentZoom = zoomScope.getState().currentZoomLevel;

      // Large one-shot scale changes make the virtualized scroller discard and
      // recreate its visible range before its scroll anchor has settled. Apply
      // the same target synchronously in bounded steps: the stores see each
      // intermediate layout, while the browser still paints only the final one.
      for (let step = 0; step < 64 && Math.abs(targetZoom - currentZoom) > 0.0005; step += 1) {
        const nextZoom = targetZoom < currentZoom
          ? Math.max(targetZoom, currentZoom * MIN_COMMIT_SCALE_STEP)
          : Math.min(targetZoom, currentZoom * MAX_COMMIT_SCALE_STEP);

        zoomScope.requestZoomBy(nextZoom - currentZoom, anchor);
        const appliedZoom = zoomScope.getState().currentZoomLevel;
        if (Math.abs(appliedZoom - currentZoom) < 0.0005) break;
        currentZoom = appliedZoom;
      }
    };

    const commitZoom = () => {
      const { finalWidth, translateX, translateY } = calculateTransform(accumulatedScale);
      const scaleDifference = 1 - accumulatedScale;
      const anchorX = finalWidth <= layoutWidth
        ? layoutCenterX
        : Math.abs(scaleDifference) > 0.001
          ? initialLeft + translateX / scaleDifference
          : pointerContainerX;
      // calculateTransform constrains the preview at the beginning and end of
      // the document. Use the anchor represented by that constrained preview;
      // keeping the raw pointer Y would make the committed layout jump pages.
      const anchorY = Math.abs(scaleDifference) > 0.001
        ? initialTop + translateY / scaleDifference
        : pointerContainerY;

      requestZoomInSteps(initialZoom * accumulatedScale, {
        vx: anchorX,
        vy: anchorY,
      });
      resetTransform();
      initialZoom = 0;
    };

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        const strategy = document.documentElement.dataset.shnctlScrollStrategy;
        if (strategy === 'vertical' && event.deltaX) {
          container.scrollLeft += normalizePanDelta(event.deltaX, event.deltaMode, container.clientWidth) * CROSS_AXIS_WHEEL_SPEED;
        } else if (strategy === 'horizontal' && event.deltaY) {
          container.scrollTop += normalizePanDelta(event.deltaY, event.deltaMode, container.clientHeight) * CROSS_AXIS_WHEEL_SPEED;
        }
        return;
      }
      event.preventDefault();

      if (!commitTimer) initializeGesture(event);
      else window.clearTimeout(commitTimer);

      const delta = normalizeWheelDelta(event, container.clientHeight);
      accumulatedScale *= Math.exp(-delta * WHEEL_SENSITIVITY);
      // Keep the temporary transform within the same absolute range used by
      // the zoom plugin. Otherwise a long zoom-out gesture can preview below
      // 20%, then snap to the plugin's 20% minimum when it is committed.
      accumulatedScale = Math.max(
        MIN_ZOOM_LEVEL / initialZoom,
        Math.min(MAX_ZOOM_LEVEL / initialZoom, accumulatedScale),
      );

      const { translateX, translateY } = calculateTransform(accumulatedScale);
      element.style.transformOrigin = '0 0';
      element.style.transform = `translate(${translateX}px, ${translateY}px) scale(${accumulatedScale})`;

      commitTimer = window.setTimeout(() => {
        commitTimer = 0;
        commitZoom();
      }, WHEEL_COMMIT_DELAY_MS);
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
      if (commitTimer) window.clearTimeout(commitTimer);
      resetTransform();
    };
  }, [documentId, viewportElementRef, viewportProvides, zoomProvides]);

  return (
    <div ref={elementRef} style={{ display: 'inline-block', overflow: 'visible', boxSizing: 'border-box' }}>
      {children}
    </div>
  );
}

export function ZoomGesture({ documentId, children }: { documentId: string; children: ReactNode }) {
  return (
    <ZoomGestureWrapper documentId={documentId} enableWheel={false}>
      <NormalizedWheelZoom documentId={documentId}>{children}</NormalizedWheelZoom>
    </ZoomGestureWrapper>
  );
}
