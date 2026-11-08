import type { PdfAnnotationObject } from '@embedpdf/models';
import type { AnnotationTransferItem } from '@embedpdf/plugin-annotation';

export type DraftStatus = 'clean' | 'pending' | 'saving' | 'saved' | 'error' | 'conflict' | 'unavailable';
export interface DraftState {
  draftStatus: DraftStatus;
  draftRevision: number;
  draftError?: string;
}
export interface AnnotationTarget { id: string; pageIndex: number; index: number }
export interface DraftChange {
  target?: AnnotationTarget;
  item: AnnotationTransferItem;
}
export interface DocumentDraft {
  format: 'pdf.ts/swp';
  version: 1;
  baseVersion: string;
  revision: number;
  updatedAt: string;
  targets: AnnotationTarget[];
  upsert: DraftChange[];
  removed: AnnotationTarget[];
  formValues: Record<string, string>;
  /** Written before replacing the PDF, so recovery recognizes an acknowledged
   * or interrupted merge without applying its annotations a second time. */
  mergeOutputVersion?: string;
}
export interface DraftBaseline {
  annotations: PdfAnnotationObject[];
  formValues: Record<string, string>;
}
export function draftBaseline(annotations: PdfAnnotationObject[], formValues: Record<string, string>): DraftBaseline {
  return { annotations: structuredClone(annotations), formValues: { ...formValues } };
}
export function annotationTargets(annotations: PdfAnnotationObject[]): Map<string, AnnotationTarget> {
  const counts = new Map<number, number>();
  return new Map(annotations.map(annotation => {
    const index = counts.get(annotation.pageIndex) ?? 0;
    counts.set(annotation.pageIndex, index + 1);
    return [annotation.id, { id: annotation.id, pageIndex: annotation.pageIndex, index }];
  }));
}
export function resolveTarget(target: AnnotationTarget, annotations: PdfAnnotationObject[]): PdfAnnotationObject {
  const result = annotations.find(a => a.id === target.id && a.pageIndex === target.pageIndex)
    ?? annotations.filter(a => a.pageIndex === target.pageIndex)[target.index];
  if (!result) throw new Error('A draft annotation no longer matches the original PDF.');
  return result;
}
export function buildDraft(baseVersion: string, revision: number, baseline: DraftBaseline,
  annotations: PdfAnnotationObject[], formValues: Record<string, string>): DocumentDraft {
  const before = new Map(baseline.annotations.map(a => [a.id, a]));
  const current = new Set(annotations.map(a => a.id));
  const targets = annotationTargets(baseline.annotations);
  return {
    format: 'pdf.ts/swp', version: 1, baseVersion, revision, updatedAt: new Date().toISOString(),
    targets: [...targets.values()],
    upsert: annotations.filter(a => JSON.stringify(before.get(a.id)) !== JSON.stringify(a))
      .map(annotation => ({ ...(targets.has(annotation.id) ? { target: targets.get(annotation.id)! } : {}), item: { annotation } })),
    removed: baseline.annotations.filter(a => !current.has(a.id)).map(a => targets.get(a.id)!),
    formValues: Object.fromEntries(Object.entries(formValues).filter(([key, value]) => baseline.formValues[key] !== value)),
  };
}
export function encodeDraft(draft: DocumentDraft): string {
  return JSON.stringify(draft, function(key, value) {
    const original = key ? this[key] : value;
    if (original instanceof Date) return { $date: original.toISOString() };
    if (original instanceof ArrayBuffer) {
      const bytes = new Uint8Array(original);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return { $bytes: btoa(binary) };
    }
    return value;
  });
}
export function decodeDraft(text: string): DocumentDraft {
  const value = JSON.parse(text, (key, value) => {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid draft property.');
    if (value && typeof value === 'object') {
      if (Object.keys(value).length === 1 && typeof value.$date === 'string') {
        const date = new Date(value.$date);
        if (!Number.isFinite(date.getTime())) throw new Error('Invalid draft date.');
        return date;
      }
      if (Object.keys(value).length === 1 && typeof value.$bytes === 'string') return Uint8Array.from(atob(value.$bytes), c => c.charCodeAt(0)).buffer;
    }
    return value;
  });
  if (!value || value.format !== 'pdf.ts/swp' || value.version !== 1 || typeof value.baseVersion !== 'string'
    || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.upsert)
    || !Array.isArray(value.targets) || !Array.isArray(value.removed) || !value.formValues || typeof value.formValues !== 'object') {
    throw new Error('This .swp file is not a supported pdf.ts draft.');
  }
  const validTarget = (target: AnnotationTarget) => target && typeof target.id === 'string'
    && Number.isSafeInteger(target.pageIndex) && target.pageIndex >= 0 && Number.isSafeInteger(target.index) && target.index >= 0;
  for (const change of value.upsert) {
    const a = change?.item?.annotation;
    if (!a || typeof a.id !== 'string' || !Number.isSafeInteger(a.pageIndex) || a.pageIndex < 0
      || !Number.isInteger(a.type) || !a.rect || (change.target && !validTarget(change.target))) throw new Error('Invalid draft annotation.');
  }
  if (!value.targets.every(validTarget) || !value.removed.every(validTarget) || !Object.values(value.formValues).every(v => typeof v === 'string')) throw new Error('Invalid draft edits.');
  return value as DocumentDraft;
}
