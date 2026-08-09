import * as asn1js from 'asn1js';
import {
  Certificate,
  ContentInfo,
  getCrypto,
  IssuerAndSerialNumber,
  SignedData,
} from 'pkijs';
import {
  createSHA1,
  createSHA224,
  createSHA256,
  createSHA384,
  createSHA512,
  type IHasher,
} from 'hash-wasm';
import type { PdfSignatureObject } from '@embedpdf/models';
import type { ManagedResource } from '../platform/types';

export interface SignatureCertificateInfo {
  signer: string;
  issuer: string;
  validFrom: Date;
  validUntil: Date;
}

export type SignatureVerificationState = 'pending' | 'verified' | 'failed' | 'unsupported';

export interface SignatureVerificationResult {
  state: SignatureVerificationState;
  detail: string;
}

interface ByteSpan {
  start: number;
  end: number;
}

interface SignatureVerificationWork {
  index: number;
  spans: ByteSpan[];
  hasher: IHasher;
  expectedDigest: Uint8Array;
  signedData: SignedData;
  certificate: Certificate;
  hashAlgorithm: string;
}

const CONTENT_TYPE_ATTRIBUTE = '1.2.840.113549.1.9.3';
const MESSAGE_DIGEST_ATTRIBUTE = '1.2.840.113549.1.9.4';
const RSA_ENCRYPTION = '1.2.840.113549.1.1.1';
const certificateInfoCache = new WeakMap<ArrayBuffer, SignatureCertificateInfo | null>();

const HASH_FACTORIES: Record<string, () => Promise<IHasher>> = {
  '1.3.14.3.2.26': createSHA1,
  '2.16.840.1.101.3.4.2.4': createSHA224,
  '2.16.840.1.101.3.4.2.1': createSHA256,
  '2.16.840.1.101.3.4.2.2': createSHA384,
  '2.16.840.1.101.3.4.2.3': createSHA512,
};

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

function parseSignedData(contents: ArrayBuffer) {
  const asn1 = asn1js.fromBER(contents);
  if (asn1.offset === -1) throw new Error('The CMS signature is malformed.');
  const contentInfo = new ContentInfo({ schema: asn1.result });
  if (contentInfo.contentType !== ContentInfo.SIGNED_DATA) {
    throw new Error('The signature is not CMS SignedData.');
  }
  return new SignedData({ schema: contentInfo.content });
}

function toCertificateInfo(certificate: Certificate): SignatureCertificateInfo {
  return {
    signer: formatDistinguishedName(certificate.subject),
    issuer: formatDistinguishedName(certificate.issuer),
    validFrom: certificate.notBefore.value,
    validUntil: certificate.notAfter.value,
  };
}

export function getSignatureCertificateInfo(contents: ArrayBuffer): SignatureCertificateInfo | null {
  const cached = certificateInfoCache.get(contents);
  if (cached !== undefined || certificateInfoCache.has(contents)) return cached ?? null;
  try {
    const certificate = findSignerCertificate(parseSignedData(contents));
    const info = certificate ? toCertificateInfo(certificate) : null;
    certificateInfoCache.set(contents, info);
    return info;
  } catch (error) {
    console.info('[pdf-ts] unable to parse signature certificate', error);
    certificateInfoCache.set(contents, null);
    return null;
  }
}

function readByteSpans(byteRange: ArrayBuffer): ByteSpan[] {
  if (byteRange.byteLength < 16 || byteRange.byteLength % Uint32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error('The signature ByteRange is malformed.');
  }

  const values = new Uint32Array(byteRange);
  if (values.length % 2 !== 0) throw new Error('The signature ByteRange is malformed.');
  const spans: ByteSpan[] = [];
  for (let index = 0; index < values.length; index += 2) {
    const start = values[index];
    const length = values[index + 1];
    const end = start + length;
    if (!Number.isSafeInteger(end) || length === 0 || (spans.length && start <= spans.at(-1)!.end)) {
      throw new Error('The signature ByteRange is invalid.');
    }
    spans.push({ start, end });
  }
  if (spans[0].start !== 0) throw new Error('The signature ByteRange must begin at byte zero.');
  return spans;
}

function getMessageDigest(signedData: SignedData) {
  const signerInfo = signedData.signerInfos[0];
  if (!signerInfo) throw new Error('The CMS signature has no signer.');
  if (!signerInfo.signedAttrs) {
    throw new Error('Signatures without signed attributes are not supported by streaming verification.');
  }
  const hasContentType = signerInfo.signedAttrs.attributes.some(
    ({ type }) => type === CONTENT_TYPE_ATTRIBUTE,
  );
  const digestAttribute = signerInfo.signedAttrs.attributes.find(
    ({ type }) => type === MESSAGE_DIGEST_ATTRIBUTE,
  );
  const digestValue = digestAttribute?.values[0];
  if (!hasContentType || !(digestValue instanceof asn1js.OctetString)) {
    throw new Error('The CMS signed attributes are incomplete.');
  }
  return digestValue.valueBlock.valueHexView;
}

async function createVerificationWork(signature: PdfSignatureObject, index: number) {
  const signedData = parseSignedData(signature.contents);
  const signerInfo = signedData.signerInfos[0];
  const certificate = findSignerCertificate(signedData);
  if (!signerInfo || !certificate) throw new Error('The signer certificate is unavailable.');
  certificateInfoCache.set(signature.contents, toCertificateInfo(certificate));
  const createHasher = HASH_FACTORIES[signerInfo.digestAlgorithm.algorithmId];
  if (!createHasher) {
    throw new Error(`Unsupported digest algorithm: ${signerInfo.digestAlgorithm.algorithmId}`);
  }
  const crypto = getCrypto(true);
  const hashAlgorithm = crypto.getAlgorithmByOID(
    signerInfo.digestAlgorithm.algorithmId,
    true,
    'signature digest algorithm',
  ).name;
  return {
    index,
    spans: readByteSpans(signature.byteRange),
    hasher: (await createHasher()).init(),
    expectedDigest: getMessageDigest(signedData),
    signedData,
    certificate,
    hashAlgorithm,
  } satisfies SignatureVerificationWork;
}

async function openResourceStream(resource: ManagedResource, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (resource.openStream) return resource.openStream();
  const response = await fetch(resource.url, { signal });
  if (!response.ok || !response.body) {
    throw new Error(`Unable to stream the PDF (HTTP ${response.status}).`);
  }
  return response.body;
}

function updateHashers(works: SignatureVerificationWork[], chunk: Uint8Array, offset: number) {
  const chunkEnd = offset + chunk.byteLength;
  for (const work of works) {
    for (const span of work.spans) {
      const start = Math.max(offset, span.start);
      const end = Math.min(chunkEnd, span.end);
      if (start < end) work.hasher.update(chunk.subarray(start - offset, end - offset));
    }
  }
}

async function verifySignedAttributes(work: SignatureVerificationWork) {
  const actualDigest = work.hasher.digest('binary');
  if (!equalBytes(actualDigest, work.expectedDigest)) return false;

  const signerInfo = work.signedData.signerInfos[0];
  const signedAttrs = signerInfo.signedAttrs!;
  let signedBytes = new Uint8Array(signedAttrs.encodedValue);
  if (!signedBytes.byteLength) {
    signedBytes = new Uint8Array(signedAttrs.toSchema().toBER());
    signedBytes[0] = 0x31;
  }
  const crypto = getCrypto(true);
  return signerInfo.signatureAlgorithm.algorithmId === RSA_ENCRYPTION
    ? crypto.verifyWithPublicKey(
      signedBytes,
      signerInfo.signature,
      work.certificate.subjectPublicKeyInfo,
      signerInfo.signatureAlgorithm,
      work.hashAlgorithm,
    )
    : crypto.verifyWithPublicKey(
      signedBytes,
      signerInfo.signature,
      work.certificate.subjectPublicKeyInfo,
      signerInfo.signatureAlgorithm,
    );
}

/**
 * Verifies all PDF signatures in one streaming pass. The PDF bytes are never
 * assembled into another full-size buffer, and certificate chains are not checked.
 */
export async function verifyPdfSignatures(
  resource: ManagedResource,
  signatures: PdfSignatureObject[],
  signal?: AbortSignal,
): Promise<SignatureVerificationResult[]> {
  const results: SignatureVerificationResult[] = signatures.map(() => ({
    state: 'pending',
    detail: 'Verification in progress.',
  }));
  const works: SignatureVerificationWork[] = [];

  await Promise.all(signatures.map(async (signature, index) => {
    try {
      works.push(await createVerificationWork(signature, index));
    } catch (error) {
      results[index] = {
        state: 'unsupported',
        detail: error instanceof Error ? error.message : 'This signature cannot be verified.',
      };
    }
  }));
  if (!works.length) return results;

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    reader = (await openResourceStream(resource, signal)).getReader();
    const requiredBytes = Math.max(...works.flatMap(({ spans }) => spans.map(({ end }) => end)));
    let offset = 0;
    while (offset < requiredBytes) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      updateHashers(works, value, offset);
      offset += value.byteLength;
    }
    if (offset < requiredBytes) throw new Error('The PDF ends before its signed ByteRange.');

    await Promise.all(works.map(async (work) => {
      try {
        const verified = await verifySignedAttributes(work);
        results[work.index] = verified
          ? {
            state: 'verified',
            detail: 'Integrity and the embedded-certificate signature are valid. Certificate chain not checked.',
          }
          : { state: 'failed', detail: 'The signed bytes or signature do not match.' };
      } catch (error) {
        results[work.index] = {
          state: 'failed',
          detail: error instanceof Error ? error.message : 'Signature verification failed.',
        };
      }
    }));
  } catch (error) {
    if (signal?.aborted) throw error;
    const detail = error instanceof Error ? error.message : 'Unable to read the PDF for verification.';
    for (const work of works) results[work.index] = { state: 'failed', detail };
  } finally {
    await reader?.cancel().catch(() => {});
  }
  return results;
}
