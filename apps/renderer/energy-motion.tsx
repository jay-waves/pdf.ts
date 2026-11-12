import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode, type RefObject } from 'react';
import { useStore } from 'zustand';
import type { StageCapability } from '@embedpdf/plugin-stage';
import { energySavingEnabled, energySavingStore } from './energy-saving';

const TilesPaused = createContext(false);
export const useEnergyTilesPaused = () => useContext(TilesPaused);
const MotionEnd = createContext<Set<() => void> | null>(null);
export const useTileMotionEnd = () => useContext(MotionEnd);

/** Camera events cover wheel, touch momentum, scrollbar drags and navigation. */
export function EnergySavingMotion({ stage, surfaceRef, children }: { stage: StageCapability; surfaceRef: RefObject<HTMLElement | null>; children: ReactNode }) {
  const saving = useStore(energySavingStore, energySavingEnabled);
  const [moving, setMoving] = useState(false);
  const listeners = useMemo(() => new Set<() => void>(), []);
  useLayoutEffect(() => {
    setMoving(false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = saving ? stage.onCameraChanged(() => {
      setMoving(true);
      clearTimeout(timer);
      // One trailing wait; resolved tiles remain visible while new work pauses.
      timer = setTimeout(() => setMoving(false), 120);
    }) : () => {};
    let pointer: number | undefined;
    const down = (event: PointerEvent) => {
      if (event.target instanceof Element && surfaceRef.current?.contains(event.target) && event.target.closest('[data-embedpdf-scrollbar]')) pointer = event.pointerId;
    };
    const finish = () => {
      if (pointer === undefined) return;
      pointer = undefined;
      clearTimeout(timer);
      setMoving(false);
      for (const listener of [...listeners]) listener();
    };
    const up = (event: PointerEvent) => { if (event.pointerId === pointer) finish(); };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('blur', finish);
    return () => {
      off(); clearTimeout(timer);
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('blur', finish);
    };
  }, [stage, saving, surfaceRef, listeners]);
  return <MotionEnd.Provider value={listeners}><TilesPaused.Provider value={saving && moving}>{children}</TilesPaused.Provider></MotionEnd.Provider>;
}
