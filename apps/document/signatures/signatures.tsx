import { useEffect, useState } from 'react';
import type { Kernel } from '@embedpdf/core';
import { Button, Dialog, DialogActions } from '../../components';
import type { ManagedResource } from '../../platform/types';
import { onDocumentLoaded } from '../viewer-document';
import type { PdfSignatureObject, SignatureCertificateInfo, SignatureVerificationResult } from './certificate';
import styles from './signatures.module.css';

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

export function SignatureDialog({ signatures, resource, open, onClose }: {
  signatures: PdfSignatureObject[];
  resource?: ManagedResource;
  open: boolean;
  onClose(): void;
}) {
  const [certificates, setCertificates] = useState<Array<SignatureCertificateInfo | null>>([]);
  const [verifications, setVerifications] = useState<SignatureVerificationResult[]>([]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setCertificates([]);
    setVerifications(signatures.map(() => resource ? {
      state: 'pending',
      detail: 'Verification in progress.',
    } : {
      state: 'unsupported',
      detail: 'The original PDF byte stream is unavailable.',
    }));
    void import('./certificate').then(async ({ getSignatureCertificateInfo, verifyPdfSignatures }) => {
      if (controller.signal.aborted) return;
      setCertificates(signatures.map(({ contents }) => getSignatureCertificateInfo(contents)));
      if (resource) {
        const results = await verifyPdfSignatures(resource, signatures, controller.signal);
        if (!controller.signal.aborted) setVerifications(results);
      }
    }).catch((error) => {
      if (!controller.signal.aborted) console.error('[pdf-ts] failed to inspect digital signatures', error);
    });
    return () => controller.abort();
  }, [open, resource, signatures]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      variant="popupWide"
      title={`Digital Signatures (${signatures.length})`}
      titleVariant="panel"
    >
      <div className={styles.list}>
        {signatures.map((signature, index) => {
          const verification = verifications[index] ?? {
            state: 'pending',
            detail: 'Verification in progress.',
          };
          const certificate = certificates[index];
          return (
            <section className={styles.card} key={index}>
              <h3 className={styles.cardTitle}>Signature {index + 1}</h3>
              <dl className={styles.details}>
                {certificate ? (
                  <>
                    <div><dt>Signer</dt><dd>{certificate.signer}</dd></div>
                    <div><dt>Issuer</dt><dd>{certificate.issuer}</dd></div>
                    <div><dt>Valid from</dt><dd>{formatCertificateDate(certificate.validFrom)}</dd></div>
                    <div><dt>Valid until</dt><dd>{formatCertificateDate(certificate.validUntil)}</dd></div>
                  </>
                ) : null}
                <div><dt>Signed at</dt><dd>{formatSignatureTime(signature.time)}</dd></div>
                {signature.reason ? <div><dt>Reason</dt><dd>{signature.reason}</dd></div> : null}
                <div><dt>Format</dt><dd>{signature.subFilter || 'Not provided'}</dd></div>
              </dl>
              <p
                className={styles.status}
                data-verified={verification.state === 'verified' ? 'true' : undefined}
                title={verification.detail}
              >
                {signatureStatusText(verification)}
              </p>
            </section>
          );
        })}
      </div>
      <DialogActions className={styles.actions}>
        <Button variant="primary" onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

export function useDocumentSignatures(
  registry: Kernel | undefined,
  documentId: string | null,
) {
  const [signatures, setSignatures] = useState<PdfSignatureObject[]>([]);

  useEffect(() => {
    setSignatures([]);
    if (!registry || !documentId) return;

    let active = true;
    const unsubscribe = onDocumentLoaded(registry, documentId, (document) => {
      void (async () => {
        // The SDK currently builds the signature model during engine.open();
        // delaying this read alone cannot remove that opening cost.
        // #TODO: When upstream makes full signature analysis lazy, defer this
        // UI read too so document load does not immediately trigger it again.
        const snapshot = await document.signatures.list();
        const next = await Promise.all(snapshot.signatures.filter(s => s.signed).map(async signature => ({
          contents: (await document.signatures.getContents(signature.field)).slice().buffer,
          byteRange: signature.byteRange ?? [],
          subFilter: signature.subFilter ?? '', time: signature.signer.signedAt ?? '', reason: signature.signer.reason,
        })));
        if (active) setSignatures(next);
      })().catch(error => console.error('[pdf-ts] failed to read digital signatures', error));
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [documentId, registry]);

  return signatures;
}
