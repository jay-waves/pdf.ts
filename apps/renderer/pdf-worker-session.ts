import type { PdfDocumentObject } from '@embedpdf/models';

/** Public document IDs may be identical in different tabs. Never expose a
 * different session's handles to PDFium, including multi-document operations. */
export class PdfWorkerDocuments {
  private readonly documents = new Map<string, PdfDocumentObject>();
  private readonly prefix: string;
  constructor(prefix: string) { this.prefix = prefix; }

  private scopedId(id: string) { return `${this.prefix}:${id}`; }

  private document(value: unknown): PdfDocumentObject {
    const document = value as PdfDocumentObject;
    if (!document || !this.documents.has(document.id)) {
      throw new Error('PDF document is not open in this session.');
    }
    return { ...document, id: this.documents.get(document.id)!.id };
  }

  args(method: string, args: unknown[]): unknown[] {
    if (method === 'openDocumentBuffer' || method === 'createDocument') {
      const id = method === 'createDocument' ? args[0] : (args[0] as { id: string }).id;
      if (typeof id !== 'string' || this.documents.has(id)) {
        throw new Error('PDF document ID is invalid or already open in this session.');
      }
      return method === 'createDocument'
        ? [this.scopedId(id)]
        : [{ ...(args[0] as object), id: this.scopedId(id) }, ...args.slice(1)];
    }
    if (method === 'merge') return args; // These are byte buffers, not live documents.
    if (method === 'mergePages') {
      return [(args[0] as { docId: string; pageIndices: number[] }[]).map((config) => ({
        ...config, docId: this.document({ id: config.docId }).id,
      }))];
    }
    if (method === 'importPages') {
      return [this.document(args[0]), this.document(args[1]), ...args.slice(2)];
    }
    return [this.document(args[0]), ...args.slice(1)];
  }

  result(method: string, args: unknown[], value: unknown): unknown {
    if (method === 'openDocumentBuffer' || method === 'createDocument') {
      const document = value as PdfDocumentObject;
      const publicId = method === 'createDocument' ? args[0] as string : (args[0] as { id: string }).id;
      this.documents.set(publicId, document);
      return { ...document, id: publicId };
    }
    if (method === 'closeDocument') this.documents.delete((args[0] as PdfDocumentObject).id);
    // Some editing operations return an updated document object.
    if (value && typeof value === 'object' && 'id' in value && 'pages' in value) {
      for (const [id, document] of this.documents) {
        if (document.id === value.id) return { ...value, id };
      }
    }
    return value;
  }

  bind(id: string, document: PdfDocumentObject) { this.documents.set(id, document); }
  remove(id: string) { this.documents.delete(id); }
  aliases(nativeId: string) { return [...this.documents].filter(([, doc]) => doc.id === nativeId).map(([id]) => id); }

  all() { return [...this.documents.values()]; }
  clear() { this.documents.clear(); }
}
