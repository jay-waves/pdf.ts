import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { RemoteExecutor } from '@embedpdf/engines/pdfium-worker-engine';
import { init } from '@embedpdf/pdfium';

class FakeWorker {
  messages = [];
  listeners = new Set();
  terminated = false;

  addEventListener(type, listener) {
    assert.equal(type, 'message');
    this.listeners.add(listener);
  }

  removeEventListener(type, listener) {
    assert.equal(type, 'message');
    this.listeners.delete(listener);
  }

  postMessage(message, transfer = []) {
    this.messages.push({ message, transfer });
  }

  terminate() {
    this.terminated = true;
  }

  respond(data) {
    for (const listener of this.listeners) listener({ data });
  }
}

test('EmbedPDF patch keeps the docflow worker bridge contract', async () => {
  const worker = new FakeWorker();
  const executor = new RemoteExecutor(worker, {
    wasmUrl: 'https://docflow.invalid/pdfium.wasm',
    fontFallback: { fonts: {} },
  });

  assert.deepEqual(worker.messages[0], {
    message: {
      id: '0',
      type: 'wasmInit',
      wasmUrl: 'https://docflow.invalid/pdfium.wasm',
      logger: undefined,
      fontFallback: { fonts: {} },
    },
    transfer: [],
  });

  worker.respond({ id: '0', type: 'ready' });

  const content = new ArrayBuffer(32);
  const openTask = executor.openDocumentBuffer({ id: 'document-1', content });
  const openRequest = worker.messages.at(-1);
  assert.equal(openRequest.message.type, 'execute');
  assert.equal(openRequest.message.method, 'openDocumentBuffer');
  assert.strictEqual(openRequest.message.args[0].content, content);
  assert.deepEqual(openRequest.transfer, [content]);

  worker.respond({
    id: openRequest.message.id,
    type: 'result',
    data: { id: 'document-1', pageCount: 1 },
  });
  assert.equal((await openTask.toPromise()).id, 'document-1');

  // send() is deliberately exposed through the repository patch adapter so
  // docflow can add one worker-side operation without forking EmbedPDF.
  const incrementalTask = executor.send('saveIncremental', [{ id: 'document-1' }]);
  const incrementalRequest = worker.messages.at(-1);
  assert.equal(incrementalRequest.message.type, 'execute');
  assert.equal(incrementalRequest.message.method, 'saveIncremental');
  assert.deepEqual(incrementalRequest.message.args, [{ id: 'document-1' }]);
  assert.deepEqual(incrementalRequest.transfer, []);

  const delta = new ArrayBuffer(8);
  worker.respond({
    id: incrementalRequest.message.id,
    type: 'result',
    data: { baseSize: 32, delta },
  });
  assert.deepEqual(await incrementalTask.toPromise(), { baseSize: 32, delta });

  executor.destroy();
  assert.equal(worker.terminated, true);
});

function createMinimalPdf() {
  const encoder = new TextEncoder();
  const parts = ['%PDF-1.4\n'];
  const offsets = [0];
  const addObject = (number, body) => {
    offsets[number] = encoder.encode(parts.join('')).byteLength;
    parts.push(`${number} 0 obj\n${body}\nendobj\n`);
  };
  addObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  addObject(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  addObject(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>');
  addObject(4, '<< /Length 0 >>\nstream\n\nendstream');
  addObject(5, '<< /Title (base) >>');
  const xrefOffset = encoder.encode(parts.join('')).byteLength;
  parts.push('xref\n0 6\n0000000000 65535 f \n');
  for (let number = 1; number <= 5; number++) {
    parts.push(`${String(offsets[number]).padStart(10, '0')} 00000 n \n`);
  }
  parts.push(
    'trailer\n<< /Size 6 /Root 1 0 R /Info 5 0 R >>\n',
    `startxref\n${xrefOffset}\n%%EOF\n`,
  );
  return encoder.encode(parts.join(''));
}

function saveIncremental(native, module, document) {
  const context = native.cache.getContext(document.id);
  const writer = module.PDFiumExt_OpenFileWriter();
  assert.notEqual(writer, 0);
  let dataPointer = 0;
  try {
    assert.equal(module.FPDF_SaveAsCopy(context.docPtr, writer, 1), true);
    const size = module.PDFiumExt_GetFileWriterSize(writer);
    dataPointer = module.pdfium.wasmExports.malloc(size);
    assert.notEqual(dataPointer, 0);
    module.PDFiumExt_GetFileWriterData(writer, dataPointer, size);
    return Uint8Array.from(module.pdfium.HEAPU8.subarray(dataPointer, dataPointer + size));
  } finally {
    if (dataPointer) module.pdfium.wasmExports.free(dataPointer);
    module.PDFiumExt_CloseFileWriter(writer);
  }
}

function startsWith(value, prefix) {
  return value.length >= prefix.length
    && prefix.every((byte, offset) => value[offset] === byte);
}

test('PDFium repeated incremental saves replace one revision based on the original PDF', async () => {
  const wasmUrl = import.meta.resolve('@embedpdf/pdfium/pdfium.wasm');
  const wasmFile = await readFile(new URL(wasmUrl));
  const wasmBinary = wasmFile.buffer.slice(
    wasmFile.byteOffset,
    wasmFile.byteOffset + wasmFile.byteLength,
  );
  const module = await init({ wasmBinary });
  const native = new PdfiumNative(module, { fontFallback: null });
  const base = createMinimalPdf();
  const document = await native.openDocumentBuffer({
    id: 'repeated-save',
    content: base.buffer.slice(base.byteOffset, base.byteOffset + base.byteLength),
  }).toPromise();

  await native.setMetadata(document, {
    title: 'first',
    author: 'first-author',
  }).toPromise();
  const first = saveIncremental(native, module, document);
  await native.setMetadata(document, { title: 'second' }).toPromise();
  const second = saveIncremental(native, module, document);

  assert.equal(startsWith(first, base), true);
  assert.equal(startsWith(second, base), true);
  assert.equal(startsWith(second, first), false);

  const latest = await native.openDocumentBuffer({
    id: 'latest-revision',
    content: second.buffer.slice(second.byteOffset, second.byteOffset + second.byteLength),
  }).toPromise();
  const latestMetadata = await native.getMetadata(latest).toPromise();
  assert.equal(latestMetadata.title, 'second');
  assert.equal(latestMetadata.author, 'first-author');

  await native.destroy().toPromise();
});
