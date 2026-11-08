import { useState } from 'react';
import type { PdfEngine } from '@embedpdf/models';
import type { DraftState } from '../renderer/document-draft';
import { getSharedDocumentClient } from '../renderer/shared-document-client';

export function DraftNotice({ draft, dirty, engine, documentId, name }: {
  draft: DraftState; dirty: boolean; engine: PdfEngine<Blob>; documentId: string | null; name: string;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!documentId || (!dirty && (draft.draftStatus === 'clean' || draft.draftStatus === 'unavailable'))) return null;
  const labels = {
    clean: 'Saved to PDF', pending: 'Saving draft…', saving: 'Saving draft…',
    saved: 'Draft saved · not yet saved to PDF', error: 'Draft could not be saved',
    conflict: 'Draft conflict · not restored', unavailable: 'Save to PDF required',
  };
  const action = async (discard: boolean) => {
    const client = getSharedDocumentClient(engine);
    if (!client || (discard && !window.confirm('Discard the stored .swp draft? This cannot be undone. Edits currently open will be kept.'))) return;
    setBusy(true); setError('');
    try {
      if (discard) await client.request(documentId, 'sharedDiscardDraft');
      else {
        const reply = await client.request(documentId, 'sharedDownloadDraft');
        if (typeof reply.result !== 'string') throw new Error('No stored draft is available.');
        const url = URL.createObjectURL(new Blob([reply.result], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = `${name}.swp`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  };
  return <aside className="fixed bottom-3 right-4 z-50 max-w-sm rounded-lg border bg-white/95 px-3 py-2 text-xs text-gray-800 shadow dark:bg-gray-900/95 dark:text-gray-100" aria-label="Draft status">
    <div role="status">{labels[draft.draftStatus]}</div>
    {draft.draftError && <p className="mt-1">{draft.draftError}</p>}
    {draft.draftStatus === 'conflict' && <div className="mt-2 flex gap-3">
      <button className="underline" disabled={busy} onClick={() => void action(false)}>Download .swp</button>
      <button className="underline" disabled={busy} onClick={() => void action(true)}>Discard stored draft</button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </aside>;
}
