export type Insets = Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>;

/** Convert a wheel's client point to the Stage's viewport, including border offsets. */
export function clientPointToViewport(element: HTMLElement, clientX: number, clientY: number) {
  const bounds = element.getBoundingClientRect();
  return {
    vx: Math.max(0, Math.min(element.clientWidth, clientX - bounds.left - element.clientLeft)),
    vy: Math.max(0, Math.min(element.clientHeight, clientY - bounds.top - element.clientTop)),
  };
}
