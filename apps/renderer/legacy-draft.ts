import { ANNOTATION_FIELD_NAMES, type AnnotationDraft, type AnnotationPatch, type AnnotationRef, type LocalDocumentHandle, type PageRef } from '@embedpdf/engine-core/runtime';
import type { AnnotationTarget, DraftBaseline } from './document-draft';
/** Read-only upgrade path for drafts written by pdf.ts on EmbedPDF 2.15. */
export interface LegacyDraft {
  format: 'pdf.ts/swp'; version: 1; engine?: undefined; baseVersion: string; revision: number; updatedAt: string;
  targets: AnnotationTarget[]; removed: AnnotationTarget[]; mergeOutputVersion?: string;
  upsert: { target?: AnnotationTarget; item: { annotation: Record<string, any>; ctx?: { data?: ArrayBuffer | Uint8Array } } }[];
  formValues: Record<string, string>;
}
const kinds: Record<number, AnnotationDraft['subtype']> = { 1: 'text', 2: 'link', 3: 'free-text', 4: 'line', 5: 'square', 6: 'circle', 7: 'polygon', 8: 'polyline', 9: 'highlight', 10: 'underline', 11: 'squiggly', 12: 'strikeout', 13: 'stamp', 14: 'caret', 15: 'ink', 16: 'popup', 17: 'file-attachment' };
const readOnly = new Set(['ref', 'page', 'hasAppearance', 'appearanceState', 'structurePosition', 'createdBy', 'modifiedBy', 'importedBy', 'actions']);
function geometry(value: any): any {
  if (!value || typeof value !== 'object' || value instanceof Uint8Array || value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(geometry);
  if (value.origin && value.size) return { x: value.origin.x, y: value.origin.y, width: value.size.width, height: value.size.height };
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, geometry(child)]));
}
function convert(old: Record<string, any>) {
  const subtype = kinds[old.type]; if (!subtype) throw new Error(`This legacy draft annotation cannot be migrated (type ${old.type}).`);
  const source = geometry(old);
  source.createdAt = old.created instanceof Date ? old.created.toISOString() : old.created;
  source.modifiedAt = old.modified instanceof Date ? old.modified.toISOString() : old.modified;
  source.nm = old.id;
  source.blendMode = typeof old.blendMode === 'string' ? old.blendMode.toLowerCase() : undefined;
  source.fontColor = old.textColor ?? old.fontColor;
  source.icon = typeof old.icon === 'string' ? old.icon.toLowerCase() : undefined;
  if (['square', 'circle', 'free-text', 'stamp'].includes(subtype)) source.box = source.rect;
  const fields = ANNOTATION_FIELD_NAMES[subtype];
  const data: Record<string, any> = { subtype };
  for (const name of fields) if (!readOnly.has(name) && source[name] !== undefined && !(name === 'rect' && source.box)) data[name] = source[name];
  // Old object flags were stored as the PDF bit word.
  if (Array.isArray(old.flags)) for (const name of old.flags) data[name] = true;
  if (typeof old.flags === 'number') ['invisible','hidden','print','noZoom','noRotate','noView','readOnly','locked','toggleNoView','lockedContents'].forEach((name, index) => { data[name] = !!(old.flags & (1 << index)); });
  return data;
}
async function legacyAnnotationOrder(doc: LocalDocumentHandle, pages: readonly { ref: PageRef }[]) {
  // Only the one-time v2 reader needs raw /Annots order: v3 deliberately separates widgets.
  const [{ createPdfRuntime }, { ensureInitialized, openFatMemoryDocument }] = await Promise.all([
    import('@embedpdf/engine-runtime'), import('@embedpdf/engine-services'),
  ]);
  const bytes = await doc.download({ mode: 'incremental' });
  const runtime = await createPdfRuntime({ prefer: 'wasm' }); ensureInitialized(runtime);
  let opened: ReturnType<typeof openFatMemoryDocument> | undefined;
  try {
    opened = openFatMemoryDocument(runtime, bytes);
    const pointer = opened.docPtr;
    return pages.map((page, pageIndex) => {
      const handle = runtime.fn.FPDF_LoadPage(pointer, pageIndex);
      if (!handle) throw new Error('A legacy draft page could not be read.');
      try {
        return Array.from({ length: runtime.fn.FPDFPage_GetAnnotCount(handle) }, (_, index): AnnotationRef => {
          const annotation = runtime.fn.FPDFPage_GetAnnot(handle, index);
          if (!annotation) throw new Error('A legacy draft annotation could not be read.');
          try {
            const objectNumber = runtime.fn.EPDFAnnot_GetObjectNumber(annotation);
            return objectNumber > 0 ? { kind: 'objectNumber', page: page.ref, objectNumber }
              : { kind: 'baseIndex', page: page.ref, baseIndex: index };
          } finally { runtime.fn.FPDFPage_CloseAnnot(annotation); }
        });
      } finally { runtime.fn.FPDF_ClosePage(handle); }
    });
  } finally { opened?.close(); await runtime.destroy(); }
}
export async function restoreLegacyDraft(doc: LocalDocumentHandle, draft: LegacyDraft, _baseline: DraftBaseline) {
  const { pages } = await doc.pages.list();
  const order = await legacyAnnotationOrder(doc, pages);
  const resolve = (target: AnnotationTarget) => {
    const ref = order[target.pageIndex]?.[target.index];
    if (!ref) throw new Error('A legacy draft annotation no longer matches its original PDF.');
    return { ref, page: ref.page };
  };
  const refs = new Map<string, AnnotationRef>(draft.targets.map(t => [t.id, resolve(t).ref]));
  const pending = [...draft.upsert];
  while (pending.length) {
    const index = pending.findIndex(change => !change.item.annotation.inReplyToId || refs.has(change.item.annotation.inReplyToId));
    if (index < 0) throw new Error('The legacy draft has unresolved comment replies.');
    const change = pending.splice(index, 1)[0]; const old = change.item.annotation;
    const page = pages[old.pageIndex]; if (!page) throw new Error('The legacy draft refers to a missing page.');
    const data = convert(old);
    if (old.inReplyToId) data.reply = { to: refs.get(old.inReplyToId) };
    const bytes = change.item.ctx?.data;
    const options = bytes ? { resources: { appearance: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes) } } : undefined;
    if (change.target) {
      const original = resolve(change.target); const { subtype: _subtype, nm: _nm, createdAt: _createdAt, ...patch } = data;
      await doc.page(original.page).annotations.update(original.ref, patch as AnnotationPatch, options);
      refs.set(old.id, original.ref);
    } else {
      const result = await doc.page(page.ref).annotations.create(data as AnnotationDraft, options);
      refs.set(old.id, result.annotation.ref);
    }
  }
  for (const target of draft.removed) {
    const a = resolve(target); await doc.page(a.page).annotations.delete(a.ref);
  }
  const fields = (await doc.forms.list()).fields;
  for (const [name, value] of Object.entries(draft.formValues)) {
    const field = fields.find(f => f.name === name); if (!field) throw new Error(`A legacy draft form field is missing: ${name}`);
    await doc.forms.setValue(field.ref, { value });
  }
}
