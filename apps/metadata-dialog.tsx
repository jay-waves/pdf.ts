import { useEffect, useState } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import type { PdfMetadataObject } from '@embedpdf/models';
import type { DocumentManagerCapability } from '@embedpdf/plugin-document-manager';
import { Button, DialogActions } from './components';
import { getDocumentCapability } from './utils';
import styles from './document-dialogs.module.css';
import { FlatDocumentDialog, getErrorMessage } from './document-dialog-shared';

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
    ['PDF.ts', __PDF_TS_BUILD_INFO__],
    ['Title', metadata.title],
    ['Author', metadata.author],
    ['Creator', metadata.creator],
    ['Producer', metadata.producer],
    ['Created', formatMetadataDate(metadata.creationDate)],
    ['Modified', formatMetadataDate(metadata.modificationDate)],
  ] : [];

  return (
    <FlatDocumentDialog open={open} onClose={onClose} title="Metadata">
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
          <Button className={styles.flatButton} variant="primary" onClick={onClose}>
            Close
          </Button>
        </DialogActions>
      </div>
    </FlatDocumentDialog>
  );
}
