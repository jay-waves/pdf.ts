import { useEffect, useState } from 'react';
import { Button, DialogActions } from '../components';
import { getErrorMessage } from '../shared/utils';
import styles from './document-dialogs.module.css';
import { DocumentDialog } from './document-dialog-shared';

export function ExternalChangeDialog({
  open,
  onDiscard,
  onSaveCopy,
}: {
  open: boolean;
  onDiscard(): Promise<void>;
  onSaveCopy(): Promise<void>;
}) {
  const [busy, setBusy] = useState<'discard' | 'copy' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setBusy(null);
    setError('');
  }, [open]);

  const run = async (action: 'discard' | 'copy') => {
    setBusy(action);
    setError('');
    try {
      if (action === 'copy') await onSaveCopy();
      else await onDiscard();
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Failed to reload the updated document.'));
      setBusy(null);
    }
  };

  return (
    <DocumentDialog
      open={open}
      onClose={() => {}}
      preventClose
      title="Document Updated"
    >
      <div className={styles.form}>
        <p className="m-0 text-xs leading-5 text-secondary">
          This PDF was updated on disk. Your unsaved changes cannot be merged with the new version.
        </p>
        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        <DialogActions className={styles.flatActions}>
          <Button appearance="flat" disabled={busy !== null} onClick={() => void run('discard')}>
            {busy === 'discard' ? 'Reloading...' : 'Discard Changes'}
          </Button>
          <Button
            appearance="flat"
            variant="primary"
            disabled={busy !== null}
            onClick={() => void run('copy')}
          >
            {busy === 'copy' ? 'Saving...' : 'Save a Copy'}
          </Button>
        </DialogActions>
      </div>
    </DocumentDialog>
  );
}
