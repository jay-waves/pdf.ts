import { useCallback, useEffect, useRef, useState } from 'react';
import { viewerControls } from './control-visibility';

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

  const scheduleHide = useCallback((timeout = delay) => {
    if (timerRef.current) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = 0;
      if (shouldHideRef.current()) setVisible(false);
    }, timeout);
  }, [delay]);

  useEffect(() => clearTimer, [clearTimer]);

  return { visible, reveal, hide, toggle, scheduleHide };
}

export function useViewerAutoHide(shouldHide: () => boolean, delay = 900) {
  const visibility = useAutoHide(shouldHide, delay);
  const { reveal, hide, toggle, scheduleHide } = visibility;
  useEffect(() => viewerControls.subscribe(action => {
    if (action === 'hide') hide();
    else if (action === 'toggle') { toggle(); scheduleHide(3000); }
    else { reveal(); scheduleHide(3000); }
  }), [reveal, hide, toggle, scheduleHide]);
  return visibility;
}
