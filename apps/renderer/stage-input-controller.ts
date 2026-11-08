import type { StageCapability } from '@embedpdf/plugin-stage';
import type { ViewerStage } from '../viewer/viewer-stage';
import { ZoomDetents } from './zoom-detents';
import { clientPointToViewport } from './viewport-geometry';
import { viewerActivity } from '../viewer/viewer-activity';

export function installBrowserGestureZoomGuard() {
  const prevent = (event: Event) => event.preventDefault();
  window.addEventListener('gesturestart', prevent, { capture: true, passive: false });
  window.addEventListener('gesturechange', prevent, { capture: true, passive: false });
  return () => {
    window.removeEventListener('gesturestart', prevent, { capture: true });
    window.removeEventListener('gesturechange', prevent, { capture: true });
  };
}

export type PendingZoom = { delta: number; anchor: { vx: number; vy: number } };
export function mergePendingZoom(pending: PendingZoom | null, delta: number, anchor: PendingZoom['anchor']): PendingZoom {
  return { delta: (pending?.delta ?? 0) + delta, anchor };
}

/** Preserve our wheel sensitivity and fit detents; v3 owns pointer/pinch/pan lifetimes. */
export function installStageWheelZoom(viewport: HTMLElement, native: StageCapability, stage?: ViewerStage | null) {
  let pending: PendingZoom | null = null;
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let detents: ZoomDetents | null = null;
  let lastLevel = 0;
  let activity: ReturnType<typeof viewerActivity.begin> | null = null;
  const flush = () => {
    frame = 0;
    const move = pending; pending = null;
    if (!move) return;
    const current = native.getZoomLevel();
    if (!detents || current !== lastLevel) detents = new ZoomDetents(current);
    const fit = stage?.getFitScales();
    const nodes = fit ? [fit.page, fit.width].map(v => Math.floor(v * 1000) / 1000) : [];
    const next = detents.move(move.delta, nodes);
    native.zoomTo(next, { around: { x: move.anchor.vx, y: move.anchor.vy } });
    lastLevel = native.getZoomLevel();
  };
  const end = () => {
    clearTimeout(timer);
    if (frame) { cancelAnimationFrame(frame); flush(); }
    activity?.end(); activity = null; detents = null;
  };
  const wheel = (event: WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return;
    if (!event.composedPath().includes(viewport)) return;
    event.preventDefault(); event.stopPropagation();
    native.stopMotion();
    activity ??= viewerActivity.begin('Wheel', ['Viewport', 'Zoom']);
    const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
    const delta = -Math.max(-50, Math.min(50, event.deltaY * multiplier)) * .002;
    pending = mergePendingZoom(pending, delta, clientPointToViewport(viewport, event.clientX, event.clientY));
    if (!frame) frame = requestAnimationFrame(flush);
    clearTimeout(timer); timer = setTimeout(end, 120);
  };
  // Capture on window precedes the native Stage's listener and prevents a second zoom.
  window.addEventListener('wheel', wheel, { capture: true, passive: false });
  window.addEventListener('blur', end);
  return () => {
    window.removeEventListener('wheel', wheel, { capture: true });
    window.removeEventListener('blur', end);
    pending = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0; end();
  };
}
