import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { StageCapability } from '@embedpdf/plugin-stage';
import { energySavingEnabled, energySavingStore } from './energy-saving';

const TilesPaused = createContext(false);
export const useEnergyTilesPaused = () => useContext(TilesPaused);

/** Camera events cover wheel, touch momentum, scrollbar drags and navigation. */
export function EnergySavingMotion({ stage, children }: { stage: StageCapability; children: ReactNode }) {
  const saving = useStore(energySavingStore, energySavingEnabled);
  const [moving, setMoving] = useState(false);
  useLayoutEffect(() => {
    setMoving(false);
    if (!saving) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = stage.onCameraChanged(() => {
      setMoving(true);
      clearTimeout(timer);
      // One trailing wait; resolved tiles remain visible while new work pauses.
      timer = setTimeout(() => setMoving(false), 120);
    });
    return () => { off(); clearTimeout(timer); };
  }, [stage, saving]);
  return <TilesPaused.Provider value={saving && moving}>{children}</TilesPaused.Provider>;
}
