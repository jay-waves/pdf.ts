type ControlsAction = 'show' | 'hide' | 'toggle';
const listeners = new Set<(action: ControlsAction) => void>();

/** Only explicit control visibility requests cross component boundaries. */
export const viewerControls = {
  subscribe(listener: (action: ControlsAction) => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  show() { listeners.forEach(listener => listener('show')); },
  hide() { listeners.forEach(listener => listener('hide')); },
  toggle() { listeners.forEach(listener => listener('toggle')); },
};
