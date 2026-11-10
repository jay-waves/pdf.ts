import type { StageCapability } from '@embedpdf/plugin-stage';

/** Hold the wheel to pan without changing the selected drawing/selection tool. */
export function installMiddleButtonPan(viewport: HTMLElement, stage: StageCapability) {
  let drag: { id: number; x: number; y: number } | null = null;
  const cancel = () => {
    const active = drag;
    drag = null;
    viewport.removeAttribute('data-pdf-middle-panning');
    if (active && viewport.hasPointerCapture(active.id)) viewport.releasePointerCapture(active.id);
  };
  const down = (event: PointerEvent) => {
    if (event.button !== 1 || event.pointerType !== 'mouse' || event.buttons !== 4
      || !event.composedPath().includes(viewport)) return;
    if (event.target instanceof Element && event.target.closest('input, textarea, select, button, [contenteditable="true"], [role="scrollbar"]')) return;
    cancel();
    stage.stopMotion();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    viewport.setPointerCapture(event.pointerId);
    viewport.setAttribute('data-pdf-middle-panning', 'true');
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const move = (event: PointerEvent) => {
    if (!drag || drag.id !== event.pointerId) return;
    if (event.buttons !== 4) { cancel(); return; }
    stage.panBy(event.clientX - drag.x, event.clientY - drag.y);
    drag.x = event.clientX; drag.y = event.clientY;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const up = (event: PointerEvent) => {
    if (drag?.id !== event.pointerId) return;
    cancel();
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const aux = (event: MouseEvent) => {
    if (event.button !== 1 || !event.composedPath().includes(viewport)) return;
    event.preventDefault();
  };
  const key = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
  const options = { capture: true, passive: false };
  window.addEventListener('pointerdown', down, options);
  window.addEventListener('pointermove', move, options);
  window.addEventListener('pointerup', up, options);
  window.addEventListener('pointercancel', up, options);
  viewport.addEventListener('lostpointercapture', cancel);
  window.addEventListener('auxclick', aux, options);
  window.addEventListener('blur', cancel);
  window.addEventListener('keydown', key, options);
  return () => {
    cancel();
    window.removeEventListener('pointerdown', down, options);
    window.removeEventListener('pointermove', move, options);
    window.removeEventListener('pointerup', up, options);
    window.removeEventListener('pointercancel', up, options);
    viewport.removeEventListener('lostpointercapture', cancel);
    window.removeEventListener('auxclick', aux, options);
    window.removeEventListener('blur', cancel);
    window.removeEventListener('keydown', key, options);
  };
}
