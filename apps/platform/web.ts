import { browserCapabilities } from './browser-capabilities';
import type { ViewerPlatform } from './types';

export const platform: ViewerPlatform = {
  ...browserCapabilities,
  async loadViewerResources(bundledWasmUrl) {
    return {
      wasm: { url: bundledWasmUrl },
    };
  },
};
