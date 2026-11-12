import type { StageHostCapability } from '@embedpdf/plugin-stage/contract/host';
import type { RenderHostCapability } from '@embedpdf/plugin-render/contract/host';
import type { PageRef } from '@embedpdf/core';

const layers = { includeAnnotations: false, includeFormFields: false } as const;
const whenIdle = (run: () => void) => {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(run);
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(run, 0);
  return () => clearTimeout(id);
};

const nextFrame = (run: () => void) => {
  const id = requestAnimationFrame(run);
  return () => cancelAnimationFrame(id);
};

/** Warm one ordinary base-cache entry, without mounting any offscreen layers. */
export function installPagePrefetch(stage: StageHostCapability, render: RenderHostCapability,
  subscribe: (update: () => void) => () => void, idle = whenIdle, frame = nextFrame) {
  const lens = stage.getLensId();
  const tiles = render.createViewDemand(lens);
  let direction = 1;
  let previous = stage.getCamera();
  let previousPage = stage.getCurrentPageIndex();
  let attempted: string | undefined;
  let active: { controller: AbortController; page: PageRef; key: string } | undefined;
  let cancelIdle: (() => void) | undefined;
  const cancel = () => {
    cancelIdle?.(); cancelIdle = undefined;
    if (active) { active.controller.abort(); active = undefined; attempted = undefined; }
  };
  // If the neighbour has entered the viewport, let the ordinary foreground
  // consumer join its in-flight cache entry rather than aborting and restarting it.
  const foregroundOwns = () => {
    if (!active) return false;
    const page = stage.getPageBox(active.page);
    return !!page && page.visibleRect.width > 0 && page.visibleRect.height > 0 &&
      render.getSourceKey(active.page, { scale: page.transform.renderScale, ...layers }) === active.key;
  };
  const candidate = () => {
    if (document.hidden || stage.isMoving()) return null;
    const visible = stage.listVisiblePages().filter(page => page.visibleRect.width > 0 && page.visibleRect.height > 0);
    if (!visible.length || visible.some(page => render.getPictureState(page.ref, lens).status !== 'ready' || tiles.isPending(page.ref))) return null;
    const indices = visible.map(page => page.pageIndex);
    const index = (direction > 0 ? Math.max(...indices) : Math.min(...indices)) + direction;
    if (index < 0 || index >= stage.getPageCount()) return null;
    const page = stage.getPageBox(index);
    if (!page) return null;
    const options = { scale: page.transform.renderScale, view: lens, ...layers };
    return { page: page.ref, options, key: render.getSourceKey(page.ref, options) };
  };
  const update = () => {
    const next = candidate();
    if (!next) { if (document.hidden || !foregroundOwns()) cancel(); return; }
    if (attempted === next.key) return;
    if (active) cancel();
    if (cancelIdle) return;
    cancelIdle = idle(() => {
      cancelIdle = undefined;
      // Recheck after yielding: foreground demand may have arrived in the meantime.
      const latest = candidate();
      if (!latest) return;
      attempted = latest.key;
      const controller = new AbortController();
      active = { controller, page: latest.page, key: latest.key };
      void render.renderSource(latest.page, { ...latest.options, signal: controller.signal })
        .catch(() => {}) // Speculation must not turn a failed neighbour into a viewer error.
        .finally(() => { if (active?.controller === controller) active = undefined; });
    });
  };
  const offCamera = stage.onCameraChanged(() => {
    const camera = stage.getCamera();
    const page = stage.getCurrentPageIndex();
    const settings = stage.getSettings();
    const delta = settings.layout === 'horizontal'
      ? (camera.x - previous.x) * (settings.direction === 'rtl' ? -1 : 1)
      : camera.y - previous.y;
    if (camera.zoom === previous.zoom) direction = Math.sign(page - previousPage || delta) || direction;
    previous = camera; previousPage = page;
    if (!foregroundOwns()) cancel();
    update();
  });
  // Kernel notifications include tile presentation, which has no separate SDK event.
  // Coalesce idle checks, but keep cancellation of in-flight speculation immediate.
  let cancelFrame: (() => void) | undefined;
  const off = subscribe(() => {
    if (active) { update(); return; }
    cancelFrame ??= frame(() => { cancelFrame = undefined; update(); });
  });
  const offMotion = stage.onMotionEnded(update);
  document.addEventListener('visibilitychange', update);
  update();
  return () => {
    offCamera(); offMotion(); off();
    document.removeEventListener('visibilitychange', update);
    cancelFrame?.(); cancel(); tiles.destroy();
  };
}
