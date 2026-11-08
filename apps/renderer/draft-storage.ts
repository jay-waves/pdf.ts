import { get, set } from 'idb-keyval';
import { sha256 } from 'hash-wasm';
import { fingerprintFile } from '../platform/file-fingerprint';

export interface DraftLocation { endpoint?: string; key?: string }
export interface StoredDraft { text: string | null; version: string }
export interface DraftStorage {
  read(): Promise<StoredDraft>;
  write(text: string, expected: string, baseVersion: string): Promise<string>;
  remove(expected: string): Promise<void>;
}
export class DraftConflict extends Error {}
const missing = 'missing';

export async function openDraftStorage(identity: string | FileSystemFileHandle, location?: DraftLocation): Promise<DraftStorage> {
  if (location?.endpoint) {
    const endpoint = new URL(location.endpoint, self.location.href);
    if (endpoint.origin !== self.location.origin || !/^\/api\/documents\/[^/]+\/draft$/.test(endpoint.pathname)) throw new Error('Invalid draft endpoint.');
    const request = async (method: string, expected?: string, text?: string, baseVersion?: string) => {
      const response = await fetch(endpoint, { method, cache: 'no-store', body: text,
        headers: { ...(expected ? { 'If-Match': `"${expected}"` } : {}),
          ...(text ? { 'Content-Type': 'application/json', 'X-Pdf-Ts-Version': baseVersion! } : {}) } });
      if (response.status === 409 || response.status === 412) throw new DraftConflict('The PDF or its .swp draft changed elsewhere. Your edits have not overwritten it.');
      if (!response.ok) throw new Error(`Could not ${method === 'GET' ? 'read' : 'save'} the .swp draft (${response.status}).`);
      return response;
    };
    return {
      async read() { const r = await request('GET'); return { text: r.status === 204 ? null : await r.text(), version: r.headers.get('ETag')?.replace(/^"|"$/g, '') ?? missing }; },
      async write(text, expected, baseVersion) { const r = await request('PUT', expected, text, baseVersion); return r.headers.get('ETag')!.replace(/^"|"$/g, ''); },
      async remove(expected) { await request('DELETE', expected); },
    };
  }
  // OPFS files are real *.swp files scoped to this browser origin. File handles
  // use persisted isSameEntry identity, not a changing size or modification date.
  const key = typeof identity === 'string' ? location?.key ?? identity : await navigator.locks.request('pdf-ts-draft-handles', async () => {
    const entries = await get<{ handle: FileSystemFileHandle; key: string }[]>('pdf-ts-draft-handles') ?? [];
    for (const entry of entries) if (await entry.handle.isSameEntry(identity)) return entry.key;
    const key = crypto.randomUUID(); entries.push({ handle: identity, key });
    await set('pdf-ts-draft-handles', entries); return key;
  });
  const name = `${await sha256(key)}.swp`;
  const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('pdf-ts-drafts', { create: true });
  const read = async (): Promise<StoredDraft> => {
    try { const file = await (await directory.getFileHandle(name)).getFile(); const text = await file.text(); return { text, version: await sha256(text) }; }
    catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') return { text: null, version: missing }; throw error; }
  };
  const lock = <T>(operation: () => Promise<T>) => navigator.locks.request(`pdf-ts-draft:${name}`, operation);
  return {
    read: () => lock(read),
    write: (text, expected, baseVersion) => lock(async () => {
      if (typeof identity !== 'string' && await fingerprintFile(await identity.getFile()) !== baseVersion) {
        throw new DraftConflict('The PDF changed since the draft was opened.');
      }
      if ((await read()).version !== expected) throw new DraftConflict('The browser draft changed in another session.');
      const writer = await (await directory.getFileHandle(name, { create: true })).createWritable();
      try { await writer.write(text); await writer.close(); } catch (error) { await writer.abort().catch(() => {}); throw error; }
      return sha256(text);
    }),
    remove: expected => lock(async () => {
      if ((await read()).version !== expected) throw new DraftConflict('The browser draft changed in another session.');
      if (expected !== missing) await directory.removeEntry(name);
    }),
  };
}
