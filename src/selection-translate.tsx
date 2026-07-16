import { useEffect, useState } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import type { SelectionCapability } from '@embedpdf/plugin-selection';
import { FloatingPopover } from './components';

const TRANSLATION_TARGET_LANGUAGE = 'zh';
const FALLBACK_SOURCE_LANGUAGE = 'en';
const MAX_TEXT_LENGTH = 4000;
const translatorCache = new Map<string, Promise<ChromeTranslator>>();
let languageDetectorPromise: Promise<ChromeLanguageDetector> | null = null;

interface ChromeTranslator {
  translate(text: string): Promise<string>;
}

interface ChromeTranslatorConstructor {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(options: { sourceLanguage: string; targetLanguage: string }): Promise<ChromeTranslator>;
}

interface ChromeLanguageDetector {
  detect(text: string): Promise<Array<{ detectedLanguage: string; confidence: number }>>;
}

interface ChromeLanguageDetectorConstructor {
  availability(): Promise<string>;
  create(): Promise<ChromeLanguageDetector>;
}

interface TranslationResult {
  text: string;
  status: 'success' | 'error';
}

export interface SelectionTranslationRequest {
  id: number;
  documentId: string;
  anchor: { x: number; y: number };
}

function normalizeText(parts: string[]) {
  return parts
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

async function detectSourceLanguage(text: string) {
  const LanguageDetector = (
    globalThis as typeof globalThis & { LanguageDetector?: ChromeLanguageDetectorConstructor }
  ).LanguageDetector;
  if (!LanguageDetector) return FALLBACK_SOURCE_LANGUAGE;

  try {
    if (!languageDetectorPromise) {
      languageDetectorPromise = (async () => {
        const availability = await LanguageDetector.availability();
        if (availability === 'unavailable') throw new Error('Language detector is unavailable.');
        return LanguageDetector.create();
      })();
      languageDetectorPromise.catch(() => {
        languageDetectorPromise = null;
      });
    }

    const detector = await languageDetectorPromise;
    const [bestMatch] = await detector.detect(text);
    return bestMatch?.detectedLanguage || FALLBACK_SOURCE_LANGUAGE;
  } catch {
    return FALLBACK_SOURCE_LANGUAGE;
  }
}

async function getTranslator(sourceLanguage: string, targetLanguage: string) {
  const cacheKey = `${sourceLanguage}:${targetLanguage}`;
  let translatorPromise = translatorCache.get(cacheKey);
  if (!translatorPromise) {
    const Translator = (
      globalThis as typeof globalThis & { Translator?: ChromeTranslatorConstructor }
    ).Translator;
    if (!Translator) throw new Error('Chrome Translator API is not available in this browser.');

    translatorPromise = (async () => {
      const availability = await Translator.availability({ sourceLanguage, targetLanguage });
      if (availability === 'unavailable') {
        throw new Error(`Translation is not available from ${sourceLanguage} to ${targetLanguage}.`);
      }
      return Translator.create({ sourceLanguage, targetLanguage });
    })();
    translatorCache.set(cacheKey, translatorPromise);
    translatorPromise.catch(() => translatorCache.delete(cacheKey));
  }

  return translatorPromise;
}

async function translateSelectedText(text: string) {
  const sourceLanguage = await detectSourceLanguage(text);
  const targetLanguage = sourceLanguage.toLowerCase().startsWith('zh') ? 'en' : TRANSLATION_TARGET_LANGUAGE;
  const translator = await getTranslator(sourceLanguage, targetLanguage);
  return translator.translate(text);
}

export function SelectionTranslate({
  registry,
  request,
  onClose,
}: {
  registry?: PluginRegistry;
  request: SelectionTranslationRequest;
  onClose(): void;
}) {
  const [result, setResult] = useState<TranslationResult | null>(null);

  useEffect(() => {
    const selection = registry?.getPlugin('selection')?.provides?.() as SelectionCapability | undefined;
    if (!selection) return;

    let cancelled = false;
    selection.forDocument(request.documentId).getSelectedText().toPromise()
      .then((parts) => translateSelectedText(normalizeText(parts)))
      .then((text) => {
        if (!cancelled) setResult({ text, status: 'success' });
      })
      .catch((error) => {
        if (cancelled) return;
        setResult({
          text: error instanceof Error ? error.message : 'Translation failed.',
          status: 'error',
        });
      });

    const close = () => onClose();
    window.addEventListener('scroll', close, { capture: true, passive: true });
    const unsubscribeSelectionChange = selection.onSelectionChange((event) => {
      if (!event.selection) close();
    });

    return () => {
      cancelled = true;
      window.removeEventListener('scroll', close, { capture: true });
      unsubscribeSelectionChange();
    };
  }, [registry, request]);

  return (
    <FloatingPopover
      onClose={onClose}
      anchor={request.anchor}
      sideOffset={10}
      className={`shnctl-translate-panel${result?.status === 'error' ? ' is-error' : ''}`}
      label="Translation"
      role="status"
    >
      {result?.text ?? 'Translating...'}
    </FloatingPopover>
  );
}
