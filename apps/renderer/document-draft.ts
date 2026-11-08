import { restoreLegacyDraft, type LegacyDraft } from './legacy-draft';
import { annotationKey, fieldValueOf, type Annotation, type AnnotationBundle, type FormField, type FormFieldValue, type LocalDocumentHandle } from '@embedpdf/engine-core/runtime';

export type DraftStatus = 'clean' | 'pending' | 'saving' | 'saved' | 'error' | 'conflict' | 'unavailable';
export interface DraftState { draftStatus: DraftStatus; draftRevision: number; draftError?: string }
export interface AnnotationTarget { id: string; pageIndex: number; index: number }
export interface DraftBaseline { annotations: Annotation[]; fields: FormField[]; pages: string[] }
export type DocumentDraft = NativeDocumentDraft | LegacyDraft;
export interface NativeDocumentDraft {
  format: 'pdf.ts/swp'; version: 1; engine: 3;
  baseVersion: string; revision: number; updatedAt: string;
  targets: AnnotationTarget[]; removed: AnnotationTarget[];
  bundle: AnnotationBundle | null;
  formValues: Record<string, FormFieldValue>;
  mergeOutputVersion?: string;
}
const pageKey = (page: unknown) => JSON.stringify(page);
export async function captureBaseline(doc: LocalDocumentHandle): Promise<DraftBaseline> {
  const [annotations, forms, pages] = await Promise.all([doc.annotations.list(), doc.forms.list(), doc.pages.list()]);
  return { annotations: annotations.annotations.filter(a => a.subtype !== 'widget'), fields: forms.fields,
    pages: pages.pages.map(p => pageKey(p.ref)) };
}
export function annotationTargets(baseline: DraftBaseline) {
  const counts = new Map<number, number>();
  return new Map(baseline.annotations.map(a => {
    const pageIndex = baseline.pages.indexOf(pageKey(a.page));
    const index = counts.get(pageIndex) ?? 0; counts.set(pageIndex, index + 1);
    return [annotationKey(a.ref), { id: annotationKey(a.ref), pageIndex, index }];
  }));
}
export async function buildDraft(doc: LocalDocumentHandle, baseVersion: string, revision: number,
  baseline: DraftBaseline, snapshot?: DraftBaseline): Promise<NativeDocumentDraft> {
  const current = snapshot ?? await captureBaseline(doc);
  const previous = new Map(baseline.annotations.map(a => [annotationKey(a.ref), a]));
  const present = new Set(current.annotations.map(a => annotationKey(a.ref)));
  const targets = annotationTargets(baseline);
  const changed = current.annotations.filter(a => JSON.stringify(a) !== JSON.stringify(previous.get(annotationKey(a.ref))));
  // The native bundle closes references and reply threads, and deduplicates stamp resources.
  const bundle = changed.length ? await doc.annotations.export({ refs: changed.map(a => a.ref), include: 'threads' }) : null;
  const oldFields = new Map(baseline.fields.filter(f => fieldValueOf(f) !== null).map(f => [f.name, fieldValueOf(f)!]));
  return { format: 'pdf.ts/swp', version: 1, engine: 3, baseVersion, revision, updatedAt: new Date().toISOString(),
    targets: [...targets.values()], bundle,
    removed: baseline.annotations.filter(a => !present.has(annotationKey(a.ref))).map(a => targets.get(annotationKey(a.ref))!),
    formValues: Object.fromEntries(current.fields.filter(f => JSON.stringify(fieldValueOf(f)) !== JSON.stringify(oldFields.get(f.name))).filter(f => fieldValueOf(f) !== null).map(f => [f.name, fieldValueOf(f)!])) };
}
export async function restoreDraft(doc: LocalDocumentHandle, draft: DocumentDraft, baseline: DraftBaseline) {
  if (draft.engine !== 3) return restoreLegacyDraft(doc, draft, baseline);
  const currentTargets = annotationTargets(baseline);
  const byPosition = new Map([...currentTargets].map(([key, t]) => [`${t.pageIndex}:${t.index}`, key]));
  const byKey = new Map(baseline.annotations.map(a => [annotationKey(a.ref), a]));
  const resolve = (t: AnnotationTarget) => {
    const key = byPosition.get(`${t.pageIndex}:${t.index}`);
    const a = key && byKey.get(key);
    if (!a) throw new Error('A draft annotation no longer matches its original PDF.');
    return a;
  };
  const targets = new Map(draft.targets.map(t => [t.id, t]));
  const replaced = new Map<string, Annotation>();
  for (const t of draft.removed) { const a = resolve(t); replaced.set(annotationKey(a.ref), a); }
  for (const item of draft.bundle?.items ?? []) {
    const t = targets.get(annotationKey(item.data.ref));
    if (t) { const a = resolve(t); replaced.set(annotationKey(a.ref), a); }
  }
  // One transaction deletes the old representations. Imports reconstruct native references,
  // replies and appearance resources together, without SDK-private state or closure history.
  if (replaced.size) await doc.apply({ ops: [...replaced.values()].filter(a => !a.reply?.to || !replaced.has(annotationKey(a.reply.to))).map(a => ({ type: 'annotations.delete', page: a.page, ref: a.ref })) });
  if (draft.bundle) {
    const result = await doc.annotations.import(draft.bundle, { pages: 'by-position' });
    if (result.dropped.length) throw new Error('Some draft annotations could not be restored. The original PDF was kept.');
  }
  const fields = (await doc.forms.list()).fields;
  for (const [name, value] of Object.entries(draft.formValues)) {
    const field = fields.find(f => f.name === name);
    if (!field) throw new Error(`Draft form field no longer exists: ${name}`);
    await doc.forms.setValue(field.ref, value);
  }
}
export function encodeDraft(draft: DocumentDraft): string {
  return JSON.stringify(draft, (_key, value) => {
    if (value instanceof Uint8Array) {
      let binary = ''; for (let i = 0; i < value.length; i += 8192) binary += String.fromCharCode(...value.subarray(i, i + 8192));
      return { $bytes: btoa(binary) };
    }
    return value;
  });
}
export function decodeDraft(text: string): DocumentDraft {
  const value = JSON.parse(text, (key, value) => {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid draft property.');
    if (value && typeof value === 'object' && Object.keys(value).length === 1 && typeof value.$date === 'string') return new Date(value.$date);
    if (value && typeof value === 'object' && Object.keys(value).length === 1 && typeof value.$bytes === 'string') return Uint8Array.from(atob(value.$bytes), c => c.charCodeAt(0));
    return value;
  });
  if (!value || value.format !== 'pdf.ts/swp' || value.version !== 1 || (value.engine !== 3 && value.engine !== undefined) || typeof value.baseVersion !== 'string'
    || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.targets) || !Array.isArray(value.removed)
    || !value.formValues || typeof value.formValues !== 'object' || (value.bundle && (value.bundle.format !== 'embedpdf/annotations' || value.bundle.version !== 1))) {
    throw new Error('This .swp file is not a supported pdf.ts draft.');
  }
  const validTarget = (target: AnnotationTarget) => target && typeof target.id === 'string' && Number.isSafeInteger(target.pageIndex) && target.pageIndex >= 0 && Number.isSafeInteger(target.index) && target.index >= 0;
  if (!value.targets.every(validTarget) || !value.removed.every(validTarget)) throw new Error('Invalid draft annotation target.');
  if (value.engine === undefined && (!Array.isArray(value.upsert) || value.upsert.some((c: any) => !c?.item?.annotation || !Number.isSafeInteger(c.item.annotation.pageIndex) || c.item.annotation.pageIndex < 0 || (c.target && !validTarget(c.target))))) throw new Error('Invalid legacy draft annotations.');
  return value as DocumentDraft;
}
