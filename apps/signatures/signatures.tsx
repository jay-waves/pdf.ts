import { useEffect, useState } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import {
  PDF_FORM_FIELD_TYPE,
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
  type PdfEngine,
  type PdfSignatureObject,
  type PdfWidgetAnnoObject,
} from '@embedpdf/models';
import { createRenderer } from '@embedpdf/plugin-annotation/react';
import { ShieldCheck } from 'lucide-react';
import { Button, Dialog, DialogActions } from '../components';
import type { ManagedResource } from '../platform/types';
import { onDocumentLoaded } from '../viewer-document';
import type { SignatureCertificateInfo, SignatureVerificationResult } from './certificate';
import styles from './signatures.module.css';

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
                <div><dt>Format</dt><dd>{decodeSignatureBuffer(signature.subFilter) || 'Not provided'}</dd></div>
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
  engine: PdfEngine<Blob>,
  registry: PluginRegistry | undefined,
  documentId: string | null,
) {
  const [signatures, setSignatures] = useState<PdfSignatureObject[]>([]);

  useEffect(() => {
    setSignatures([]);
    if (!registry || !documentId) return;

    let active = true;
    const unsubscribe = onDocumentLoaded(registry, documentId, (document) => {
      engine.getSignatures(document).wait(
        (next) => {
          if (active) setSignatures(next);
        },
        (error) => console.error('[pdf-ts] failed to read digital signatures', error),
      );
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [documentId, engine, registry]);

  return signatures;
}

function isSignatureWidget(annotation: PdfAnnotationObject): annotation is PdfWidgetAnnoObject {
  return annotation.type === PdfAnnotationSubtype.WIDGET
    && annotation.field?.type === PDF_FORM_FIELD_TYPE.SIGNATURE;
}

export const signatureWidgetRenderer = createRenderer<PdfWidgetAnnoObject>({
  id: 'signatureWidget',
  matches: isSignatureWidget,
  useAppearanceStream: true,
  interactionDefaults: {
    isDraggable: false,
    isResizable: false,
    isRotatable: false,
  },
  render: ({ currentObject, appearanceActive }) => (
    <div
      className={styles.widget}
      data-appearance-active={appearanceActive ? 'true' : undefined}
      title={appearanceActive ? 'Digital signature' : 'Digital signature appearance unavailable'}
    >
      {!appearanceActive ? (
        <>
          <ShieldCheck aria-hidden="true" />
          <span>{currentObject.field?.name || 'Digital signature'}</span>
        </>
      ) : null}
    </div>
  ),
});
