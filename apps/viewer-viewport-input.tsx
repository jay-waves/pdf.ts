import { type ReactNode, useLayoutEffect } from 'react';
import { flushSync } from 'react-dom';
import { useViewportCapability, useViewportElement } from '@embedpdf/plugin-viewport/react';
import { ZoomGestureWrapper, useZoomCapability } from '@embedpdf/plugin-zoom/react';

const WHEEL_DELTA_LIMIT_PX = 50;
const WHEEL_ZOOM_SENSITIVITY = 0.0012;
const WHEEL_SCROLL_COMPRESSION_THRESHOLD_PX = 24;
const WHEEL_SCROLL_COMPRESSION_RATIO = 0.25;
const MIN_ZOOM_LEVEL = 0.2;
const MAX_ZOOM_LEVEL = 60;
const PAN_DRAG_THRESHOLD_PX = 4;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function wheelDeltaInPixels(delta: number, event: WheelEvent, pageSize: number) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return delta * 16;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return delta * pageSize;
  return delta;
}

function normalizedZoomDelta(event: WheelEvent, pageHeight: number) {
  const delta = wheelDeltaInPixels(event.deltaY, event, pageHeight);
  return clamp(delta, -WHEEL_DELTA_LIMIT_PX, WHEEL_DELTA_LIMIT_PX);
}

function compressWheelDelta(delta: number) {
  const magnitude = Math.abs(delta);
  if (magnitude <= WHEEL_SCROLL_COMPRESSION_THRESHOLD_PX) return delta;
  return Math.sign(delta) * (
    WHEEL_SCROLL_COMPRESSION_THRESHOLD_PX
    + (magnitude - WHEEL_SCROLL_COMPRESSION_THRESHOLD_PX) * WHEEL_SCROLL_COMPRESSION_RATIO
  );
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

function ViewportInputPipeline({ documentId, panMode }: { documentId: string; panMode: boolean }) {
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
    let panGesture: {
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

    const flushPendingScroll = () => {
      if (!scrollFrame) return;
      window.cancelAnimationFrame(scrollFrame);
      flushScroll();
    };

    const scrollHiddenAxisBy = (deltaX: number, deltaY: number) => {
      viewport.scrollTo(
        viewport.scrollLeft + compressWheelDelta(deltaX),
        viewport.scrollTop + compressWheelDelta(deltaY),
      );
    };

    const setAnchor = (clientX: number, clientY: number) => {
      const bounds = viewport.getBoundingClientRect();
      zoomAnchor = {
        vx: clamp(clientX - bounds.left, 0, viewport.clientWidth),
        vy: clamp(clientY - bounds.top, 0, viewport.clientHeight),
      };
    };

    const flushZoom = () => {
      zoomFrame = 0;
      const requestedLevel = pendingZoomLevel;
      const delta = pendingZoomDelta;
      pendingZoomLevel = null;
      pendingZoomDelta = 0;

      const currentZoom = zoomScope.getState().currentZoomLevel;
      const targetZoom = clamp(
        requestedLevel ?? currentZoom * Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY),
        MIN_ZOOM_LEVEL,
        MAX_ZOOM_LEVEL,
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
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        flushPendingScroll();
        pendingZoomLevel = null;
        pendingZoomDelta += normalizedZoomDelta(event, viewport.clientHeight);
        setAnchor(event.clientX, event.clientY);
        scheduleZoom();
        return;
      }

      flushPendingZoom();
      flushPendingScroll();
      const horizontalLayout = (
        document.documentElement.dataset.pdfScrollStrategy === 'horizontal'
      );
      // This axis is visible, so retain the browser's native Shift + wheel.
      if (event.shiftKey && horizontalLayout) return;

      const deltaX = wheelDeltaInPixels(event.deltaX, event, viewport.clientWidth);
      const deltaY = wheelDeltaInPixels(event.deltaY, event, viewport.clientHeight);
      if (event.shiftKey) {
        event.preventDefault();
        // Vertical layout hides the horizontal axis, so it still needs a
        // programmatic fallback. Browsers differ on which delta carries Shift.
        scrollHiddenAxisBy(Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY, 0);
        return;
      }

      if (horizontalLayout && deltaY) {
        // The vertical scrollbar is hidden in horizontal layout, but
        // overflow:hidden remains programmatically scrollable.
        scrollHiddenAxisBy(0, deltaY);
      } else if (!horizontalLayout && deltaX) {
        // Likewise, retain trackpad horizontal movement while the horizontal
        // scrollbar is hidden in vertical layout.
        scrollHiddenAxisBy(deltaX, 0);
      }
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

    const startPan = (event: PointerEvent) => {
      const startedByMiddleMouse = event.button === 1;
      const startedByToolbarPan = panMode && event.button === 0 && event.pointerType !== 'touch';
      if ((!startedByMiddleMouse && !startedByToolbarPan) || panGesture) return;
      event.preventDefault();
      event.stopPropagation();
      flushPendingInput();
      const scrollPosition = pendingScroll ?? { left: viewport.scrollLeft, top: viewport.scrollTop };
      panGesture = {
        pointerId: event.pointerId,
        pointerX: event.clientX,
        pointerY: event.clientY,
        scrollLeft: scrollPosition.left,
        scrollTop: scrollPosition.top,
        dragging: false,
      };
      viewport.dataset.pdfPanning = 'true';
      viewport.setPointerCapture(event.pointerId);
    };

    const updatePan = (event: PointerEvent) => {
      if (!panGesture || event.pointerId !== panGesture.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const deltaX = event.clientX - panGesture.pointerX;
      const deltaY = event.clientY - panGesture.pointerY;
      panGesture.dragging ||= deltaX * deltaX + deltaY * deltaY >= PAN_DRAG_THRESHOLD_PX ** 2;
      if (panGesture.dragging) {
        scrollTo(panGesture.scrollLeft - deltaX, panGesture.scrollTop - deltaY);
      }
    };

    const finishPan = (event?: PointerEvent) => {
      if (!panGesture || (event && event.pointerId !== panGesture.pointerId)) return;
      if (event) updatePan(event);
      const completed = panGesture;
      panGesture = null;
      delete viewport.dataset.pdfPanning;
      if (!completed.dragging) scrollTo(completed.scrollLeft, completed.scrollTop);
      if (viewport.hasPointerCapture(completed.pointerId)) viewport.releasePointerCapture(completed.pointerId);
    };

    const stopMiddleMouseDefault = (event: MouseEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const cancelPan = () => finishPan();

    viewport.addEventListener('wheel', handleWheel, { passive: false });
    viewport.addEventListener('touchstart', handleTouchStart, { passive: false });
    viewport.addEventListener('touchmove', handleTouchMove, { passive: false });
    viewport.addEventListener('touchend', handleTouchEnd);
    viewport.addEventListener('touchcancel', handleTouchEnd);
    viewport.addEventListener('pointerdown', startPan, { capture: true });
    viewport.addEventListener('pointermove', updatePan, { capture: true });
    viewport.addEventListener('pointerup', finishPan, { capture: true });
    viewport.addEventListener('pointercancel', finishPan, { capture: true });
    viewport.addEventListener('lostpointercapture', finishPan, { capture: true });
    viewport.addEventListener('mousedown', stopMiddleMouseDefault, { capture: true });
    viewport.addEventListener('auxclick', stopMiddleMouseDefault, { capture: true });
    window.addEventListener('blur', cancelPan);
    return () => {
      viewport.removeEventListener('wheel', handleWheel);
      viewport.removeEventListener('touchstart', handleTouchStart);
      viewport.removeEventListener('touchmove', handleTouchMove);
      viewport.removeEventListener('touchend', handleTouchEnd);
      viewport.removeEventListener('touchcancel', handleTouchEnd);
      viewport.removeEventListener('pointerdown', startPan, { capture: true });
      viewport.removeEventListener('pointermove', updatePan, { capture: true });
      viewport.removeEventListener('pointerup', finishPan, { capture: true });
      viewport.removeEventListener('pointercancel', finishPan, { capture: true });
      viewport.removeEventListener('lostpointercapture', finishPan, { capture: true });
      viewport.removeEventListener('mousedown', stopMiddleMouseDefault, { capture: true });
      viewport.removeEventListener('auxclick', stopMiddleMouseDefault, { capture: true });
      window.removeEventListener('blur', cancelPan);
      delete viewport.dataset.pdfPanning;
      if (zoomFrame) window.cancelAnimationFrame(zoomFrame);
      if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
    };
  }, [documentId, panMode, viewportCapability, viewportElementRef, zoom]);

  return null;
}

export function ViewportInput({
  documentId,
  panMode,
  children,
}: {
  documentId: string;
  panMode: boolean;
  children: ReactNode;
}) {
  return (
    <ZoomGestureWrapper
      documentId={documentId}
      enablePinch={false}
      enableWheel={false}
    >
      <ViewportInputPipeline documentId={documentId} panMode={panMode} />
      {children}
    </ZoomGestureWrapper>
  );
}
