import { browserAiCapabilities } from '../ai/browser-ai';
import { browserPersistence } from './browser-storage';
import { browserLocalDocumentCapabilities } from './browser-local-document';
import { getExternalUrl } from '../shared/url';
import type { ViewerPlatform } from './types';

/** Shared browser behavior. Adapters supply the document source and override
 * only platform-specific operations (e.g. extension tab navigation). */
export const browserCapabilities = {
  ...browserPersistence,
  ...browserLocalDocumentCapabilities,
  ai: browserAiCapabilities,
  openExternal(url: string) {
    const target = getExternalUrl(url, window.location.href);
    if (target) window.open(target, '_blank', 'noopener,noreferrer');
  },
} satisfies Omit<ViewerPlatform, 'loadViewerResources'>;
