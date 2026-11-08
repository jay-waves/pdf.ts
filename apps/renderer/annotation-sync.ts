import type { AnnotationDocumentState, TrackedAnnotation } from '@embedpdf/plugin-annotation';

type AnnotationIndex = AnnotationDocumentState['byUid'];
export interface AnnotationChanges {
  upsert: TrackedAnnotation[];
  removed: string[];
  pageIndices: number[];
}
export interface AnnotationPayload {
  /** Only initial joins/recovery carry the complete SDK annotation index. */
  annotations?: AnnotationIndex;
  changes?: AnnotationChanges;
}
const visible = (value: TrackedAnnotation | undefined) => value?.commitState !== 'deleted' ? value : undefined;

/** SDK objects are immutable. Compare references, without rereading PDFium or
 * retaining a second serialized document model in the worker. */
export function diffAnnotations(previous: AnnotationIndex, next: AnnotationIndex, confirmIds: string[] = []): AnnotationChanges {
  const upsert: TrackedAnnotation[] = [];
  const removed: string[] = [];
  const pageIndices = new Set<number>();
  const forced = new Set(confirmIds);
  for (const id of new Set([...Object.keys(previous), ...Object.keys(next), ...confirmIds])) {
    const before = visible(previous[id]);
    const after = visible(next[id]);
    if (!forced.has(id) && before?.object === after?.object && before?.dictMode === after?.dictMode
      && before?.commitState === after?.commitState) continue;
    if (before) pageIndices.add(before.object.pageIndex);
    if (after) { upsert.push(after); pageIndices.add(after.object.pageIndex); }
    else removed.push(id);
  }
  return { upsert, removed, pageIndices: [...pageIndices] };
}

/** Coalesce updates while a tab still has optimistic edits in flight. Later
 * deletes beat upserts; a full snapshot supersedes earlier queued changes. */
export function mergeAnnotationPayload(previous: AnnotationPayload, next: AnnotationPayload): AnnotationPayload {
  if (next.annotations !== undefined) return { annotations: next.annotations, changes: next.changes };
  if (!next.changes) return { annotations: previous.annotations, changes: previous.changes };
  const values = new Map<string, TrackedAnnotation | undefined>();
  const pages = new Set<number>();
  for (const changes of [previous.changes, next.changes]) {
    if (!changes) continue;
    for (const item of changes.upsert) values.set(item.object.id, item);
    for (const id of changes.removed) values.set(id, undefined);
    for (const page of changes.pageIndices) pages.add(page);
  }
  return {
    annotations: previous.annotations,
    changes: {
      upsert: [...values.values()].filter((item): item is TrackedAnnotation => !!item),
      removed: [...values].filter(([, item]) => !item).map(([id]) => id),
      pageIndices: [...pages],
    },
  };
}

/** The SDK 2.15 reducer boundary is deliberately confined to one adapter.
 * Untouched annotations/page arrays keep their references; view state is local. */
export function applyAnnotationPayload(state: AnnotationDocumentState, payload: AnnotationPayload) {
  if (!payload.annotations && (!payload.changes || (!payload.changes.upsert.length
    && !payload.changes.removed.length && !payload.changes.pageIndices.length && !state.hasPendingChanges))) {
    return { state, pageIndices: [] };
  }
  const byUid: AnnotationIndex = { ...(payload.annotations ?? state.byUid) };
  const pages: AnnotationDocumentState['pages'] = payload.annotations ? {} : { ...state.pages };
  const affected = new Set(payload.changes?.pageIndices ?? []);
  if (payload.annotations) {
    for (const page of Object.keys(state.pages)) affected.add(Number(page));
    for (const [id, tracked] of Object.entries(byUid)) {
      if (!visible(tracked)) { delete byUid[id]; continue; }
      (pages[tracked.object.pageIndex] ??= []).push(id);
      affected.add(tracked.object.pageIndex);
    }
  }
  const changes = payload.changes;
  if (changes) {
    const touched = new Set([...changes.removed, ...changes.upsert.map((item) => item.object.id)]);
    for (const id of touched) if (byUid[id]) affected.add(byUid[id].object.pageIndex);
    for (const id of changes.removed) delete byUid[id];
    for (const item of changes.upsert) {
      byUid[item.object.id] = item;
      affected.add(item.object.pageIndex);
    }
    for (const page of affected) {
      const ids = (pages[page] ?? []).filter((id) => byUid[id]?.object.pageIndex === page);
      const known = new Set(ids);
      for (const item of changes.upsert) {
        if (item.object.pageIndex === page && !known.has(item.object.id)) {
          ids.push(item.object.id); known.add(item.object.id);
        }
      }
      pages[page] = ids;
    }
  }
  return {
    state: {
      ...state, byUid, pages, hasPendingChanges: false,
      selectedUids: state.selectedUids.filter((id) => byUid[id]),
      selectedUid: state.selectedUid && byUid[state.selectedUid] ? state.selectedUid : null,
    },
    pageIndices: [...affected],
  };
}
