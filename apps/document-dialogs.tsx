import {
  useEffect,
  useState,
  type ComponentProps,
  type CSSProperties,
  type FormEvent,
} from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import type { DocumentManagerCapability } from '@embedpdf/plugin-document-manager';
import type { PrintCapability } from '@embedpdf/plugin-print';
import {
  PdfPermissionFlag,
  type PdfMetadataObject,
  type PdfSignatureObject,
} from '@embedpdf/models';
import { RadioGroup as RadixRadioGroup } from 'radix-ui';
import { Button, Dialog, DialogActions, RadioOption } from './components';
import { getDocumentCapability } from './utils';
import {
  getSignatureCertificateInfo,
  type SignatureVerificationResult,
} from './signature-certificate';
import styles from './document-dialogs.module.css';
import {
  getViewerThemeOptions,
  getViewerThemeSettings,
  setViewerThemeSettings,
} from './theme';


function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return fallback;
}

function FlatDocumentDialog(props: ComponentProps<typeof Dialog>) {
  return (
    <Dialog
      {...props}
      variant="popup"
      titleClassName={styles.flatTitle}
      contentClassName={styles.flatDialog}
      overlayClassName={styles.flatOverlay}
    />
  );
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

function formatMetadataDate(value: Date | null) {
  if (!value || Number.isNaN(value.getTime())) return 'Not provided';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(value);
}

export function MetadataDialog({ registry, open, fileName, pageCount, onClose }: {
  registry?: PluginRegistry;
  open: boolean;
  fileName?: string;
  pageCount: number;
  onClose(): void;
}) {
  const [metadata, setMetadata] = useState<PdfMetadataObject | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const scoped = getDocumentCapability<DocumentManagerCapability>(registry, 'document-manager');
    const document = scoped?.capability.getDocument(scoped.documentId);
    const engine = registry?.getEngine();

    setMetadata(null);
    setError('');
    setLoading(false);
    if (!document || !engine) {
      setError('Document metadata is not available.');
      return;
    }

    setLoading(true);
    void engine.getMetadata(document).toPromise().then((nextMetadata) => {
      if (!cancelled) setMetadata(nextMetadata);
    }).catch((nextError: unknown) => {
      if (!cancelled) setError(getErrorMessage(nextError, 'Failed to read document metadata.'));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [open, registry]);

  const fields = metadata ? [
    ['File name', fileName],
    ['Pages', String(pageCount)],
    ['Title', metadata.title],
    ['Author', metadata.author],
    ['Creator', metadata.creator],
    ['Producer', metadata.producer],
    ['Created', formatMetadataDate(metadata.creationDate)],
    ['Modified', formatMetadataDate(metadata.modificationDate)],
  ] : [];

  return (
    <FlatDocumentDialog
      open={open}
      onClose={onClose}
      title="Metadata"
    >
      <div className={styles.metadataContent}>
        {loading ? <div className={styles.metadataStatus}>Loading metadata…</div> : null}
        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        {metadata ? (
          <dl className={styles.metadataDetails}>
            {fields.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value || 'Not provided'}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <DialogActions className={styles.flatActions}>
          <Button className={styles.flatButton} variant="primary" onClick={onClose}>Close</Button>
        </DialogActions>
      </div>
    </FlatDocumentDialog>
  );
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
      variant="popupWide"
      title={`Digital Signatures (${signatures.length})`}
      titleClassName={styles.title}
    >
      <div className={styles.signatureList}>
        {signatures.map((signature, index) => {
          const verification = verifications[index] ?? {
            state: 'pending',
            detail: 'Verification in progress.',
          };
          return (
            <section className={styles.signatureCard} key={index}>
              <h3 className={styles.signatureTitle}>Signature {index + 1}</h3>
              <dl className={styles.signatureDetails}>
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
                className={styles.signatureStatus}
                data-verified={verification.state === 'verified' ? 'true' : undefined}
                title={verification.detail}
              >
                {signatureStatusText(verification)}
              </p>
            </section>
          );
        })}
      </div>
      <DialogActions className={styles.signatureActions}>
        <Button variant="primary" onClick={onClose}>Close</Button>
      </DialogActions>
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
      if (isProtected) {
        await removeProtection();
        return;
      }
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

  async function removeProtection() {
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
  }

  return (
    <FlatDocumentDialog
      open={open}
      onClose={onClose}
      preventClose={busy}
      title="Password protection"
    >
      <form className={styles.form} onSubmit={submit}>
        <label className={styles.field}>
          <span>Password</span>
          <input
            className={styles.input}
            type="password"
            value={password}
            onChange={(event) => {
              const nextPassword = event.currentTarget.value;
              setPassword(nextPassword);
              if (nextPassword && removalRequested) {
                setRemovalRequested(false);
                setOwnerPassword('');
                setError('');
              }
            }}
            autoComplete="new-password"
            autoFocus
          />
        </label>
        <label className={styles.field}>
          <span>Confirm password</span>
          <input className={styles.input} type="password" value={confirmation} onChange={(event) => setConfirmation(event.currentTarget.value)} autoComplete="new-password" />
        </label>
        {isProtected && removalRequested && requiresOwnerPassword ? (
          <label className={styles.field}>
            <span>Owner password</span>
            <input
              type="password"
              className={styles.input}
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
        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        <DialogActions className={styles.flatActions}>
          <Button className={styles.flatButton} onClick={onClose} disabled={busy}>Cancel</Button>
          <Button className={styles.flatButton} type="submit" variant="primary" disabled={busy}>
            {busyAction === 'remove'
              ? 'Removing...'
              : busyAction === 'protect'
                ? 'Saving...'
                : isProtected && !password
                  ? 'Remove password'
                  : isProtected ? 'Change password' : 'Protect'}
          </Button>
        </DialogActions>
      </form>
    </FlatDocumentDialog>
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
      variant="popup"
      preventClose
      title="Password required"
      titleClassName={styles.title}
    >
      <form className={styles.form} onSubmit={submit}>
        <label className={styles.field}>
          <span>This PDF is password protected.</span>
          <input
            type="password"
            className={styles.input}
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            autoComplete="current-password"
            autoFocus
          />
        </label>
        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        <DialogActions>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Opening...' : 'Open PDF'}
          </Button>
        </DialogActions>
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
    <FlatDocumentDialog
      open={open}
      onClose={onClose}
      preventClose={busy}
      title="Print"
    >
      <form className={styles.form} onSubmit={submit}>
        <RadixRadioGroup.Root
          className={styles.optionGroup}
          value={mode}
          onValueChange={(value) => {
            if (value === 'all' || value === 'current' || value === 'custom') setMode(value);
          }}
          aria-label="Pages to print"
        >
          {PRINT_MODE_OPTIONS.map((option) => (
            <RadioOption
              value={option.value}
              trailing={option.value === 'current' ? currentPageNumber : undefined}
              key={option.value}
            >
              {option.label}
            </RadioOption>
          ))}
        </RadixRadioGroup.Root>
        {mode === 'custom' ? (
          <label className={styles.field}>
            <span>Page range</span>
            <input className={styles.input} value={pageRange} onChange={(event) => setPageRange(event.currentTarget.value)} placeholder="1,3,5-7" autoFocus />
          </label>
        ) : null}
        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        <DialogActions className={styles.flatActions}>
          <Button className={styles.flatButton} onClick={onClose} disabled={busy}>Cancel</Button>
          <Button className={styles.flatButton} type="submit" variant="primary" disabled={busy}>{busy ? 'Preparing...' : 'Print'}</Button>
        </DialogActions>
      </form>
    </FlatDocumentDialog>
  );
}

const LIGHT_THEME_OPTIONS = getViewerThemeOptions('light');
const DARK_THEME_OPTIONS = getViewerThemeOptions('dark');

function ThemeOptionRow<Option extends string>({
  label,
  value,
  options,
  onValueChange,
}: {
  label: string;
  value: Option;
  options: Array<{ value: Option; label: string }>;
  onValueChange(value: Option): void;
}) {
  const gridStyle = { '--theme-option-count': options.length } as CSSProperties;
  return <div className={styles.themeRow}>
    <span>{label}</span>
    <RadixRadioGroup.Root
      className={styles.themeOptions}
      style={gridStyle}
      value={value}
      onValueChange={(nextValue) => {
        const option = options.find((candidate) => candidate.value === nextValue);
        if (option) onValueChange(option.value);
      }}
      aria-label={`${label} appearance theme`}
    >
      {options.map((option) => (
        <RadixRadioGroup.Item
          key={option.value}
          value={option.value}
          className={styles.themeOption}
        >
          {option.label}
        </RadixRadioGroup.Item>
      ))}
    </RadixRadioGroup.Root>
  </div>;
}

export function ThemeDialog({ open, onClose }: {
  open: boolean;
  onClose(): void;
}) {
  const [settings, setSettings] = useState(getViewerThemeSettings);

  useEffect(() => {
    if (open) setSettings(getViewerThemeSettings());
  }, [open]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setViewerThemeSettings(settings);
    onClose();
  };

  return (
    <FlatDocumentDialog open={open} onClose={onClose} title="Themes">
      <form className={`${styles.form} ${styles.themeForm}`} onSubmit={submit}>
        <ThemeOptionRow
          label="Light"
          value={settings.light}
          options={LIGHT_THEME_OPTIONS}
          onValueChange={(light) => setSettings((current) => ({ ...current, light }))}
        />
        <ThemeOptionRow
          label="Dark"
          value={settings.dark}
          options={DARK_THEME_OPTIONS}
          onValueChange={(dark) => setSettings((current) => ({ ...current, dark }))}
        />
        <DialogActions className={styles.flatActions}>
          <Button className={styles.flatButton} onClick={onClose}>Cancel</Button>
          <Button className={styles.flatButton} type="submit" variant="primary">Save</Button>
        </DialogActions>
      </form>
    </FlatDocumentDialog>
  );
}
