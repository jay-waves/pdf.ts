import { useEffect, useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { PluginRegistry } from '@embedpdf/core';
import type { DocumentManagerCapability } from '@embedpdf/plugin-document-manager';
import type { PrintCapability } from '@embedpdf/plugin-print';
import { PdfPermissionFlag } from '@embedpdf/models';
import { getActiveDocumentId } from './utils';

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return fallback;
}

function validatePageRange(value: string, totalPages: number) {
  const compact = value.replace(/\s+/g, '');
  if (!compact || !/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(compact)) return null;

  for (const part of compact.split(',')) {
    const [startValue, endValue = startValue] = part.split('-');
    const start = Number(startValue);
    const end = Number(endValue);
    if (start < 1 || end < start || end > totalPages) return null;
  }
  return compact;
}

export function ShnctlProtectDialog({ registry, open, onClose, onProtected }: {
  registry?: PluginRegistry;
  open: boolean;
  onClose(): void;
  onProtected(): void;
}) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPassword('');
    setConfirmation('');
    setError('');
    setBusy(false);
  }, [open]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!password) {
      setError('Enter a password.');
      return;
    }
    if (password !== confirmation) {
      setError('Passwords do not match.');
      return;
    }

    const documentId = registry ? getActiveDocumentId(registry) : undefined;
    const documents = registry?.getPlugin('document-manager')?.provides?.() as DocumentManagerCapability | undefined;
    if (!documentId || !documents) {
      setError('Document protection is not available.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await documents.setDocumentEncryption(documentId, {
        userPassword: password,
        ownerPassword: password,
        allowedFlags: PdfPermissionFlag.AllowAll,
      }).toPromise();
      onProtected();
      onClose();
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Failed to protect the document.'));
    } finally {
      setBusy(false);
    }
  };

  return <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && !busy && onClose()}>
    <Dialog.Portal>
      <Dialog.Overlay className="shnctl-overlay" />
      <Dialog.Content className="shnctl-popup" aria-describedby={undefined}>
        <Dialog.Title className="shnctl-popup-title">Password protection</Dialog.Title>
        <form className="shnctl-popup-form" onSubmit={submit}>
          <label className="shnctl-popup-field">
            <span>Password</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.currentTarget.value)} autoComplete="new-password" autoFocus />
          </label>
          <label className="shnctl-popup-field">
            <span>Confirm password</span>
            <input type="password" value={confirmation} onChange={(event) => setConfirmation(event.currentTarget.value)} autoComplete="new-password" />
          </label>
          {error ? <div className="shnctl-popup-error" role="alert">{error}</div> : null}
          <div className="shnctl-popup-actions">
            <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="is-primary" disabled={busy}>{busy ? 'Protecting...' : 'Protect'}</button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

type PrintMode = 'all' | 'current' | 'custom';

export function ShnctlPrintDialog({ registry, open, currentPageNumber, totalPages, onClose }: {
  registry?: PluginRegistry;
  open: boolean;
  currentPageNumber: number;
  totalPages: number;
  onClose(): void;
}) {
  const [mode, setMode] = useState<PrintMode>('all');
  const [pageRange, setPageRange] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode('all');
    setPageRange('');
    setError('');
    setBusy(false);
  }, [open]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const documentId = registry ? getActiveDocumentId(registry) : undefined;
    const print = registry?.getPlugin('print')?.provides?.() as PrintCapability | undefined;
    if (!documentId || !print) {
      setError('Printing is not available.');
      return;
    }

    let selectedRange: string | undefined;
    if (mode === 'current') selectedRange = String(currentPageNumber);
    if (mode === 'custom') {
      selectedRange = validatePageRange(pageRange, totalPages) ?? undefined;
      if (!selectedRange) {
        setError(`Enter pages between 1 and ${totalPages}, for example 1,3,5-7.`);
        return;
      }
    }

    setBusy(true);
    setError('');
    try {
      await print.forDocument(documentId).print({ pageRange: selectedRange, includeAnnotations: true }).toPromise();
      onClose();
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Failed to prepare the document for printing.'));
    } finally {
      setBusy(false);
    }
  };

  return <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && !busy && onClose()}>
    <Dialog.Portal>
      <Dialog.Overlay className="shnctl-overlay" />
      <Dialog.Content className="shnctl-popup" aria-describedby={undefined}>
        <Dialog.Title className="shnctl-popup-title">Print</Dialog.Title>
        <form className="shnctl-popup-form" onSubmit={submit}>
          <div className="shnctl-print-modes" role="radiogroup" aria-label="Pages to print">
            <label><input type="radio" name="print-mode" checked={mode === 'all'} onChange={() => setMode('all')} /><span>All pages</span></label>
            <label><input type="radio" name="print-mode" checked={mode === 'current'} onChange={() => setMode('current')} /><span>Current page</span><small>{currentPageNumber}</small></label>
            <label><input type="radio" name="print-mode" checked={mode === 'custom'} onChange={() => setMode('custom')} /><span>Pages</span></label>
          </div>
          {mode === 'custom' ? <label className="shnctl-popup-field">
            <span>Page range</span>
            <input value={pageRange} onChange={(event) => setPageRange(event.currentTarget.value)} placeholder="1,3,5-7" autoFocus />
          </label> : null}
          {error ? <div className="shnctl-popup-error" role="alert">{error}</div> : null}
          <div className="shnctl-popup-actions">
            <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="is-primary" disabled={busy}>{busy ? 'Preparing...' : 'Print'}</button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
