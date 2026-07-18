import {
  getPreference,
  readReadingHistoryStore,
  setPreference,
  writeReadingProgress,
} from './browser-storage';
import { blobResource } from './resources';
import type { ViewerPlatform } from './types';

export const documentEditingEnabled = true;

export const platform: ViewerPlatform = {
  async loadViewerResources(bundledWasmUrl) {
    return { wasm: { url: bundledWasmUrl } };
  },
  openLocalDocument(file) {
    return {
      resource: blobResource(file),
      key: `local:${file.name}:${file.size}:${file.lastModified}`,
      name: file.name,
    };
  },
  openExternal(url) {
    try {
      const target = new URL(url, window.location.href);
      if (target.protocol !== 'http:' && target.protocol !== 'https:') return;
      window.open(target.href, '_blank', 'noopener,noreferrer');
    } catch {
      // Ignore malformed or unsafe targets embedded in a PDF.
    }
  },
  getPreference,
  setPreference,
  async preparePdfSave({ fileName }) {
    return {
      async save(data) {
        const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName ?? 'document.pdf';
        anchor.hidden = true;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
        return true;
      },
    };
  },
  async readReadingProgress(documentKey) {
    return (await readReadingHistoryStore())?.[documentKey];
  },
  writeReadingProgress,
};
