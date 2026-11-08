/**
 * Application wheel policy over native Stage capabilities: frame-coalesced zoom
 * with fit detents, plus one damped vertical-scroll path. Prevent duplicate native
 * handling; reduced-motion preferences disable easing. Accept only the capabilities
 * used here, without depending on the viewer controller.
 */
import type { StageCapability } from '@embedpdf/plugin-stage';
import { ZoomDetents } from './zoom-detents';
import { clientPointToViewport } from './viewport-geometry';

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
export function installStageWheelZoom(viewport: HTMLElement, native: StageCapability, stage?: { getFitScales(): { page: number; width: number } | null } | null) {
  let pending: PendingZoom | null = null;
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let detents: ZoomDetents | null = null;
  let lastLevel = 0;
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
    detents = null;
  };
  const wheel = (event: WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return;
    if (!event.composedPath().includes(viewport)) return;
    event.preventDefault(); event.stopPropagation();
    native.stopMotion();
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

/** Keep vertical wheel input on one smooth path, regardless of browser delta units. */
export function installStageWheelScroll(viewport: HTMLElement, native: StageCapability) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let remaining = 0;
  let velocity = 0;
  let frame = 0;
  let lastTime = 0;
  const cancel = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0; remaining = 0; velocity = 0; lastTime = 0;
  };
  const tick = (now: number) => {
    const elapsed = Math.min(64, Math.max(0, now - lastTime));
    if (!elapsed) { frame = requestAnimationFrame(tick); return; }
    lastTime = now;
    // Critically damped motion: retain velocity when another notch arrives.
    // Unlike exponential easing, a new target does not instantly jump speed.
    const omega = .022;
    const decay = Math.exp(-omega * elapsed);
    const slope = omega * remaining - velocity;
    let next = (remaining + slope * elapsed) * decay;
    velocity = (velocity + omega * slope * elapsed) * decay;
    if (Math.abs(next) < .25 && Math.abs(velocity) < .01) next = 0;
    const amount = remaining - next;
    remaining = next;
    const before = native.getCamera();
    native.scrollBy(native.getSettings().layout === 'horizontal'
      ? { left: amount, behavior: 'instant' } : { top: amount, behavior: 'instant' });
    const after = native.getCamera();
    if (!remaining || (before.x === after.x && before.y === after.y)) { cancel(); return; }
    frame = requestAnimationFrame(tick);
  };
  const wheel = (event: WheelEvent) => {
    if (!event.composedPath().includes(viewport)) return;
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey
      || reducedMotion.matches || native.getSettings().flow === 'paged'
      || event.composedPath().some(target => target instanceof Element && target.matches('input, textarea, select, [contenteditable="true"]'))) {
      cancel(); return;
    }
    const now = performance.now();
    if (event.deltaX || !event.deltaY) { cancel(); return; }
    event.preventDefault(); event.stopPropagation();
    const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
    const distance = event.deltaY * multiplier;
    if (remaining && Math.sign(distance) !== Math.sign(remaining)) { remaining = 0; velocity = 0; }
    remaining += distance;
    // Bound the tail while spinning a free-running mouse wheel.
    remaining = Math.max(-viewport.clientHeight, Math.min(viewport.clientHeight, remaining));
    if (!frame) { native.stopMotion(); lastTime = now; frame = requestAnimationFrame(tick); }
  };
  window.addEventListener('wheel', wheel, { capture: true, passive: false });
  window.addEventListener('pointerdown', cancel, { capture: true });
  window.addEventListener('keydown', cancel, { capture: true });
  window.addEventListener('blur', cancel);
  reducedMotion.addEventListener('change', cancel);
  const offSettings = native.onSettingsChanged(cancel);
  return () => {
    cancel();
    window.removeEventListener('wheel', wheel, { capture: true });
    window.removeEventListener('pointerdown', cancel, { capture: true });
    window.removeEventListener('keydown', cancel, { capture: true });
    window.removeEventListener('blur', cancel);
    reducedMotion.removeEventListener('change', cancel);
    offSettings();
  };
}
