import { useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useGesture } from '@use-gesture/react';
import { useViewportCapability, useViewportElement } from '@embedpdf/plugin-viewport/react';
import { useInteractionManagerCapability } from '@embedpdf/plugin-interaction-manager/react';
import { ScrollStrategy } from '@embedpdf/plugin-scroll';
import { useZoomCapability } from '@embedpdf/plugin-zoom/react';
import type { PdfScroll } from './pdf-scroll';
import {
  pointerInputSource,
  viewerActivity,
  type ViewerActivitySession,
} from './viewer-activity';

const WHEEL_DELTA_LIMIT_PX = 50;
const WHEEL_ZOOM_SENSITIVITY = 0.0012;
const WHEEL_SCROLL_COMPRESSION_THRESHOLD_PX = 24;
const WHEEL_SCROLL_COMPRESSION_RATIO = 0.25;
const MIN_ZOOM_LEVEL = 0.2;
const MAX_ZOOM_LEVEL = 60;
const PAN_DRAG_THRESHOLD_PX = 4;
const TOUCH_LONG_PRESS_DELAY_MS = 500;
const TOUCH_PAN_THRESHOLD_PX = 8;
const TOUCH_EDGE_TAP_SIZE_PX = 48;
const TOUCH_INERTIA_MIN_SPEED_PX_PER_MS = 0.08;
const TOUCH_INERTIA_STOP_SPEED_PX_PER_MS = 0.02;
const TOUCH_INERTIA_MAX_SPEED_PX_PER_MS = 2.5;
const TOUCH_INERTIA_TIME_CONSTANT_MS = 240;

type DragInputState = {
  event: PointerEvent;
  first: boolean;
  last: boolean;
  canceled: boolean;
  movement: [number, number];
  velocity: [number, number];
  direction: [number, number];
  cancel(): void;
};

type PinchInputState = {
  event: PointerEvent;
  first: boolean;
  last: boolean;
  canceled: boolean;
  movement: [number, number];
  origin: [number, number];
};

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

export function ViewportInput({
  documentId,
  panMode,
  scroll,
}: {
  documentId: string;
  panMode: boolean;
  scroll?: PdfScroll | null;
}) {
  const { provides: zoom } = useZoomCapability();
  const { provides: viewportCapability } = useViewportCapability();
  const { provides: interactionManager } = useInteractionManagerCapability();
  const viewportElementRef = useViewportElement();
  const dragHandlerRef = useRef<((state: DragInputState) => void) | null>(null);
  const pinchHandlerRef = useRef<((state: PinchInputState) => void) | null>(null);

  useGesture({
    onDrag: (state) => {
      if (!(state.event instanceof PointerEvent)) return;
      dragHandlerRef.current?.({
        event: state.event,
        first: state.first,
        last: state.last,
        canceled: state.canceled,
        movement: state.movement,
        velocity: state.velocity,
        direction: state.direction,
        cancel: state.cancel,
      });
    },
    onPinch: (state) => {
      if (!(state.event instanceof PointerEvent)) return;
      pinchHandlerRef.current?.({
        event: state.event,
        first: state.first,
        last: state.last,
        canceled: state.canceled,
        movement: state.movement,
        origin: state.origin,
      });
    },
  }, {
    target: viewportElementRef ?? undefined,
    eventOptions: { capture: true, passive: false },
    drag: {
      pointer: {
        buttons: [1, 4],
        // Exclusive annotation modes still need their original pointer target.
        // Window tracking keeps drags reliable without stealing that capture.
        capture: false,
        keys: false,
      },
    },
    pinch: {
      pinchOnWheel: false,
    },
  });

  useLayoutEffect(() => {
    const viewport = viewportElementRef?.current;
    if (!viewport || !zoom || !viewportCapability) return;

    const zoomScope = zoom.forDocument(documentId);
    const viewportScope = viewportCapability.forDocument(documentId);
    let zoomFrame = 0;
    let scrollFrame = 0;
    let inertiaFrame = 0;
    let wheelEndTimer = 0;
    let pendingZoomDelta = 0;
    let pendingZoomLevel: number | null = null;
    let pendingScroll: { left: number; top: number } | null = null;
    let zoomAnchor = { vx: 0, vy: 0 };
    let pinchStartZoom: number | null = null;
    const replayedTouchEvents = new WeakSet<Event>();
    let touchGesture: {
      pointerId: number;
      pointerX: number;
      pointerY: number;
      target: Element;
      timer: number;
      mode: 'pending' | 'pan' | 'selection';
      interactionPaused: boolean;
      scrollLeft: number;
      scrollTop: number;
    } | null = null;
    let panGesture: {
      scrollLeft: number;
      scrollTop: number;
      dragging: boolean;
    } | null = null;
    let cancelActiveDrag: (() => void) | null = null;
    let dragActivity: ViewerActivitySession | null = null;
    let pinchActivity: ViewerActivitySession | null = null;
    let wheelActivity: ViewerActivitySession | null = null;

    const releaseTouchGesture = () => {
      const gesture = touchGesture;
      touchGesture = null;
      if (!gesture) return null;
      window.clearTimeout(gesture.timer);
      if (gesture.interactionPaused) {
        interactionManager?.forDocument(documentId).resume();
      }
      return gesture;
    };

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

    const cancelInertia = () => {
      if (!inertiaFrame) return;
      window.cancelAnimationFrame(inertiaFrame);
      inertiaFrame = 0;
      dragActivity?.end();
      dragActivity = null;
    };

    const startTouchInertia = (velocityX: number, velocityY: number) => {
      cancelInertia();
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        dragActivity?.end();
        dragActivity = null;
        return;
      }

      let vx = clamp(
        velocityX,
        -TOUCH_INERTIA_MAX_SPEED_PX_PER_MS,
        TOUCH_INERTIA_MAX_SPEED_PX_PER_MS,
      );
      let vy = clamp(
        velocityY,
        -TOUCH_INERTIA_MAX_SPEED_PX_PER_MS,
        TOUCH_INERTIA_MAX_SPEED_PX_PER_MS,
      );
      if (Math.hypot(vx, vy) < TOUCH_INERTIA_MIN_SPEED_PX_PER_MS) {
        dragActivity?.end();
        dragActivity = null;
        return;
      }

      flushPendingScroll();
      let previousTime = performance.now();
      const step = (time: number) => {
        const elapsed = Math.min(32, Math.max(0, time - previousTime));
        previousTime = time;
        const decay = Math.exp(-elapsed / TOUCH_INERTIA_TIME_CONSTANT_MS);
        const left = viewport.scrollLeft;
        const top = viewport.scrollTop;
        viewport.scrollTo(left + vx * elapsed, top + vy * elapsed);

        if (viewport.scrollLeft === left) vx = 0;
        else vx *= decay;
        if (viewport.scrollTop === top) vy = 0;
        else vy *= decay;

        if (Math.hypot(vx, vy) < TOUCH_INERTIA_STOP_SPEED_PX_PER_MS) {
          inertiaFrame = 0;
          dragActivity?.end();
          dragActivity = null;
          return;
        }
        inertiaFrame = window.requestAnimationFrame(step);
      };
      inertiaFrame = window.requestAnimationFrame(step);
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
      cancelInertia();
      const path = event.ctrlKey || event.metaKey
        ? ['Viewport', 'Zoom'] as const
        : ['Viewport', 'Scroll'] as const;
      if (!wheelActivity) wheelActivity = viewerActivity.begin('Wheel', path);
      else wheelActivity.update(path);
      if (wheelEndTimer) window.clearTimeout(wheelEndTimer);
      wheelEndTimer = window.setTimeout(() => {
        wheelEndTimer = 0;
        wheelActivity?.end();
        wheelActivity = null;
      }, 120);
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
      const horizontalLayout = scroll?.getStrategy() === ScrollStrategy.Horizontal;
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

    const handlePinch = (state: PinchInputState) => {
      const { event, first, last, canceled, movement, origin } = state;
      event.preventDefault();
      if (first) {
        cancelInertia();
        releaseTouchGesture();
        cancelActiveDrag?.();
        cancelActiveDrag = null;
        dragActivity?.end();
        dragActivity = null;
        flushPendingInput();
        pendingZoomDelta = 0;
        pendingZoomLevel = null;
        pinchStartZoom = zoomScope.getState().currentZoomLevel;
        pinchActivity = viewerActivity.begin('Touch', ['Viewport', 'Zoom']);
      }

      if (pinchStartZoom !== null && !canceled) {
        pendingZoomLevel = pinchStartZoom * movement[0];
        setAnchor(origin[0], origin[1]);
        scheduleZoom();
      }

      if (last || canceled) {
        pinchStartZoom = null;
        pinchActivity?.end();
        pinchActivity = null;
      }
    };

    const handleDrag = (state: DragInputState) => {
      const { event, first, last, movement, velocity, direction, canceled, cancel } = state;
      if (replayedTouchEvents.has(event)) {
        cancel();
        return;
      }

      if (first) {
        cancelInertia();
        cancelActiveDrag = cancel;
      }

      if (event.pointerType === 'touch') {
        if (first) {
          if (event.button !== 0 || touchGesture || pinchStartZoom !== null) {
            cancelActiveDrag = null;
            cancel();
            return;
          }
          const interactionScope = interactionManager?.forDocument(documentId);
          // Exclusive modes (ink, shapes, comments, etc.) own raw touch input.
          // In the default pointer mode, defer selection until a long press so a
          // normal one-finger gesture can drive the viewer's pan pipeline.
          if (interactionScope?.activeModeIsExclusive()) {
            cancelActiveDrag = null;
            cancel();
            return;
          }

          const target = event.target instanceof Element ? event.target : viewport;
          const interactionPaused = Boolean(interactionScope && !interactionScope.isPaused());
          if (interactionPaused) interactionScope?.pause();
          flushPendingInput();
          const scrollPosition = pendingScroll ?? { left: viewport.scrollLeft, top: viewport.scrollTop };
          touchGesture = {
            pointerId: event.pointerId,
            pointerX: event.clientX,
            pointerY: event.clientY,
            target,
            timer: 0,
            mode: 'pending',
            interactionPaused,
            scrollLeft: scrollPosition.left,
            scrollTop: scrollPosition.top,
          };
          touchGesture.timer = window.setTimeout(() => {
            const gesture = touchGesture;
            if (!gesture || gesture.pointerId !== event.pointerId) return;
            if (!gesture.target.isConnected) {
              touchGesture = null;
              if (gesture.interactionPaused) interactionScope?.resume();
              return;
            }
            gesture.mode = 'selection';
            if (gesture.interactionPaused) {
              interactionScope?.resume();
              gesture.interactionPaused = false;
            }

            const init: PointerEventInit = {
              bubbles: true,
              cancelable: true,
              composed: true,
              pointerId: gesture.pointerId,
              pointerType: 'touch',
              isPrimary: true,
              button: 0,
              buttons: 1,
              clientX: gesture.pointerX,
              clientY: gesture.pointerY,
            };
            const pointerDown = new PointerEvent('pointerdown', init);
            replayedTouchEvents.add(pointerDown);
            gesture.target.dispatchEvent(pointerDown);
            // A long press selects the word immediately. The replayed pointerdown
            // also leaves an anchor in place so dragging can extend that selection.
            gesture.target.dispatchEvent(new MouseEvent('dblclick', init));
          }, TOUCH_LONG_PRESS_DELAY_MS);
        }

        if (!touchGesture) return;
        if (touchGesture.mode === 'pending') {
          const [deltaX, deltaY] = movement;
          if (
            deltaX * deltaX + deltaY * deltaY >= TOUCH_PAN_THRESHOLD_PX ** 2
          ) {
            window.clearTimeout(touchGesture.timer);
            touchGesture.mode = 'pan';
            dragActivity = viewerActivity.begin(pointerInputSource(event), ['Viewport', 'Pan']);
          }
        }
        if (touchGesture.mode === 'pan') {
          event.preventDefault();
          event.stopPropagation();
          scrollTo(
            touchGesture.scrollLeft - movement[0],
            touchGesture.scrollTop - movement[1],
          );
        }
        if (last) {
          const completedTouch = releaseTouchGesture();
          cancelActiveDrag = null;
          if (!completedTouch) return;
          if (completedTouch.mode === 'pending' && !canceled) {
            const bounds = viewport.getBoundingClientRect();
            if (completedTouch.pointerY - bounds.top <= TOUCH_EDGE_TAP_SIZE_PX) {
              viewerActivity.pulse(
                'Touch',
                ['Controls', 'Toolbar', 'Edge tap'],
                'toolbar',
              );
            } else if (bounds.bottom - completedTouch.pointerY <= TOUCH_EDGE_TAP_SIZE_PX) {
              viewerActivity.pulse(
                'Touch',
                ['Controls', 'Navigation', 'Edge tap'],
                'navigation',
              );
            }
          }
          if (completedTouch.mode === 'pan' && !canceled) {
            dragActivity?.update(['Viewport', 'Pan', 'Inertia']);
            startTouchInertia(
              -velocity[0] * direction[0],
              -velocity[1] * direction[1],
            );
          } else {
            dragActivity?.end();
            dragActivity = null;
          }
        }
        return;
      }

      if (first) {
        const startedByMiddleMouse = event.button === 1;
        const startedByToolbarPan = panMode && event.button === 0;
        if ((!startedByMiddleMouse && !startedByToolbarPan) || panGesture) {
          cancelActiveDrag = null;
          cancel();
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        flushPendingInput();
        const scrollPosition = pendingScroll ?? { left: viewport.scrollLeft, top: viewport.scrollTop };
        panGesture = {
          scrollLeft: scrollPosition.left,
          scrollTop: scrollPosition.top,
          dragging: false,
        };
        viewport.dataset.pdfPanning = 'true';
        dragActivity = viewerActivity.begin(pointerInputSource(event), ['Viewport', 'Pan']);
      }

      if (!panGesture) return;
      event.preventDefault();
      event.stopPropagation();
      const [deltaX, deltaY] = movement;
      panGesture.dragging ||= deltaX * deltaX + deltaY * deltaY >= PAN_DRAG_THRESHOLD_PX ** 2;
      if (panGesture.dragging) {
        scrollTo(panGesture.scrollLeft - deltaX, panGesture.scrollTop - deltaY);
      }
      if (last) {
        const completed = panGesture;
        panGesture = null;
        cancelActiveDrag = null;
        delete viewport.dataset.pdfPanning;
        if (!completed.dragging) scrollTo(completed.scrollLeft, completed.scrollTop);
        dragActivity?.end();
        dragActivity = null;
      }
    };

    dragHandlerRef.current = handleDrag;
    pinchHandlerRef.current = handlePinch;

    const stopMiddleMouseDefault = (event: MouseEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const cancelInput = () => {
      if (wheelEndTimer) {
        window.clearTimeout(wheelEndTimer);
        wheelEndTimer = 0;
      }
      cancelInertia();
      cancelActiveDrag?.();
      cancelActiveDrag = null;
      releaseTouchGesture();
      panGesture = null;
      pinchStartZoom = null;
      delete viewport.dataset.pdfPanning;
      dragActivity?.end();
      dragActivity = null;
      pinchActivity?.end();
      pinchActivity = null;
      wheelActivity?.end();
      wheelActivity = null;
    };

    viewport.addEventListener('wheel', handleWheel, { passive: false });
    viewport.addEventListener('mousedown', stopMiddleMouseDefault, { capture: true });
    viewport.addEventListener('auxclick', stopMiddleMouseDefault, { capture: true });
    window.addEventListener('blur', cancelInput);
    return () => {
      viewport.removeEventListener('wheel', handleWheel);
      viewport.removeEventListener('mousedown', stopMiddleMouseDefault, { capture: true });
      viewport.removeEventListener('auxclick', stopMiddleMouseDefault, { capture: true });
      window.removeEventListener('blur', cancelInput);
      dragHandlerRef.current = null;
      pinchHandlerRef.current = null;
      cancelInput();
      if (zoomFrame) window.cancelAnimationFrame(zoomFrame);
      if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
    };
  }, [documentId, interactionManager, panMode, scroll, viewportCapability, viewportElementRef, zoom]);

  return null;
}
