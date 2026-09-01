import { browserPersistence } from './browser-storage';
import { browserLocalDocumentCapabilities } from './browser-local-document';
import { browserTranslationCapabilities } from './browser-translation';
import type { ViewerPlatform } from './types';
import { getExternalUrl } from '../shared/url';

export const platform: ViewerPlatform = {
  async loadViewerResources() {
    return { wasm: { url: '' } };
  },
  ...browserLocalDocumentCapabilities,
  openExternal(url) {
    const target = getExternalUrl(url, window.location.href);
    if (target) window.open(target, '_blank', 'noopener,noreferrer');
  },
  ...browserTranslationCapabilities,
  ...browserPersistence,
};
