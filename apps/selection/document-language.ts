import type { PdfDocumentObject, PdfEngine } from '@embedpdf/models';
import { platform } from '#platform';
import { normalizePdfText } from '../shared/utils';
import type { PlatformLanguageDetectionResult } from '../platform/types';

const MAX_SAMPLE_PAGES = 5;
const detectionCache = new WeakMap<
  PdfDocumentObject,
  Promise<PlatformLanguageDetectionResult>
>();

function chooseRandomPageIndexes(pageCount: number) {
  const sampleSize = Math.min(MAX_SAMPLE_PAGES, pageCount);
  const indexes = new Set<number>();
  while (indexes.size < sampleSize) indexes.add(Math.floor(Math.random() * pageCount));
  return [...indexes];
}

async function runDocumentLanguageDetection(
  engine: PdfEngine<Blob>,
  document: PdfDocumentObject,
) {
  const pageIndexes = chooseRandomPageIndexes(document.pages.length);
  const pages = await Promise.all(pageIndexes.map(async (pageIndex) => {
    const page = document.pages[pageIndex]!;
    const { runs } = await engine.getPageTextRuns(document, page).toPromise();
    return normalizePdfText(runs.map((run) => run.text).join(' '))
      .replace(/\s+/g, ' ')
      .trim();
  }));
  const sample = pages.filter(Boolean).join('\n');
  if (!sample) throw new Error('No document text was available for language detection.');
  return platform.detectLanguage(sample);
}

export function detectDocumentLanguage(
  engine: PdfEngine<Blob>,
  document: PdfDocumentObject,
) {
  let pending = detectionCache.get(document);
  if (!pending) {
    pending = runDocumentLanguageDetection(engine, document);
    detectionCache.set(document, pending);
  }
  return pending;
}
