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

class PdfLauncherSession {
  readonly resourceUrl: string;
  private version = '';
  private baseVersion = '';
  private baseSize = 0;
  private incrementalAvailable = true;

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
        throw new Error('This PDF was moved or deleted. Open it with PDF.ts again to register its new location.');
      }
      throw new Error(`PDF.ts could not open the document (${response.status}).`);
    }
    this.version = stripEtag(response.headers.get('ETag'));
    if (!this.version) {
      throw new Error('PDF.ts did not provide a document version.');
    }
    this.baseVersion = this.version;
    this.baseSize = Number(response.headers.get('Content-Length'));
    if (!Number.isSafeInteger(this.baseSize) || this.baseSize <= 0) {
      throw new Error('PDF.ts did not provide the PDF size.');
    }
    return {
      resource: { url: this.resourceUrl },
      key: `pdf.ts:${this.resourceUrl}`,
      name: filenameFromDisposition(response.headers.get('Content-Disposition')),
      fileHandle: this,
    };
  }

  async prepareWrite() {
    return {
      saveIncremental: this.incrementalAvailable
        ? async (revision: { baseSize: number; delta: ArrayBuffer }) => (
            this.saveIncremental(revision)
          )
        : undefined,
      save: async (data: ArrayBuffer) => {
        try {
          const saved = await this.save(data);
          if (saved) this.incrementalAvailable = false;
          return saved;
        } catch (error) {
          window.alert(error instanceof Error ? error.message : 'PDF.ts could not save the PDF.');
          throw error;
        }
      },
    };
  }

  async saveIncremental(revision: { baseSize: number; delta: ArrayBuffer }) {
    if (revision.baseSize !== this.baseSize) {
      throw new Error('The PDFium incremental revision does not match the opened PDF.');
    }
    const response = await fetch(this.resourceUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/pdf',
        'If-Match': `"${this.version}"`,
        'X-Pdf-Ts-Base-Version': `"${this.baseVersion}"`,
        'X-Pdf-Ts-Base-Size': String(this.baseSize),
      },
      body: revision.delta,
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => ({})) as { message?: string };
      throw new Error(failure.message ?? `PDF.ts could not append the PDF revision (${response.status}).`);
    }

    const result = await response.json() as WriteResponse;
    this.version = result.version;
    return true;
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
        `${conflict.message ?? 'This PDF was modified by another program or launcher window.'}\n\n`
        + 'The original will not be overwritten. Save your changes as a conflict copy beside it?',
      );
      if (!shouldSaveCopy) return false;

      const copyResponse = await fetch(`${this.resourceUrl}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/pdf' },
        body: data,
      });
      if (!copyResponse.ok) {
        throw new Error(`PDF.ts could not save a conflict copy (${copyResponse.status}).`);
      }
      const copy = await copyResponse.json() as CopyResponse;
      window.alert(`The PDF changed on disk. Your edits were saved as:\n${copy.name}`);
      return true;
    }

    const failure = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(failure.message ?? `PDF.ts could not save the PDF (${response.status}).`);
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

function createPdfLauncherSession() {
  const query = new URLSearchParams(window.location.search);
  const documentId = query.get('launcherDocument');
  return documentId ? new PdfLauncherSession(documentId) : null;
}

const launcher = createPdfLauncherSession();

export const platform: ViewerPlatform = {
  async loadViewerResources(bundledWasmUrl) {
    if (!launcher) {
      throw new Error('This PDF.ts viewer URL is missing its daemon document identifier.');
    }
    return {
      wasm: { url: bundledWasmUrl },
      document: await launcher.openDocument(),
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
    return launcher?.getPreference(key) ?? null;
  },
  setPreference(key, value) {
    launcher?.setPreference(key, value);
  },
  readReadingProgress(documentKey) {
    return launcher?.readReadingProgress(documentKey) ?? Promise.resolve(undefined);
  },
  writeReadingProgress(documentKey, progress) {
    return launcher?.writeReadingProgress(documentKey, progress) ?? Promise.resolve();
  },
};
