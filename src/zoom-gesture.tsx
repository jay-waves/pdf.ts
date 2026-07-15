import { type ReactNode, useLayoutEffect, useRef } from 'react';
import { useViewportCapability, useViewportElement } from '@embedpdf/plugin-viewport/react';
import { ZoomGestureWrapper, useZoomCapability } from '@embedpdf/plugin-zoom/react';

const WHEEL_COMMIT_DELAY_MS = 150;
const WHEEL_DELTA_LIMIT_PX = 50;
const WHEEL_SENSITIVITY = 0.0012;

function normalizeWheelDelta(event: WheelEvent, pageHeight: number) {
  const deltaInPixels = event.deltaMode === WheelEvent.DOM_DELTA_LINE
    ? event.deltaY * 16
    : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
      ? event.deltaY * pageHeight
      : event.deltaY;

  return Math.max(-WHEEL_DELTA_LIMIT_PX, Math.min(WHEEL_DELTA_LIMIT_PX, deltaInPixels));
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

    const commitZoom = () => {
      const { finalWidth, translateX } = calculateTransform(accumulatedScale);
      const scaleDifference = 1 - accumulatedScale;
      const anchorX = finalWidth <= layoutWidth
        ? layoutCenterX
        : Math.abs(scaleDifference) > 0.001
          ? initialLeft + translateX / scaleDifference
          : pointerContainerX;

      zoomScope.requestZoomBy((accumulatedScale - 1) * initialZoom, {
        vx: anchorX,
        vy: pointerContainerY,
      });
      resetTransform();
      initialZoom = 0;
    };

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();

      if (!commitTimer) initializeGesture(event);
      else window.clearTimeout(commitTimer);

      const delta = normalizeWheelDelta(event, container.clientHeight);
      accumulatedScale *= Math.exp(-delta * WHEEL_SENSITIVITY);
      accumulatedScale = Math.max(0.1, Math.min(10, accumulatedScale));

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
