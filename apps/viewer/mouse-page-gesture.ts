const DRAG_THRESHOLD = 8;
const PAGE_THRESHOLD = 60;

type Gesture = {
  pointerId: number;
  target: Element;
  x: number;
  y: number;
  dx: number;
  dy: number;
  dragged: boolean;
  menu: MouseEvent | null;
};

/** Capture before PDF selection handlers; navigation still goes through the app command. */
export function installMousePageGesture(
  canStart: (target: EventTarget | null) => boolean,
  navigate: (delta: -1 | 1) => void,
) {
  let gesture: Gesture | null = null;
  let suppressMenuUntil = 0;
  let replayedMenu: Event | null = null;

  const update = (event: PointerEvent, active: Gesture) => {
    active.dx = event.clientX - active.x;
    active.dy = event.clientY - active.y;
    active.dragged ||= Math.hypot(active.dx, active.dy) >= DRAG_THRESHOLD;
  };

  const cancel = () => {
    if (!gesture) return false;
    gesture = null;
    suppressMenuUntil = performance.now() + 750;
    return true;
  };

  const onDown = (event: PointerEvent) => {
    if (event.button !== 2) {
      cancel();
      return;
    }
    gesture = null;
    suppressMenuUntil = 0;
    if (event.defaultPrevented || event.pointerType !== 'mouse' || event.buttons !== 2
      || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
      || !(event.target instanceof Element) || !canStart(event.target)) return;
    gesture = {
      pointerId: event.pointerId, target: event.target,
      x: event.clientX, y: event.clientY, dx: 0, dy: 0, dragged: false, menu: null,
    };
    // Keep a right drag from clearing selected text or beginning an annotation.
    event.stopPropagation();
  };

  const onMove = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (event.buttons !== 2) {
      cancel();
      return;
    }
    update(event, gesture);
    if (gesture.dragged) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const onUp = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.pointerId || event.button !== 2) return;
    const active = gesture;
    update(event, active);
    gesture = null;
    event.stopPropagation();
    if (active.dragged || active.menu) suppressMenuUntil = performance.now() + 750;
    if (active.dragged) {
      event.preventDefault();
      if (Math.abs(active.dx) >= PAGE_THRESHOLD && Math.abs(active.dx) >= Math.abs(active.dy) * 1.5
        && canStart(active.target)) navigate(active.dx < 0 ? 1 : -1);
    } else if (active.menu && active.target.isConnected) {
      // Some platforms emit contextmenu on press. Defer it until we know this is a click.
      const menu = active.menu;
      const replay = new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, composed: true, button: 2,
        clientX: menu.clientX, clientY: menu.clientY,
        screenX: menu.screenX, screenY: menu.screenY,
      });
      replayedMenu = replay;
      try { active.target.dispatchEvent(replay); }
      finally { replayedMenu = null; }
    }
  };

  const onMenu = (event: MouseEvent) => {
    if (event === replayedMenu || event.button !== 2) return;
    if (gesture) gesture.menu = event;
    else if (performance.now() >= suppressMenuUntil || !canStart(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const onCancel = (event: PointerEvent) => {
    if (event.pointerId === gesture?.pointerId) cancel();
  };
  const onBlur = () => { cancel(); };
  const options = { capture: true, passive: false };
  window.addEventListener('pointerdown', onDown, options);
  window.addEventListener('pointermove', onMove, options);
  window.addEventListener('pointerup', onUp, options);
  window.addEventListener('pointercancel', onCancel, options);
  window.addEventListener('contextmenu', onMenu, options);
  window.addEventListener('blur', onBlur);

  return {
    cancel,
    dispose() {
      gesture = null;
      window.removeEventListener('pointerdown', onDown, options);
      window.removeEventListener('pointermove', onMove, options);
      window.removeEventListener('pointerup', onUp, options);
      window.removeEventListener('pointercancel', onCancel, options);
      window.removeEventListener('contextmenu', onMenu, options);
      window.removeEventListener('blur', onBlur);
    },
  };
}
