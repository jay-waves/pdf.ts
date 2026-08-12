import { useCallback, useEffect, useRef, useState } from 'react';
import { viewerActivity } from '../viewer-activity';
import type { ViewerActivityAudience } from '../viewer-activity';

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

  const scheduleHide = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = 0;
      if (shouldHideRef.current()) setVisible(false);
    }, delay);
  }, [delay]);

  useEffect(() => clearTimer, [clearTimer]);

  return { visible, reveal, scheduleHide };
}

export function useViewerActivityAutoHide(
  audience: Exclude<ViewerActivityAudience, 'all'>,
  shouldHide: () => boolean,
  delay = 900,
) {
  const visibility = useAutoHide(shouldHide, delay);
  const { reveal, scheduleHide } = visibility;

  useEffect(() => {
    const activeSessions = new Set<number>();
    return viewerActivity.onEvent((event) => {
      if (event.audience !== 'all' && event.audience !== audience) return;
      if (event.phase === 'start') activeSessions.add(event.id);
      if (event.phase === 'end') activeSessions.delete(event.id);

      if (event.phase === 'end' && activeSessions.size === 0) scheduleHide();
      else reveal();
    });
  }, [reveal, scheduleHide]);

  return visibility;
}
