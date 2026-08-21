import { useEffect, useState, type FormEvent } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import { PdfPermissionFlag } from '@embedpdf/models';
import type { DocumentManagerCapability } from '@embedpdf/plugin-document-manager';
import { Button, Dialog, DialogActions } from '../components';
import { getErrorMessage, getPluginCapability } from '../shared/utils';
import styles from './document-dialogs.module.css';
import { DocumentDialog } from './document-dialog-shared';

export function ProtectDialog({ registry, documentId, open, onClose, onProtectionChanged }: {
  registry?: PluginRegistry;
  documentId?: string | null;
  open: boolean;
  onClose(): void;
  onProtectionChanged(): void;
}) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [removalRequested, setRemovalRequested] = useState(false);
  const [error, setError] = useState('');
  const [busyAction, setBusyAction] = useState<'protect' | 'remove' | null>(null);
  const [protectionState, setProtectionState] = useState<boolean | null>(null);
  const busy = busyAction !== null;

  const manager = getPluginCapability<DocumentManagerCapability>(registry, 'document-manager');
  const document = documentId ? manager?.getDocument(documentId) : undefined;
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
      if (isProtected) await removeProtection();
      else setError('Enter a password.');
      return;
    }
    if (password !== confirmation) {
      setError('Passwords do not match.');
      return;
    }
    if (!manager || !documentId) {
      setError('Document protection is not available.');
      return;
    }

    setBusyAction('protect');
    setError('');
    try {
      const updated = await manager.setDocumentEncryption(documentId, {
        userPassword: password,
        ownerPassword: password,
        allowedFlags: PdfPermissionFlag.AllowAll,
      }).toPromise();
      if (!updated) throw new Error('PDFium rejected document protection.');
      setProtectionState(true);
      onProtectionChanged();
      onClose();
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Failed to protect the document.'));
    } finally {
      setBusyAction(null);
    }
  };

  async function removeProtection() {
    if (!manager || !document || !documentId) {
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
        const unlocked = await manager.unlockOwnerPermissions(documentId, ownerPassword).toPromise();
        if (!unlocked) {
          setError('Incorrect owner password.');
          return;
        }
      }

      const removed = await manager.removeEncryption(documentId).toPromise();
      if (!removed) throw new Error('PDFium rejected password removal.');
      setProtectionState(false);
      onProtectionChanged();
      onClose();
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Failed to remove password protection.'));
    } finally {
      setBusyAction(null);
    }
  }

  let actionLabel = isProtected ? 'Change password' : 'Protect';
  if (busyAction === 'remove') actionLabel = 'Removing...';
  else if (busyAction === 'protect') actionLabel = 'Saving...';
  else if (isProtected && !password) actionLabel = 'Remove password';

  return (
    <DocumentDialog
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
          <input
            className={styles.input}
            type="password"
            value={confirmation}
            autoComplete="new-password"
            onChange={(event) => setConfirmation(event.currentTarget.value)}
          />
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
          <Button appearance="flat" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button
            appearance="flat"
            type="submit"
            variant="primary"
            disabled={busy}
          >
            {actionLabel}
          </Button>
        </DialogActions>
      </form>
    </DocumentDialog>
  );
}

export function UnlockDialog({ registry, documentId, incorrect }: {
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

    const manager = getPluginCapability<DocumentManagerCapability>(registry, 'document-manager');
    if (!manager) {
      setError('Password verification is not available.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const retry = await manager.retryDocument(documentId, { password }).toPromise();
      await retry.task.toPromise();
    } catch {
      // The document manager remounts this dialog when it returns to the error state.
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
      titleVariant="panel"
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
