import { energySavingEnabled, energySavingStore, ENERGY_PREFERENCE_KEY } from './energy-saving';
import { createStore } from 'zustand/vanilla';
import { platform } from '#platform';

export type RenderDprMode = 'auto' | '1.25' | '1.5' | '1.75' | 'system';

const AUTO_DPR_LIMIT = 1.75;
const RENDER_DPR_STORAGE_KEY = 'pdf-viewer-render-dpr-v1';
export const PDF_TILE_SIZE_CSS_PX = 768;

function getStoredRenderDprMode(): RenderDprMode {
  const mode = platform.getPreference(RENDER_DPR_STORAGE_KEY);
  return mode === '1.25' || mode === '1.5' || mode === '1.75' || mode === 'system'
    ? mode
    : 'auto';
}

export function getSystemDpr() {
  return window.devicePixelRatio || 1;
}

export const renderSettingsStore = createStore<{
  systemDpr: number;
  dprMode: RenderDprMode;
}>(() => ({
  systemDpr: getSystemDpr(),
  dprMode: getStoredRenderDprMode(),
}));

export function getEffectiveRenderDpr(
  mode = renderSettingsStore.getState().dprMode,
  systemDpr = renderSettingsStore.getState().systemDpr,
  energySaving = energySavingEnabled(),
) {
  if (energySaving) return 1.25;
  if (mode === 'auto') return Math.min(systemDpr, AUTO_DPR_LIMIT);
  if (mode === 'system') return systemDpr;
  return Number(mode);
}

export function setRenderDprMode(mode: RenderDprMode) {
  platform.setPreference(RENDER_DPR_STORAGE_KEY, mode);
  renderSettingsStore.setState({ dprMode: mode });
}

export function installRenderDprMonitor() {
  let query: MediaQueryList;
  const update = () => {
    query?.removeEventListener('change', update);
    const systemDpr = getSystemDpr();
    renderSettingsStore.setState({ systemDpr });
    query = window.matchMedia(`(resolution: ${systemDpr}dppx)`);
    query.addEventListener('change', update);
  };
  const synchronize = (event: StorageEvent) => {
    if (event.key === RENDER_DPR_STORAGE_KEY || event.key === null) {
      renderSettingsStore.setState({ dprMode: getStoredRenderDprMode() });
    }
    if (event.key === ENERGY_PREFERENCE_KEY || event.key === null) {
      const value = platform.getPreference(ENERGY_PREFERENCE_KEY);
      energySavingStore.setState({ preference: value === 'on' || value === 'off' ? value : 'auto' });
    }
  };
  update();
  window.addEventListener('storage', synchronize);
  return () => { query.removeEventListener('change', update); window.removeEventListener('storage', synchronize); };
}
