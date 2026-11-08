// Only loaded by targeted browser checks through Vite.
import { createKernel } from '@embedpdf/core';
import { annotationPlugin, AnnotationToken } from '@embedpdf/plugin-annotation';
import { formPlugin, FormToken } from '@embedpdf/plugin-form';
import { HistoryToken } from '@embedpdf/plugin-history';
import { interactionPlugin } from '@embedpdf/plugin-interaction';
import { stagePlugin } from '@embedpdf/plugin-stage';
import { renderPlugin } from '@embedpdf/plugin-render';
import { selectionPlugin } from '@embedpdf/plugin-selection';
import { createSharedPdfEngine, sharedHistoryPlugin } from '../apps/engine/shared-document-client';

export async function openBytes(bytes: number[], identity: string | FileSystemFileHandle = 'v3-kernel-test') {
  const session = createSharedPdfEngine({ defaultFallbackFonts: false });
  session.client.setIdentity(identity);
  const kernel = createKernel({ engine: session.engine, plugins: [stagePlugin(), renderPlugin(), interactionPlugin(), selectionPlugin(), annotationPlugin(), sharedHistoryPlugin(), formPlugin()] });
  await kernel.start();
  await kernel.documents.open({ kind: 'bytes', bytes: new Uint8Array(bytes), id: 'test' });
  const doc = session.client.getDocument('test')!;
  return { ...session, kernel, doc, annotations: kernel.capability(AnnotationToken, 'test'), form: kernel.capability(FormToken, 'test'), history: kernel.capability(HistoryToken, 'test') };
}
export async function open(identity: string | FileSystemFileHandle, url: string) {
  return openBytes(Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())), identity);
}
