import { type ReactNode, useLayoutEffect } from 'react';
import { flushSync } from 'react-dom';
import { useViewportCapability, useViewportElement } from '@embedpdf/plugin-viewport/react';
import { ZoomGestureWrapper, useZoomCapability } from '@embedpdf/plugin-zoom/react';

const WHEEL_DELTA_LIMIT_PX = 50;
const WHEEL_ZOOM_SENSITIVITY = 0.0012;
const CROSS_AXIS_WHEEL_SPEED = 0.35;
const MIN_ZOOM_LEVEL = 0.2;
const MAX_ZOOM_LEVEL = 60;
const MIDDLE_MOUSE_DRAG_THRESHOLD_PX = 4;

function wheelDeltaInPixels(delta: number, event: WheelEvent, pageSize: number) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return delta * 16;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return delta * pageSize;
  return delta;
}

function normalizedZoomDelta(event: WheelEvent, pageHeight: number) {
  const delta = wheelDeltaInPixels(event.deltaY, event, pageHeight);
  return Math.max(-WHEEL_DELTA_LIMIT_PX, Math.min(WHEEL_DELTA_LIMIT_PX, delta));
}

function touchDistance(touches: TouchList) {
  return Math.hypot(
    touches[1].clientX - touches[0].clientX,
    touches[1].clientY - touches[0].clientY,
  );
}

function touchCenter(touches: TouchList) {
  return {
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
  };
}

function ViewportInputPipeline({ documentId }: { documentId: string }) {
  const { provides: zoom } = useZoomCapability();
  const { provides: viewportCapability } = useViewportCapability();
  const viewportElementRef = useViewportElement();

  useLayoutEffect(() => {
    const viewport = viewportElementRef?.current;
    if (!viewport || !zoom || !viewportCapability) return;

    const zoomScope = zoom.forDocument(documentId);
    const viewportScope = viewportCapability.forDocument(documentId);
    let zoomFrame = 0;
    let scrollFrame = 0;
    let pendingZoomDelta = 0;
    let pendingZoomLevel: number | null = null;
    let pendingScroll: { left: number; top: number } | null = null;
    let zoomAnchor = { vx: 0, vy: 0 };
    let pinchStart: { distance: number; zoom: number } | null = null;
    let middlePan: {
      pointerId: number;
      pointerX: number;
      pointerY: number;
      scrollLeft: number;
      scrollTop: number;
      dragging: boolean;
    } | null = null;

    const flushScroll = () => {
      scrollFrame = 0;
      const target = pendingScroll;
      pendingScroll = null;
      if (target) viewport.scrollTo(target.left, target.top);
    };

    const scrollTo = (left: number, top: number) => {
      pendingScroll = { left, top };
      if (!scrollFrame) scrollFrame = window.requestAnimationFrame(flushScroll);
    };

    const scrollBy = (deltaX: number, deltaY: number) => {
      const current = pendingScroll ?? { left: viewport.scrollLeft, top: viewport.scrollTop };
      scrollTo(current.left + deltaX, current.top + deltaY);
    };

    const flushPendingScroll = () => {
      if (!scrollFrame) return;
      window.cancelAnimationFrame(scrollFrame);
      flushScroll();
    };

    const setAnchor = (clientX: number, clientY: number) => {
      const bounds = viewport.getBoundingClientRect();
      zoomAnchor = {
        vx: Math.max(0, Math.min(viewport.clientWidth, clientX - bounds.left)),
        vy: Math.max(0, Math.min(viewport.clientHeight, clientY - bounds.top)),
      };
    };

    const flushZoom = () => {
      zoomFrame = 0;
      const requestedLevel = pendingZoomLevel;
      const delta = pendingZoomDelta;
      pendingZoomLevel = null;
      pendingZoomDelta = 0;

      const currentZoom = zoomScope.getState().currentZoomLevel;
      const targetZoom = Math.max(
        MIN_ZOOM_LEVEL,
        Math.min(
          MAX_ZOOM_LEVEL,
          requestedLevel ?? currentZoom * Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY),
        ),
      );
      if (Math.abs(targetZoom - currentZoom) < 0.0005) return;

      // EmbedPDF calculates the anchor scroll synchronously but applies it in a
      // later frame. Commit the matching React layout first, then scroll the DOM
      // immediately so scale and position become visible in the same frame.
      flushSync(() => zoomScope.requestZoom(targetZoom, zoomAnchor));
      const metrics = viewportScope.getMetrics();
      viewport.scrollTo(metrics.scrollLeft, metrics.scrollTop);
      // EmbedPDF also queues the same scroll for its next frame. Queue our
      // latest target after it, so newer wheel/PAN input always wins.
      scrollTo(metrics.scrollLeft, metrics.scrollTop);
    };

    const scheduleZoom = () => {
      if (!zoomFrame) zoomFrame = window.requestAnimationFrame(flushZoom);
    };

    const flushPendingZoom = () => {
      if (!zoomFrame) return;
      window.cancelAnimationFrame(zoomFrame);
      flushZoom();
    };

    const flushPendingInput = () => {
      flushPendingScroll();
      flushPendingZoom();
      flushPendingScroll();
    };

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();

      if (event.ctrlKey || event.metaKey) {
        flushPendingScroll();
        pendingZoomLevel = null;
        pendingZoomDelta += normalizedZoomDelta(event, viewport.clientHeight);
        setAnchor(event.clientX, event.clientY);
        scheduleZoom();
        return;
      }

      flushPendingZoom();
      const deltaX = wheelDeltaInPixels(event.deltaX, event, viewport.clientWidth);
      const deltaY = wheelDeltaInPixels(event.deltaY, event, viewport.clientHeight);
      const horizontalLayout = document.documentElement.dataset.shnctlScrollStrategy === 'horizontal';
      scrollBy(
        deltaX * (horizontalLayout ? 1 : CROSS_AXIS_WHEEL_SPEED),
        deltaY * (horizontalLayout ? CROSS_AXIS_WHEEL_SPEED : 1),
      );
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      event.preventDefault();
      flushPendingInput();
      pendingZoomDelta = 0;
      pendingZoomLevel = null;
      const distance = touchDistance(event.touches);
      if (!distance) return;
      pinchStart = {
        distance,
        zoom: zoomScope.getState().currentZoomLevel,
      };
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!pinchStart || event.touches.length !== 2) return;
      event.preventDefault();
      const center = touchCenter(event.touches);
      pendingZoomLevel = pinchStart.zoom * touchDistance(event.touches) / pinchStart.distance;
      setAnchor(center.x, center.y);
      scheduleZoom();
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) pinchStart = null;
    };

    const startMiddlePan = (event: PointerEvent) => {
      if (event.button !== 1 || middlePan) return;
      event.preventDefault();
      event.stopPropagation();
      flushPendingInput();
      const scrollPosition = pendingScroll ?? { left: viewport.scrollLeft, top: viewport.scrollTop };
      middlePan = {
        pointerId: event.pointerId,
        pointerX: event.clientX,
        pointerY: event.clientY,
        scrollLeft: scrollPosition.left,
        scrollTop: scrollPosition.top,
        dragging: false,
      };
      viewport.setPointerCapture(event.pointerId);
    };

    const updateMiddlePan = (event: PointerEvent) => {
      if (!middlePan || event.pointerId !== middlePan.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const deltaX = event.clientX - middlePan.pointerX;
      const deltaY = event.clientY - middlePan.pointerY;
      middlePan.dragging ||= deltaX * deltaX + deltaY * deltaY >= MIDDLE_MOUSE_DRAG_THRESHOLD_PX ** 2;
      if (middlePan.dragging) {
        scrollTo(middlePan.scrollLeft - deltaX, middlePan.scrollTop - deltaY);
      }
    };

    const finishMiddlePan = (event?: PointerEvent) => {
      if (!middlePan || (event && event.pointerId !== middlePan.pointerId)) return;
      if (event) updateMiddlePan(event);
      const completed = middlePan;
      middlePan = null;
      if (!completed.dragging) scrollTo(completed.scrollLeft, completed.scrollTop);
      if (viewport.hasPointerCapture(completed.pointerId)) viewport.releasePointerCapture(completed.pointerId);
    };

    const stopMiddleMouseDefault = (event: MouseEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const cancelMiddlePan = () => finishMiddlePan();

    viewport.addEventListener('wheel', handleWheel, { passive: false });
    viewport.addEventListener('touchstart', handleTouchStart, { passive: false });
    viewport.addEventListener('touchmove', handleTouchMove, { passive: false });
    viewport.addEventListener('touchend', handleTouchEnd);
    viewport.addEventListener('touchcancel', handleTouchEnd);
    viewport.addEventListener('pointerdown', startMiddlePan, { capture: true });
    viewport.addEventListener('pointermove', updateMiddlePan, { capture: true });
    viewport.addEventListener('pointerup', finishMiddlePan, { capture: true });
    viewport.addEventListener('pointercancel', finishMiddlePan, { capture: true });
    viewport.addEventListener('lostpointercapture', finishMiddlePan, { capture: true });
    viewport.addEventListener('mousedown', stopMiddleMouseDefault, { capture: true });
    viewport.addEventListener('auxclick', stopMiddleMouseDefault, { capture: true });
    window.addEventListener('blur', cancelMiddlePan);
    return () => {
      viewport.removeEventListener('wheel', handleWheel);
      viewport.removeEventListener('touchstart', handleTouchStart);
      viewport.removeEventListener('touchmove', handleTouchMove);
      viewport.removeEventListener('touchend', handleTouchEnd);
      viewport.removeEventListener('touchcancel', handleTouchEnd);
      viewport.removeEventListener('pointerdown', startMiddlePan, { capture: true });
      viewport.removeEventListener('pointermove', updateMiddlePan, { capture: true });
      viewport.removeEventListener('pointerup', finishMiddlePan, { capture: true });
      viewport.removeEventListener('pointercancel', finishMiddlePan, { capture: true });
      viewport.removeEventListener('lostpointercapture', finishMiddlePan, { capture: true });
      viewport.removeEventListener('mousedown', stopMiddleMouseDefault, { capture: true });
      viewport.removeEventListener('auxclick', stopMiddleMouseDefault, { capture: true });
      window.removeEventListener('blur', cancelMiddlePan);
      if (zoomFrame) window.cancelAnimationFrame(zoomFrame);
      if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
    };
  }, [documentId, viewportCapability, viewportElementRef, zoom]);

  return null;
}

export function ViewportInput({ documentId, children }: { documentId: string; children: ReactNode }) {
  return (
    <ZoomGestureWrapper documentId={documentId} enablePinch={false} enableWheel={false}>
      <ViewportInputPipeline documentId={documentId} />
      {children}
    </ZoomGestureWrapper>
  );
}
