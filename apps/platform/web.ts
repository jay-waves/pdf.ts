import { browserPersistence } from './browser-storage';
import { browserLocalDocumentCapabilities } from './browser-local-document';
import { translateWithInstalledModel } from './browser-translation';
import type { ViewerPlatform } from './types';
import { getExternalUrl } from '../shared/url';

export const platform: ViewerPlatform = {
  async loadViewerResources(bundledWasmUrl) {
    return {
      wasm: { url: bundledWasmUrl },
    };
  },
  ...browserLocalDocumentCapabilities,
  openExternal(url) {
    const target = getExternalUrl(url, window.location.href);
    if (target) window.open(target, '_blank', 'noopener,noreferrer');
  },
  translate: translateWithInstalledModel,
  ...browserPersistence,
};
