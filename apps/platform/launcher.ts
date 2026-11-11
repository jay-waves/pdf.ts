import { browserCapabilities } from './browser-capabilities';
import type { PdfWritePlan, PdfWriteResult, SharedSaveState } from '../shared/pdf-file';
import { sha256 } from 'hash-wasm';
import type { PlatformDocument, ExternalDocumentChange, ViewerPlatform } from './types';

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
  private pendingExternalVersion = '';
  private writeInProgress = false;
  private sharedSave?: SharedSaveState;

  observeSharedSave(state?: SharedSaveState) { this.sharedSave = state; }

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
    const size = Number(response.headers.get('Content-Length'));
    if (!Number.isSafeInteger(size) || size <= 0) {
      throw new Error('PDF.ts did not provide the PDF size.');
    }
    console.info('[pdf-ts] PDF metadata ready', {
      bytes: size,
      contentType: response.headers.get('Content-Type') || 'unknown',
    });
    return {
      resource: { url: this.resourceUrl, sharedIdentity: this.resourceUrl, draftLocation: { endpoint: `${this.resourceUrl}/draft` } },
      key: `pdf.ts:${this.resourceUrl}`,
      name: filenameFromDisposition(response.headers.get('Content-Disposition')),
      fileHandle: this,
      watchForChanges: (listener) => this.watchForChanges(listener),
    };
  }

  watchForChanges(listener: (change: ExternalDocumentChange) => void) {
    let active = true;
    let checking = false;
    let controller: AbortController | null = null;
    let candidateVersion = '';
    let candidateSize = 0;
    const check = async () => {
      if (!active || checking || this.writeInProgress || this.sharedSave?.saving || document.visibilityState === 'hidden') return;
      checking = true;
      controller = new AbortController();
      try {
        const response = await fetch(this.resourceUrl, {
          method: 'HEAD',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!active || !response.ok || this.sharedSave?.saving) return;
        const version = stripEtag(response.headers.get('ETag'));
        const size = Number(response.headers.get('Content-Length'));
        if (!version || version === (this.sharedSave?.diskVersion ?? this.version) || version === this.pendingExternalVersion
          || !Number.isSafeInteger(size) || size <= 0) {
          candidateVersion = '';
          candidateSize = 0;
          return;
        }

        // In-place writers can expose a transient, incomplete PDF. Require the
        // same fingerprint on two consecutive checks before attempting reload.
        if (version !== candidateVersion || size !== candidateSize) {
          candidateVersion = version;
          candidateSize = size;
          return;
        }

        this.pendingExternalVersion = version;
        candidateVersion = '';
        candidateSize = 0;
        const url = new URL(this.resourceUrl);
        url.searchParams.set('version', version);
        listener({
          resource: { url: url.href, sharedIdentity: this.resourceUrl, draftLocation: { endpoint: `${this.resourceUrl}/draft` } },
          accept: () => {
            this.version = version;
            this.pendingExternalVersion = '';
          },
        });
      } catch {
        // The launcher may be briefly unavailable while waking or shutting down.
      } finally {
        controller = null;
        checking = false;
      }
    };
    const timer = window.setInterval(() => void check(), 1_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }

  async prepareWrite() {
    return {
      writeShared: (plan: PdfWritePlan) => this.write(plan),
      save: async (data: ArrayBuffer) => {
        // Compatibility for callers outside the shared viewer. Shared saves
        // always receive their expected version from the worker.
        const plan: PdfWritePlan = { destination: 'original', data,
          expectedVersion: this.version, outputVersion: await sha256(new Uint8Array(data)) };
        let result = await this.write(plan);
        if (result.status === 'retry-copy') result = await this.write({ ...plan, destination: 'copy' });
        if (result.status === 'saved') this.version = result.version;
        return result.status === 'saved' || result.status === 'copy';
      },
    };
  }

  private async write(plan: PdfWritePlan): Promise<PdfWriteResult> {
    this.writeInProgress = true;
    try {
      if (plan.destination === 'copy') {
        const name = await this.saveCopy(plan.data);
        window.alert(`Your edits were saved as:\n${name}`);
        return { status: 'copy' };
      }
      const headers: Record<string, string> = {
        'Content-Type': 'application/pdf', 'If-Match': `"${plan.expectedVersion}"`,
      };
      const response = await fetch(this.resourceUrl, {
        method: 'PUT', headers, body: plan.data,
      });
      if (response.ok) {
        const result = await response.json() as WriteResponse;
        return { status: 'saved', version: result.version };
      }
      const failure = await response.json().catch(() => ({})) as ErrorResponse;
      if (response.status === 409 || response.status === 412) {
        const copy = window.confirm(
          `${failure.message ?? 'This PDF was modified by another program.'}\n\n`
          + 'The original will not be overwritten. Save your changes as a conflict copy beside it?',
        );
        return { status: copy ? 'retry-copy' : 'cancelled' };
      }
      throw new Error(failure.message ?? `PDF.ts could not save the PDF (${response.status}).`);
    } finally { this.writeInProgress = false; }
  }

  async saveCopy(data: ArrayBuffer) {
    const response = await fetch(`${this.resourceUrl}/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: data,
    });
    if (!response.ok) {
      throw new Error(`PDF.ts could not save a conflict copy (${response.status}).`);
    }
    const copy = await response.json() as CopyResponse;
    return copy.name;
  }
}

const launcherDocumentId = new URLSearchParams(window.location.search).get('launcherDocument')
  || (window.location.pathname.startsWith("/read/") ? decodeURIComponent(window.location.pathname.slice(6)) : null);
const launcher = launcherDocumentId ? new PdfLauncherSession(launcherDocumentId) : null;

export const platform: ViewerPlatform = {
  ...browserCapabilities,
  async loadViewerResources(bundledWasmUrl) {
    return {
      wasm: { url: bundledWasmUrl },
      document: await launcher?.openDocument(),
    };
  },
};
