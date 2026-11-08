// Loaded only by the targeted browser check through Vite.
import { PluginRegistry } from '@embedpdf/core';
import { PdfEngine } from '@embedpdf/engines/pdfium';
import { RemoteExecutor } from '@embedpdf/engines/pdfium-worker-engine';
import { browserImageDataToBlobConverter } from '@embedpdf/engines/converters';
import { DocumentManagerPluginPackage } from '@embedpdf/plugin-document-manager';
import { InteractionManagerPluginPackage } from '@embedpdf/plugin-interaction-manager';
import { SelectionPluginPackage } from '@embedpdf/plugin-selection';
import { AnnotationPluginPackage } from '@embedpdf/plugin-annotation';
import { createPdfWorker } from '../apps/renderer/pdf-worker-transport';
import { SharedDocumentClient, SharedHistoryPluginPackage, SharedFormPluginPackage } from '../apps/renderer/shared-document-client';
import wasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';

export async function open(identity: string, url: string) {
  const worker = createPdfWorker();
  const executor = new RemoteExecutor(worker, { wasmUrl, fontFallback: null });
  await (executor as any).readyTask.toPromise();
  const engine = new PdfEngine(executor, { imageConverter: browserImageDataToBlobConverter });
  const client = new SharedDocumentClient(engine, (executor as any).send.bind(executor), worker);
  client.setIdentity(identity);
  const registry = new PluginRegistry(engine);
  registry.registerPlugin(DocumentManagerPluginPackage);
  registry.registerPlugin(InteractionManagerPluginPackage);
  registry.registerPlugin(SelectionPluginPackage);
  registry.registerPlugin(SharedHistoryPluginPackage);
  registry.registerPlugin(AnnotationPluginPackage, { autoCommit: false });
  registry.registerPlugin(SharedFormPluginPackage);
  await registry.initialize();
  const manager = registry.getPlugin('document-manager')!.provides!();
  const opened = await manager.openDocumentUrl({ url, documentId: 'test' }).toPromise();
  await opened.task.toPromise();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await client.flush();
  const annotations = registry.getPlugin('annotation')!.provides!().forDocument('test');
  const history = registry.getPlugin('history')!.provides!().forDocument('test');
  const form = registry.getPlugin('form')!.provides!().forDocument('test');
  return { client, registry, engine, manager, annotations, history, form, worker };
}
