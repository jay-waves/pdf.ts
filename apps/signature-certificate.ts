import * as asn1js from 'asn1js';
import {
  Certificate,
  ContentInfo,
  IssuerAndSerialNumber,
  SignedData,
} from 'pkijs';

export interface SignatureCertificateInfo {
  signer: string;
  issuer: string;
  validFrom: Date;
  validUntil: Date;
}

const DN_LABELS: Record<string, string> = {
  '2.5.4.3': 'CN',
  '2.5.4.6': 'C',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
  '1.2.840.113549.1.9.1': 'E',
};

function equalBytes(left: Uint8Array, right: Uint8Array) {
  return left.byteLength === right.byteLength
    && left.every((value, index) => value === right[index]);
}

function attributeValue(attribute: Certificate['subject']['typesAndValues'][number]) {
  const block = attribute.value.valueBlock as { value?: unknown };
  return typeof block.value === 'string' ? block.value : attribute.value.toString();
}

function formatDistinguishedName(name: Certificate['subject']) {
  const values = name.typesAndValues.map((attribute) => ({
    type: attribute.type,
    value: attributeValue(attribute),
  }));
  const preferred = ['2.5.4.3', '2.5.4.10', '2.5.4.11']
    .map((type) => values.find((item) => item.type === type)?.value)
    .find(Boolean);
  if (preferred) return preferred;
  return values.map(({ type, value }) => `${DN_LABELS[type] ?? type}=${value}`).join(', ') || 'Not provided';
}

function getSubjectKeyIdentifier(certificate: Certificate) {
  const extension = certificate.extensions?.find(({ extnID }) => extnID === '2.5.29.14');
  if (!extension) return null;
  const parsed = asn1js.fromBER(extension.extnValue.valueBlock.valueHexView);
  return parsed.offset !== -1 && parsed.result instanceof asn1js.OctetString
    ? parsed.result.valueBlock.valueHexView
    : null;
}

function findSignerCertificate(signedData: SignedData) {
  const certificates = (signedData.certificates ?? [])
    .filter((item): item is Certificate => item instanceof Certificate);
  const signer = signedData.signerInfos[0];
  if (!signer) return null;

  if (signer.sid instanceof IssuerAndSerialNumber) {
    const serial = signer.sid.serialNumber.valueBlock.valueHexView;
    return certificates.find((certificate) => (
      certificate.issuer.isEqual(signer.sid.issuer)
      && equalBytes(certificate.serialNumber.valueBlock.valueHexView, serial)
    )) ?? null;
  }

  if (signer.sid instanceof asn1js.OctetString) {
    const identifier = signer.sid.valueBlock.valueHexView;
    return certificates.find((certificate) => {
      const subjectKeyIdentifier = getSubjectKeyIdentifier(certificate);
      return subjectKeyIdentifier ? equalBytes(subjectKeyIdentifier, identifier) : false;
    }) ?? null;
  }

  return null;
}

export function getSignatureCertificateInfo(contents: ArrayBuffer): SignatureCertificateInfo | null {
  try {
    const asn1 = asn1js.fromBER(contents);
    if (asn1.offset === -1) return null;
    const contentInfo = new ContentInfo({ schema: asn1.result });
    if (contentInfo.contentType !== ContentInfo.SIGNED_DATA) return null;
    const certificate = findSignerCertificate(new SignedData({ schema: contentInfo.content }));
    if (!certificate) return null;
    return {
      signer: formatDistinguishedName(certificate.subject),
      issuer: formatDistinguishedName(certificate.issuer),
      validFrom: certificate.notBefore.value,
      validUntil: certificate.notAfter.value,
    };
  } catch (error) {
    console.info('[pdf-ts] unable to parse signature certificate', error);
    return null;
  }
}
