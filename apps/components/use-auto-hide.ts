import { useCallback, useEffect, useRef, useState } from 'react';
import { viewerActivity } from '../viewer/viewer-activity';
import type { ViewerActivityAudience } from '../viewer/viewer-activity';

function useAutoHide(shouldHide: () => boolean, delay = 900) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef(0);
  const shouldHideRef = useRef(shouldHide);
  shouldHideRef.current = shouldHide;

  const clearTimer = useCallback(() => {
    if (!timerRef.current) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = 0;
  }, []);

  const reveal = useCallback(() => {
    clearTimer();
    setVisible(true);
  }, [clearTimer]);

  const hide = useCallback(() => {
    clearTimer();
    setVisible(false);
  }, [clearTimer]);

  const toggle = useCallback(() => {
    clearTimer();
    setVisible((current) => !current);
  }, [clearTimer]);

  const scheduleHide = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = 0;
      if (shouldHideRef.current()) setVisible(false);
    }, delay);
  }, [delay]);

  useEffect(() => clearTimer, [clearTimer]);

  return { visible, reveal, hide, toggle, scheduleHide };
}

export function useViewerActivityAutoHide(
  audience: Exclude<ViewerActivityAudience, 'all'>,
  shouldHide: () => boolean,
  delay = 900,
) {
  const visibility = useAutoHide(shouldHide, delay);
  const { reveal, hide, toggle, scheduleHide } = visibility;

  useEffect(() => {
    const activeSessions = new Set<number>();
    return viewerActivity.onEvent((event) => {
      if (event.audience !== 'all' && event.audience !== audience) return;
      if (event.phase === 'toggle-controls') {
        toggle();
        return;
      }
      if (event.phase === 'hide-controls') {
        hide();
        return;
      }

      // Viewport gestures never summon chrome: mouse users have edge hover and
      // touch users have tap-to-toggle. Touch gestures additionally clear any
      // chrome that is already visible.
      if (
        event.path[0] === 'Viewport'
        && (event.path[1] === 'Scroll' || event.path[1] === 'Pan' || event.path[1] === 'Zoom')
      ) {
        if (event.source === 'Touch') hide();
        return;
      }
      if (event.phase === 'start') activeSessions.add(event.id);
      if (event.phase === 'end') activeSessions.delete(event.id);

      if (event.phase === 'end' && activeSessions.size === 0) scheduleHide();
      else reveal();
    });
  }, [hide, reveal, scheduleHide, toggle]);

  return visibility;
}
