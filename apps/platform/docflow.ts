import type { PlatformDocument } from './types';

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

class DocflowSession {
  readonly resourceUrl: string;
  readonly heartbeatUrl: string;
  readonly name: string;
  private version = '';

  constructor(resourceUrl: string, heartbeatUrl: string, name: string) {
    this.resourceUrl = new URL(resourceUrl, window.location.href).href;
    this.heartbeatUrl = new URL(heartbeatUrl, window.location.href).href;
    this.name = name || 'document.pdf';
    this.startHeartbeat();
  }

  async openDocument(): Promise<PlatformDocument> {
    const response = await fetch(this.resourceUrl, { method: 'HEAD', cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Docflow could not open the document (${response.status}).`);
    }
    this.version = stripEtag(response.headers.get('ETag'));
    if (!this.version) {
      throw new Error('Docflow did not provide a document version.');
    }
    return {
      resource: { url: this.resourceUrl },
      sourceUrl: this.resourceUrl,
      key: `docflow:${this.resourceUrl}`,
      name: this.name,
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

  private startHeartbeat() {
    const heartbeat = () => {
      void fetch(this.heartbeatUrl, { method: 'POST', cache: 'no-store' }).catch(() => {});
    };
    heartbeat();
    window.setInterval(heartbeat, 15_000);
  }
}

export function getDocflowSession() {
  const query = new URLSearchParams(window.location.search);
  const resourceUrl = query.get('docflowResource');
  const heartbeatUrl = query.get('docflowHeartbeat');
  if (!resourceUrl || !heartbeatUrl) return null;
  return new DocflowSession(resourceUrl, heartbeatUrl, query.get('docflowName') ?? 'document.pdf');
}
