import {
  getPreference,
  readReadingHistoryStore,
  setPreference,
  writeReadingProgress,
} from './browser-storage';
import { translateWithModelDownload } from './browser-translation';
import type {
  PlatformDocument,
  ReadingProgress,
  ViewerPlatform,
} from './types';

type WriteResponse = {
  version: string;
  name: string;
};

type ConflictResponse = {
  code?: string;
  message?: string;
  currentVersion?: string;
};

type CopyResponse = {
  name: string;
};

function stripEtag(value: string | null) {
  return value?.trim().replace(/^"|"$/g, '') ?? '';
}

function filenameFromDisposition(value: string | null) {
  const encoded = value?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.trim());
    } catch {
      // Fall through to the ASCII filename.
    }
  }
  return value?.match(/filename="([^"]*)"/i)?.[1]?.replace(/[\r\n]/g, '') || 'document.pdf';
}

class DocflowSession {
  readonly resourceUrl: string;
  private version = '';

  constructor(documentId: string) {
    this.resourceUrl = new URL(
      `/api/documents/${encodeURIComponent(documentId)}`,
      window.location.origin,
    ).href;
  }

  async openDocument(): Promise<PlatformDocument> {
    const response = await fetch(this.resourceUrl, { method: 'HEAD', cache: 'no-store' });
    if (!response.ok) {
      if (response.status === 410) {
        throw new Error('This PDF was moved or deleted. Open it with Docflow again to register its new location.');
      }
      throw new Error(`Docflow could not open the document (${response.status}).`);
    }
    this.version = stripEtag(response.headers.get('ETag'));
    if (!this.version) {
      throw new Error('Docflow did not provide a document version.');
    }
    return {
      resource: { url: this.resourceUrl },
      key: `docflow:${this.resourceUrl}`,
      name: filenameFromDisposition(response.headers.get('Content-Disposition')),
      fileHandle: this,
    };
  }

  async prepareWrite() {
    return {
      save: async (data: ArrayBuffer) => {
        try {
          return await this.save(data);
        } catch (error) {
          window.alert(error instanceof Error ? error.message : 'Docflow could not save the PDF.');
          throw error;
        }
      },
    };
  }

  async save(data: ArrayBuffer) {
    const response = await fetch(this.resourceUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/pdf',
        'If-Match': `"${this.version}"`,
      },
      body: data,
    });
    if (response.ok) {
      const result = await response.json() as WriteResponse;
      this.version = result.version;
      return true;
    }

    if (response.status === 409) {
      const conflict = await response.json().catch(() => ({})) as ConflictResponse;
      const shouldSaveCopy = window.confirm(
        `${conflict.message ?? 'This PDF was modified by another program or docflow window.'}\n\n`
        + 'The original will not be overwritten. Save your changes as a conflict copy beside it?',
      );
      if (!shouldSaveCopy) return false;

      const copyResponse = await fetch(`${this.resourceUrl}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/pdf' },
        body: data,
      });
      if (!copyResponse.ok) {
        throw new Error(`Docflow could not save a conflict copy (${copyResponse.status}).`);
      }
      const copy = await copyResponse.json() as CopyResponse;
      window.alert(`The PDF changed on disk. Your edits were saved as:\n${copy.name}`);
      return true;
    }

    const failure = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(failure.message ?? `Docflow could not save the PDF (${response.status}).`);
  }

  getPreference(key: string) {
    return getPreference(key);
  }

  setPreference(key: string, value: string) {
    setPreference(key, value);
  }

  async readReadingProgress(documentKey: string) {
    return (await readReadingHistoryStore())?.[documentKey];
  }

  writeReadingProgress(documentKey: string, progress: ReadingProgress) {
    return writeReadingProgress(documentKey, progress);
  }

}

function createDocflowSession() {
  const query = new URLSearchParams(window.location.search);
  const documentId = query.get('docflowDocument');
  return documentId ? new DocflowSession(documentId) : null;
}

const docflow = createDocflowSession();

export const platform: ViewerPlatform = {
  async loadViewerResources(bundledWasmUrl) {
    if (!docflow) {
      throw new Error('This Docflow viewer URL is missing its daemon document identifier.');
    }
    return {
      wasm: { url: bundledWasmUrl },
      document: await docflow.openDocument(),
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
  translate: translateWithModelDownload,
  getPreference(key) {
    return docflow?.getPreference(key) ?? null;
  },
  setPreference(key, value) {
    docflow?.setPreference(key, value);
  },
  readReadingProgress(documentKey) {
    return docflow?.readReadingProgress(documentKey) ?? Promise.resolve(undefined);
  },
  writeReadingProgress(documentKey, progress) {
    return docflow?.writeReadingProgress(documentKey, progress) ?? Promise.resolve();
  },
};
