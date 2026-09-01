import { browserPersistence } from './browser-storage';
import { browserLocalDocumentCapabilities } from './browser-local-document';
import { browserTranslationCapabilities } from './browser-translation';
import { getExternalUrl } from '../shared/url';
import type {
  PlatformDocument,
  ViewerPlatform,
} from './types';

type WriteResponse = {
  version: string;
};

type ErrorResponse = {
  message?: string;
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
    console.info('[pdf-ts] Requesting PDF metadata');
    let response: Response;
    try {
      response = await fetch(this.resourceUrl, { method: 'HEAD', cache: 'no-store' });
    } catch (error) {
      console.error('[pdf-ts] PDF metadata request failed', error);
      throw error;
    }
    if (!response.ok) {
      console.error('[pdf-ts] PDF metadata request returned an error', {
        status: response.status,
        statusText: response.statusText,
      });
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
    console.info('[pdf-ts] PDF metadata ready', {
      bytes: this.baseSize,
      contentType: response.headers.get('Content-Type') || 'unknown',
    });
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
      const failure = await response.json().catch(() => ({})) as ErrorResponse;
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
      const conflict = await response.json().catch(() => ({})) as ErrorResponse;
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

    const failure = await response.json().catch(() => ({})) as ErrorResponse;
    throw new Error(failure.message ?? `PDF.ts could not save the PDF (${response.status}).`);
  }
}

const launcherDocumentId = new URLSearchParams(window.location.search).get('launcherDocument');
const launcher = launcherDocumentId ? new PdfLauncherSession(launcherDocumentId) : null;

export const platform: ViewerPlatform = {
  async loadViewerResources(bundledWasmUrl) {
    return {
      wasm: { url: bundledWasmUrl },
      document: await launcher?.openDocument(),
    };
  },
  ...browserLocalDocumentCapabilities,
  openExternal(url) {
    const target = getExternalUrl(url, window.location.href);
    if (target) window.open(target, '_blank', 'noopener,noreferrer');
  },
  ...browserTranslationCapabilities,
  ...browserPersistence,
};
