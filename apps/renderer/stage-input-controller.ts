import type { InteractionManagerCapability } from '@embedpdf/plugin-interaction-manager';
import type { ScrollCapability } from '@embedpdf/plugin-scroll';
import type { ViewportCapability } from '@embedpdf/plugin-viewport';
import type { ZoomCapability } from '@embedpdf/plugin-zoom';
import { ZoomDetents } from './zoom-detents';
import type { ViewerStage } from '../viewer/viewer-stage';
import {
  pointerInputSource,
  viewerActivity,
  type ViewerActivitySession,
} from '../viewer/viewer-activity';

const WHEEL_DELTA_LIMIT_PX = 50;
const WHEEL_ZOOM_SENSITIVITY = 0.002;
const PINCH_ZOOM_GAIN = 1.3;
const MIN_ZOOM_LEVEL = 0.2;
const MAX_ZOOM_LEVEL = 60;
const PAN_DRAG_THRESHOLD_PX = 4;
const TOUCH_LONG_PRESS_DELAY_MS = 500;
const TOUCH_PAN_THRESHOLD_PX = 8;
const TOUCH_INERTIA_MIN_SPEED_PX_PER_MS = 0.08;
const TOUCH_INERTIA_STOP_SPEED_PX_PER_MS = 0.02;
const TOUCH_INERTIA_MAX_SPEED_PX_PER_MS = 2.5;
const TOUCH_INERTIA_TIME_CONSTANT_MS = 240;

export function installBrowserGestureZoomGuard() {
  const preventGestureZoom = (event: Event) => event.preventDefault();

  window.addEventListener('gesturestart', preventGestureZoom, { capture: true, passive: false });
  window.addEventListener('gesturechange', preventGestureZoom, { capture: true, passive: false });
  return () => {
    window.removeEventListener('gesturestart', preventGestureZoom, { capture: true });
    window.removeEventListener('gesturechange', preventGestureZoom, { capture: true });
  };
}

export type PendingZoom = {
  delta: number;
  anchor: { vx: number; vy: number };
};

/** Wheel and pinch both feed the same zoom accumulator. */
export function mergePendingZoom(
  pending: PendingZoom | null,
  delta: number,
  anchor: PendingZoom['anchor'],
): PendingZoom {
  return { delta: (pending?.delta ?? 0) + delta, anchor };
}

export type DragInputState = {
  event: PointerEvent;
  first: boolean;
  last: boolean;
  canceled: boolean;
  movement: [number, number];
  velocity: [number, number];
  direction: [number, number];
  cancel(): void;
};

export type PinchInputState = {
  event: PointerEvent;
  first: boolean;
  last: boolean;
  canceled: boolean;
  movement: [number, number];
  origin: [number, number];
};

type TouchGesture = {
  pointerId: number;
  pointerX: number;
  pointerY: number;
  target: Element;
  timer: number;
  interactionPaused: boolean;
  scrollLeft: number;
  scrollTop: number;
  cancel(): void;
};

export type PointerGesture =
  | { type: 'idle' }
  | ({ type: 'touch-pending' } & TouchGesture)
  | ({ type: 'touch-pan' } & TouchGesture)
  | ({ type: 'touch-selection' } & TouchGesture)
  | {
      type: 'mouse-pan';
      scrollLeft: number;
      scrollTop: number;
      dragging: boolean;
      cancel(): void;
    }
  | {
      type: 'pinch';
      lastScale: number;
    };

export type PointerGestureAction =
  | { type: 'begin-touch'; gesture: TouchGesture }
  | { type: 'begin-mouse'; gesture: Omit<Extract<PointerGesture, { type: 'mouse-pan' }>, 'type'> }
  | { type: 'begin-pinch' }
  | { type: 'touch-pan' }
  | { type: 'touch-selection' }
  | { type: 'set-pinch-scale'; scale: number }
  | { type: 'set-mouse-dragging' }
  | { type: 'end' };

/** Pure transition function used by the browser controller and node tests. */
export function reducePointerGesture(
  state: PointerGesture,
  action: PointerGestureAction,
): PointerGesture {
  switch (action.type) {
    case 'begin-touch':
      return state.type === 'idle' ? { type: 'touch-pending', ...action.gesture } : state;
    case 'begin-mouse':
      return state.type === 'idle' ? { type: 'mouse-pan', ...action.gesture } : state;
    case 'begin-pinch':
      return { type: 'pinch', lastScale: 1 };
    case 'touch-pan':
      return state.type === 'touch-pending' ? { ...state, type: 'touch-pan' } : state;
    case 'touch-selection':
      return state.type === 'touch-pending' ? { ...state, type: 'touch-selection' } : state;
    case 'set-pinch-scale':
      return state.type === 'pinch' ? { ...state, lastScale: action.scale } : state;
    case 'set-mouse-dragging':
      return state.type === 'mouse-pan' && !state.dragging
        ? { ...state, dragging: true }
        : state;
    case 'end':
      return { type: 'idle' };
  }
}

type StageInputControllerOptions = {
  documentId: string;
  viewport: HTMLElement;
  zoom: ZoomCapability;
  viewportCapability: ViewportCapability;
  scrollCapability?: ScrollCapability | null;
  interactionManager?: InteractionManagerCapability | null;
  stage?: ViewerStage | null;
  selection?: {
    begin(clientX: number, clientY: number): boolean;
    update(clientX: number, clientY: number): void;
    end(): void;
  } | null;
  isPanMode(): boolean;
  commitZoom(apply: () => void): void;
};

export type StageInputController = {
  drag(state: DragInputState): void;
  pinch(state: PinchInputState): void;
  cancel(): void;
  dispose(): void;
  /** Exposed for diagnostics and state-transition tests, not application state. */
  getPointerGesture(): PointerGesture['type'];
};

const TOUCH_INTERACTIVE_TARGET_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="slider"]',
  '[role="tab"]',
  '[data-comment-annotation-id]',
  '[style*="cursor: pointer"]',
].join(',');

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

function isInteractiveTouchTarget(target: Element) {
  return Boolean(
    target.closest(TOUCH_INTERACTIVE_TARGET_SELECTOR)
    || window.getComputedStyle(target).cursor === 'pointer'
  );
}

function hasViewportTextSelection(viewport: Element) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return false;
  return Boolean(
    (selection.anchorNode && viewport.contains(selection.anchorNode))
    || (selection.focusNode && viewport.contains(selection.focusNode))
  );
}

function isTouchGesture(
  gesture: PointerGesture,
): gesture is Extract<PointerGesture, { type: `touch-${string}` }> {
  return gesture.type === 'touch-pending'
    || gesture.type === 'touch-pan'
    || gesture.type === 'touch-selection';
}

/**
 * Owns browser input for one stage surface. React only supplies capabilities
 * and forwards normalized drag/pinch samples from @use-gesture/react.
 */
export function createStageInputController({
  documentId,
  viewport,
  zoom,
  viewportCapability,
  scrollCapability,
  interactionManager,
  stage,
  selection,
  isPanMode,
  commitZoom,
}: StageInputControllerOptions): StageInputController {
  const zoomScope = zoom.forDocument(documentId);
  const viewportScope = viewportCapability.forDocument(documentId);
  const interactionScope = interactionManager?.forDocument(documentId);
  let pointerGesture: PointerGesture = { type: 'idle' };
  let zoomFrame = 0;
  let scrollFrame = 0;
  let inertiaFrame = 0;
  let wheelEndTimer = 0;
  let pendingZoom: PendingZoom | null = null;
  let pendingScroll: { left: number; top: number } | null = null;
  let zoomSession: {
    detents: ZoomDetents;
    nodes: number[];
    lastAppliedZoom: number;
  } | null = null;
  let dragActivity: ViewerActivitySession | null = null;
  let pinchActivity: ViewerActivitySession | null = null;
  let wheelActivity: ViewerActivitySession | null = null;
  let disposed = false;

  const transition = (action: PointerGestureAction) => {
    pointerGesture = reducePointerGesture(pointerGesture, action);
  };

  const getZoomNodes = () => {
    const spreads = scrollCapability?.forDocument(documentId).getSpreadPagesWithRotatedSize();
    if (!spreads?.length) return [];
    const gap = scrollCapability?.getPageGap() ?? 0;
    const inset = 2 * viewportCapability.getViewportGap();
    const metrics = viewportScope.getMetrics();
    let width = 0;
    let height = 0;
    for (const spread of spreads) {
      width = Math.max(width, spread.reduce((sum, page, index) =>
        sum + page.rotatedSize.width + (index ? gap : 0), 0));
      for (const page of spread) height = Math.max(height, page.rotatedSize.height);
    }
    const fitWidth = (metrics.clientWidth - inset) / width;
    const fitPage = Math.min(fitWidth, (metrics.clientHeight - inset) / height);
    return [fitPage, fitWidth].map((value) => Math.floor(value * 1000) / 1000);
  };

  const resumeInteraction = (gesture: PointerGesture) => {
    if (isTouchGesture(gesture) && gesture.interactionPaused) {
      interactionScope?.resume();
      gesture.interactionPaused = false;
    }
  };

  const releasePointerGesture = (cancel = false) => {
    const gesture = pointerGesture;
    if (isTouchGesture(gesture)) {
      window.clearTimeout(gesture.timer);
      resumeInteraction(gesture);
    }
    if (gesture.type === 'touch-selection') selection?.end();
    if (gesture.type === 'mouse-pan') delete viewport.dataset.pdfPanning;
    if (cancel && 'cancel' in gesture) gesture.cancel();
    transition({ type: 'end' });
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

  const getAnchor = (clientX: number, clientY: number) => {
    const bounds = viewport.getBoundingClientRect();
    return {
      vx: clamp(clientX - bounds.left, 0, viewport.clientWidth),
      vy: clamp(clientY - bounds.top, 0, viewport.clientHeight),
    };
  };

  const queueZoom = (delta: number, clientX: number, clientY: number) => {
    pendingZoom = mergePendingZoom(pendingZoom, delta, getAnchor(clientX, clientY));
    if (!zoomFrame) zoomFrame = window.requestAnimationFrame(flushZoom);
  };

  const flushZoom = () => {
    zoomFrame = 0;
    const pending = pendingZoom;
    pendingZoom = null;
    if (!pending) return;

    const currentZoom = zoomScope.getState().currentZoomLevel;
    if (!zoomSession || currentZoom !== zoomSession.lastAppliedZoom) {
      zoomSession = {
        detents: new ZoomDetents(currentZoom),
        nodes: getZoomNodes(),
        lastAppliedZoom: currentZoom,
      };
    }
    const targetZoom = clamp(
      zoomSession.detents.move(pending.delta, zoomSession.nodes),
      MIN_ZOOM_LEVEL,
      MAX_ZOOM_LEVEL,
    );
    if (Math.abs(targetZoom - currentZoom) < 0.0005) return;

    commitZoom(() => zoomScope.requestZoom(targetZoom + 1e-10, pending.anchor));
    zoomSession.lastAppliedZoom = zoomScope.getState().currentZoomLevel;
    const metrics = viewportScope.getMetrics();
    viewport.scrollTo(metrics.scrollLeft, metrics.scrollTop);
    scrollTo(metrics.scrollLeft, metrics.scrollTop);
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
    const zooming = event.ctrlKey || event.metaKey;
    const overViewport = event.composedPath().includes(viewport);
    if (!zooming && !overViewport) return;
    stage?.cancelPendingNavigation();
    cancelInertia();
    const path = zooming
      ? ['Viewport', 'Zoom'] as const
      : ['Viewport', 'Scroll'] as const;
    if (!wheelActivity) wheelActivity = viewerActivity.begin('Wheel', path);
    else wheelActivity.update(path);
    if (wheelEndTimer) window.clearTimeout(wheelEndTimer);
    wheelEndTimer = window.setTimeout(() => {
      wheelEndTimer = 0;
      wheelActivity?.end();
      wheelActivity = null;
      flushPendingZoom();
      zoomSession = null;
    }, 120);
    if (zooming) {
      event.preventDefault();
      flushPendingScroll();
      queueZoom(
        -normalizedZoomDelta(event, viewport.clientHeight) * WHEEL_ZOOM_SENSITIVITY,
        event.clientX,
        event.clientY,
      );
      return;
    }

    flushPendingZoom();
    zoomSession = null;
    flushPendingScroll();
  };

  const pinch = (state: PinchInputState) => {
    const { event, first, last, canceled, movement, origin } = state;
    event.preventDefault();
    if (first) {
      stage?.cancelPendingNavigation();
      cancelInertia();
      releasePointerGesture(true);
      dragActivity?.end();
      dragActivity = null;
      flushPendingInput();
      pendingZoom = null;
      transition({ type: 'begin-pinch' });
      zoomSession = null;
      viewerActivity.controls('hide', 'Touch', ['Viewport', 'Zoom']);
      pinchActivity = viewerActivity.begin('Touch', ['Viewport', 'Zoom']);
    }

    if (pointerGesture.type === 'pinch' && !canceled) {
      if (movement[0] > 0) {
        queueZoom(
          Math.log(movement[0] / pointerGesture.lastScale) * PINCH_ZOOM_GAIN,
          origin[0],
          origin[1],
        );
        transition({ type: 'set-pinch-scale', scale: movement[0] });
      }
    }

    if (last || canceled) {
      flushPendingZoom();
      zoomSession = null;
      transition({ type: 'end' });
      pinchActivity?.end();
      pinchActivity = null;
    }
  };

  const drag = (state: DragInputState) => {
    const { event, first, last, movement, velocity, direction, canceled, cancel } = state;
    if (first) {
      stage?.cancelPendingNavigation();
      cancelInertia();
    }

    if (event.pointerType === 'touch') {
      if (first) {
        if (event.button !== 0 || pointerGesture.type !== 'idle') {
          cancel();
          return;
        }
        if (interactionScope?.activeModeIsExclusive()) {
          cancel();
          return;
        }

        const target = event.target instanceof Element ? event.target : viewport;
        if (isInteractiveTouchTarget(target) || hasViewportTextSelection(viewport)) {
          cancel();
          return;
        }
        const interactionPaused = Boolean(interactionScope && !interactionScope.isPaused());
        if (interactionPaused) interactionScope?.pause();
        flushPendingInput();
        const gesture: TouchGesture = {
          pointerId: event.pointerId,
          pointerX: event.clientX,
          pointerY: event.clientY,
          target,
          timer: 0,
          interactionPaused,
          scrollLeft: viewport.scrollLeft,
          scrollTop: viewport.scrollTop,
          cancel,
        };
        gesture.timer = window.setTimeout(() => {
          if (pointerGesture.type !== 'touch-pending'
            || pointerGesture.pointerId !== event.pointerId) return;
          if (!pointerGesture.target.isConnected) {
            resumeInteraction(pointerGesture);
            transition({ type: 'end' });
            return;
          }
          const activeGesture = pointerGesture;
          resumeInteraction(activeGesture);
          if (selection?.begin(activeGesture.pointerX, activeGesture.pointerY)) {
            transition({ type: 'touch-selection' });
          } else {
            transition({ type: 'end' });
          }
        }, TOUCH_LONG_PRESS_DELAY_MS);
        transition({ type: 'begin-touch', gesture });
      }

      if (pointerGesture.type === 'touch-pending') {
        const [deltaX, deltaY] = movement;
        if (deltaX * deltaX + deltaY * deltaY >= TOUCH_PAN_THRESHOLD_PX ** 2) {
          window.clearTimeout(pointerGesture.timer);
          transition({ type: 'touch-pan' });
          viewerActivity.controls('hide', 'Touch', ['Viewport', 'Pan']);
          dragActivity = viewerActivity.begin(pointerInputSource(event), ['Viewport', 'Pan']);
        }
      }
      if (pointerGesture.type === 'touch-pan') {
        event.preventDefault();
        event.stopPropagation();
        scrollTo(
          pointerGesture.scrollLeft - movement[0],
          pointerGesture.scrollTop - movement[1],
        );
      }
      if (pointerGesture.type === 'touch-selection') {
        event.preventDefault();
        event.stopPropagation();
        selection?.update(event.clientX, event.clientY);
      }
      if (last) {
        const completed = releasePointerGesture();
        if (completed.type === 'touch-pending' && !canceled) {
          viewerActivity.controls('toggle', 'Touch', ['Viewport', 'Tap']);
        }
        if (completed.type === 'touch-pan' && !canceled) {
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
      const startedByToolbarPan = isPanMode() && event.button === 0;
      if ((!startedByMiddleMouse && !startedByToolbarPan) || pointerGesture.type !== 'idle') {
        cancel();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      flushPendingInput();
      transition({
        type: 'begin-mouse',
        gesture: {
          scrollLeft: viewport.scrollLeft,
          scrollTop: viewport.scrollTop,
          dragging: false,
          cancel,
        },
      });
      viewport.dataset.pdfPanning = 'true';
      dragActivity = viewerActivity.begin(pointerInputSource(event), ['Viewport', 'Pan']);
    }

    if (pointerGesture.type !== 'mouse-pan') return;
    event.preventDefault();
    event.stopPropagation();
    const [deltaX, deltaY] = movement;
    if (!pointerGesture.dragging
      && deltaX * deltaX + deltaY * deltaY >= PAN_DRAG_THRESHOLD_PX ** 2) {
      transition({ type: 'set-mouse-dragging' });
    }
    if (pointerGesture.type === 'mouse-pan' && pointerGesture.dragging) {
      scrollTo(pointerGesture.scrollLeft - deltaX, pointerGesture.scrollTop - deltaY);
    }
    if (last) {
      const completed = releasePointerGesture();
      if (completed.type === 'mouse-pan' && !completed.dragging) {
        scrollTo(completed.scrollLeft, completed.scrollTop);
      }
      dragActivity?.end();
      dragActivity = null;
    }
  };

  const stopMiddleMouseDefault = (event: MouseEvent) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const cancel = () => {
    stage?.cancelPendingNavigation();
    if (zoomFrame) window.cancelAnimationFrame(zoomFrame);
    if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
    zoomFrame = scrollFrame = 0;
    pendingZoom = null;
    zoomSession = null;
    pendingScroll = null;
    if (wheelEndTimer) window.clearTimeout(wheelEndTimer);
    wheelEndTimer = 0;
    cancelInertia();
    releasePointerGesture(true);
    dragActivity?.end();
    dragActivity = null;
    pinchActivity?.end();
    pinchActivity = null;
    wheelActivity?.end();
    wheelActivity = null;
  };

  window.addEventListener('wheel', handleWheel, { capture: true, passive: false });
  viewport.addEventListener('mousedown', stopMiddleMouseDefault, { capture: true });
  viewport.addEventListener('auxclick', stopMiddleMouseDefault, { capture: true });
  window.addEventListener('blur', cancel);

  return {
    drag,
    pinch,
    cancel,
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener('wheel', handleWheel, { capture: true });
      viewport.removeEventListener('mousedown', stopMiddleMouseDefault, { capture: true });
      viewport.removeEventListener('auxclick', stopMiddleMouseDefault, { capture: true });
      window.removeEventListener('blur', cancel);
      cancel();
    },
    getPointerGesture: () => pointerGesture.type,
  };
}
