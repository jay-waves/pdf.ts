import { useCallback, useEffect, useRef, useState } from 'react';

export function useAutoHide(shouldHide: () => boolean, delay = 900) {
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
