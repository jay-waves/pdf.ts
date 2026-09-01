import type { InitialDocument } from '@embedpdf/react';
import type { ManagedResource, PlatformDocument } from '../platform/types';

export const DOCUMENT_ID = 'pdf-ts-document';

async function readResource(resource: ManagedResource, signal: AbortSignal) {
  if (resource.openStream) {
    return new Uint8Array(await new Response(resource.openStream()).arrayBuffer());
  }
  const response = await fetch(resource.url, { signal });
  if (!response.ok) throw new Error(`Unable to open PDF: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

export function createInitialDocument(
  document: PlatformDocument,
  consume: (resource: ManagedResource) => void,
): InitialDocument {
  return {
    name: document.name ?? 'PDF',
    source: async (signal) => {
      const bytes = await readResource(document.resource, signal);
      consume(document.resource);
      return { kind: 'bytes', id: DOCUMENT_ID, bytes };
    },
  };
}
