import type { AnnotationList, AnnotationListOptions, LocalDocumentHandle } from '@embedpdf/engine-core/runtime';

/** A complete local snapshot, split into bounded reads. The queue must retain
 * its read epoch across yields: no document mutation may cross these steps. */
export async function* readAnnotationBatches(
  doc: LocalDocumentHandle,
  options: AnnotationListOptions | undefined,
  read: <T>(operation: () => PromiseLike<T>) => Promise<T>,
): AsyncGenerator<void, AnnotationList> {
  const pages = options?.pages ?? (await read(() => doc.pages.list())).pages.map(page => page.ref);
  if (pages.length <= 16) return await read(() => doc.annotations.list(options));
  const result: AnnotationList = { annotations: [], pages: [] };
  yield;
  for (let offset = 0; offset < pages.length; offset += 16) {
    const batch = await read(() => doc.annotations.list({ pages: pages.slice(offset, offset + 16) }));
    result.annotations.push(...batch.annotations);
    result.pages.push(...batch.pages);
    if (offset + 16 < pages.length) yield;
  }
  return result;
}
