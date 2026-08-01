import { useEffect, useState, type FormEvent } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import type { DocumentManagerCapability } from '@embedpdf/plugin-document-manager';
import type { PrintCapability } from '@embedpdf/plugin-print';
import { PdfPermissionFlag, type PdfSignatureObject } from '@embedpdf/models';
import { RadioGroup as RadixRadioGroup } from 'radix-ui';
import { Dialog } from './components';
import { getDocumentCapability } from './utils';
import {
  getSignatureCertificateInfo,
  type SignatureVerificationResult,
} from './signature-certificate';

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

function decodeSignatureBuffer(value: ArrayBuffer) {
  return new TextDecoder().decode(value).replace(/\0+$/g, '').trim();
}

function formatSignatureTime(value: string) {
  const match = value.match(/^D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!match) return value || 'Not provided';
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function formatCertificateDate(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

function signatureStatusText(verification: SignatureVerificationResult) {
  switch (verification.state) {
    case 'verified': return 'Integrity verified · Certificate trust not established';
    case 'failed': return 'Document integrity check failed';
    case 'unsupported': return 'Verification unavailable';
    default: return 'Verifying document integrity…';
  }
}

export function SignatureDialog({ signatures, verifications, open, onClose }: {
  signatures: PdfSignatureObject[];
  verifications: SignatureVerificationResult[];
  open: boolean;
  onClose(): void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Digital Signatures (${signatures.length})`}
      titleClassName="shnctl-popup-title"
      contentClassName="shnctl-popup shnctl-signature-dialog"
    >
      <div className="shnctl-signature-list">
        {signatures.map((signature, index) => {
          const verification = verifications[index] ?? {
            state: 'pending',
            detail: 'Verification in progress.',
          };
          return (
            <section className="shnctl-signature-card" key={index}>
              <h3>Signature {index + 1}</h3>
              <dl>
                {(() => {
                  const certificate = getSignatureCertificateInfo(signature.contents);
                  return certificate ? (
                    <>
                      <div><dt>Signer</dt><dd>{certificate.signer}</dd></div>
                      <div><dt>Issuer</dt><dd>{certificate.issuer}</dd></div>
                      <div><dt>Valid from</dt><dd>{formatCertificateDate(certificate.validFrom)}</dd></div>
                      <div><dt>Valid until</dt><dd>{formatCertificateDate(certificate.validUntil)}</dd></div>
                    </>
                  ) : null;
                })()}
                <div><dt>Signed at</dt><dd>{formatSignatureTime(signature.time)}</dd></div>
                {signature.reason ? <div><dt>Reason</dt><dd>{signature.reason}</dd></div> : null}
                <div><dt>Format</dt><dd>{decodeSignatureBuffer(signature.subFilter) || 'Not provided'}</dd></div>
              </dl>
              <p
                className={`shnctl-signature-status is-${verification.state}`}
                title={verification.detail}
              >
                {signatureStatusText(verification)}
              </p>
            </section>
          );
        })}
      </div>
      <div className="shnctl-popup-actions">
        <button type="button" className="is-primary" onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}

export function ProtectDialog({ registry, open, onClose, protectionState, onProtectionChanged }: {
  registry?: PluginRegistry;
  open: boolean;
  onClose(): void;
  protectionState: boolean | null;
  onProtectionChanged(isProtected: boolean): void;
}) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [removalRequested, setRemovalRequested] = useState(false);
  const [error, setError] = useState('');
  const [busyAction, setBusyAction] = useState<'protect' | 'remove' | null>(null);
  const busy = busyAction !== null;

  const scoped = getDocumentCapability<DocumentManagerCapability>(registry, 'document-manager');
  const document = scoped?.capability.getDocument(scoped.documentId);
  const isProtected = protectionState ?? document?.isEncrypted ?? false;
  const requiresOwnerPassword = document?.isEncrypted === true && !document.isOwnerUnlocked;

  useEffect(() => {
    if (!open) return;
    setPassword('');
    setConfirmation('');
    setOwnerPassword('');
    setRemovalRequested(false);
    setError('');
    setBusyAction(null);
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

    if (!scoped) {
      setError('Document protection is not available.');
      return;
    }

    setBusyAction('protect');
    setError('');
    try {
      const protectedDocument = await scoped.capability.setDocumentEncryption(scoped.documentId, {
        userPassword: password,
        ownerPassword: password,
        allowedFlags: PdfPermissionFlag.AllowAll,
      }).toPromise();
      if (!protectedDocument) throw new Error('PDFium rejected document protection.');
      onProtectionChanged(true);
      onClose();
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Failed to protect the document.'));
    } finally {
      setBusyAction(null);
    }
  };

  const removeProtection = async () => {
    if (!scoped || !document) {
      setError('Document protection is not available.');
      return;
    }

    if (requiresOwnerPassword && !removalRequested) {
      setRemovalRequested(true);
      setError('Enter the owner password to remove protection.');
      return;
    }
    if (requiresOwnerPassword && !ownerPassword) {
      setError('Enter the owner password to remove protection.');
      return;
    }

    setBusyAction('remove');
    setError('');
    try {
      if (requiresOwnerPassword) {
        const unlocked = await scoped.capability.unlockOwnerPermissions(
          scoped.documentId,
          ownerPassword,
        ).toPromise();
        if (!unlocked) {
          setError('Incorrect owner password.');
          return;
        }
      }

      const removed = await scoped.capability.removeEncryption(scoped.documentId).toPromise();
      if (!removed) throw new Error('PDFium rejected password removal.');
      onProtectionChanged(false);
      onClose();
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Failed to remove password protection.'));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      preventClose={busy}
      title="Password protection"
      titleClassName="shnctl-popup-title"
      contentClassName="shnctl-popup"
    >
      <form className="shnctl-popup-form" onSubmit={submit}>
        <label className="shnctl-popup-field">
          <span>Password</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.currentTarget.value)} autoComplete="new-password" autoFocus />
        </label>
        <label className="shnctl-popup-field">
          <span>Confirm password</span>
          <input type="password" value={confirmation} onChange={(event) => setConfirmation(event.currentTarget.value)} autoComplete="new-password" />
        </label>
        {isProtected && removalRequested && requiresOwnerPassword ? (
          <label className="shnctl-popup-field">
            <span>Owner password</span>
            <input
              type="password"
              value={ownerPassword}
              onChange={(event) => setOwnerPassword(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                void removeProtection();
              }}
              autoComplete="current-password"
              autoFocus
            />
          </label>
        ) : null}
        {error ? <div className="shnctl-popup-error" role="alert">{error}</div> : null}
        <div className="shnctl-popup-actions">
          {isProtected ? (
            <button type="button" onClick={() => void removeProtection()} disabled={busy}>
              {busyAction === 'remove' ? 'Removing...' : 'Remove password'}
            </button>
          ) : null}
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="is-primary" disabled={busy}>
            {busyAction === 'protect' ? 'Saving...' : isProtected ? 'Change password' : 'Protect'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function OpenPasswordDialog({ registry, documentId, incorrect }: {
  registry?: PluginRegistry;
  documentId: string;
  incorrect: boolean;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(incorrect ? 'Incorrect password. Try again.' : '');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!password) {
      setError('Enter the password to open this PDF.');
      return;
    }

    const scoped = getDocumentCapability<DocumentManagerCapability>(
      registry,
      'document-manager',
      documentId,
    );
    if (!scoped) {
      setError('Password verification is not available.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const retry = await scoped.capability.retryDocument(documentId, { password }).toPromise();
      await retry.task.toPromise();
    } catch {
      // The document manager changes the document back to its error state,
      // which remounts this dialog for the next attempt.
      setError('Incorrect password. Try again.');
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={() => {}}
      preventClose
      title="Password required"
      titleClassName="shnctl-popup-title"
      contentClassName="shnctl-popup"
    >
      <form className="shnctl-popup-form" onSubmit={submit}>
        <label className="shnctl-popup-field">
          <span>This PDF is password protected.</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            autoComplete="current-password"
            autoFocus
          />
        </label>
        {error ? <div className="shnctl-popup-error" role="alert">{error}</div> : null}
        <div className="shnctl-popup-actions">
          <button type="submit" className="is-primary" disabled={busy}>
            {busy ? 'Opening...' : 'Open PDF'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

type PrintMode = 'all' | 'current' | 'custom';
const PRINT_MODE_OPTIONS = [
  { value: 'all', label: 'All pages' },
  { value: 'current', label: 'Current page' },
  { value: 'custom', label: 'Pages' },
] as const;

export function PrintDialog({ registry, open, currentPageNumber, totalPages, onClose }: {
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
    const scoped = getDocumentCapability<PrintCapability>(registry, 'print');
    if (!scoped) {
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
      await scoped.capability.forDocument(scoped.documentId)
        .print({ pageRange: selectedRange, includeAnnotations: true })
        .toPromise();
      onClose();
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Failed to prepare the document for printing.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      preventClose={busy}
      title="Print"
      titleClassName="shnctl-popup-title"
      contentClassName="shnctl-popup"
    >
      <form className="shnctl-popup-form" onSubmit={submit}>
        <RadixRadioGroup.Root
          className="shnctl-print-modes"
          value={mode}
          onValueChange={(value) => {
            if (value === 'all' || value === 'current' || value === 'custom') setMode(value);
          }}
          aria-label="Pages to print"
        >
          {PRINT_MODE_OPTIONS.map((option) => (
            <label className="shnctl-radio-item" key={option.value}>
              <RadixRadioGroup.Item className="shnctl-radio-control" value={option.value}>
                <RadixRadioGroup.Indicator className="shnctl-radio-indicator" />
              </RadixRadioGroup.Item>
              <span>{option.label}</span>
              {option.value === 'current' ? <small>{currentPageNumber}</small> : null}
            </label>
          ))}
        </RadixRadioGroup.Root>
        {mode === 'custom' ? (
          <label className="shnctl-popup-field">
            <span>Page range</span>
            <input value={pageRange} onChange={(event) => setPageRange(event.currentTarget.value)} placeholder="1,3,5-7" autoFocus />
          </label>
        ) : null}
        {error ? <div className="shnctl-popup-error" role="alert">{error}</div> : null}
        <div className="shnctl-popup-actions">
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="is-primary" disabled={busy}>{busy ? 'Preparing...' : 'Print'}</button>
        </div>
      </form>
    </Dialog>
  );
}
