import type { PluginRegistry } from '@embedpdf/core';
import type { SelectionCapability } from '@embedpdf/plugin-selection';
import { EMPTY_CLEANUP } from './utils';

const TRANSLATE_SELECTION_EVENT = 'shnctl:translate-selection';
const TRANSLATION_TARGET_LANGUAGE = 'zh';
const FALLBACK_SOURCE_LANGUAGE = 'en';
const MAX_TEXT_LENGTH = 4000;
const translatorCache = new Map<string, Promise<ChromeTranslator>>();
let languageDetectorPromise: Promise<ChromeLanguageDetector> | null = null;

interface ChromeTranslator {
  translate(text: string): Promise<string>;
  destroy?: () => void;
}

interface ChromeTranslatorConstructor {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(options: { sourceLanguage: string; targetLanguage: string }): Promise<ChromeTranslator>;
}

interface ChromeLanguageDetector {
  detect(text: string): Promise<Array<{ detectedLanguage: string; confidence: number }>>;
  destroy?: () => void;
}

interface ChromeLanguageDetectorConstructor {
  availability(): Promise<string>;
  create(): Promise<ChromeLanguageDetector>;
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
  if (!LanguageDetector) {
    return FALLBACK_SOURCE_LANGUAGE;
  }

  try {
    if (!languageDetectorPromise) {
      languageDetectorPromise = (async () => {
        const availability = await LanguageDetector.availability();
        if (availability === 'unavailable') {
          throw new Error('Language detector is unavailable.');
        }

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
    if (!Translator) {
      throw new Error('Chrome Translator API is not available in this browser.');
    }

    translatorPromise = (async () => {
      const availability = await Translator.availability({ sourceLanguage, targetLanguage });
      if (availability === 'unavailable') {
        throw new Error(`Translation is not available for ${sourceLanguage} to ${targetLanguage}.`);
      }

      return Translator.create({ sourceLanguage, targetLanguage });
    })();
    translatorCache.set(cacheKey, translatorPromise);
    translatorPromise.catch(() => {
      translatorCache.delete(cacheKey);
    });
  }

  return translatorPromise;
}

async function translateSelectedText(text: string) {
  const sourceLanguage = await detectSourceLanguage(text);
  const targetLanguage = sourceLanguage.toLowerCase().startsWith('zh') ? 'en' : TRANSLATION_TARGET_LANGUAGE;
  const translator = await getTranslator(sourceLanguage, targetLanguage);
  return translator.translate(text);
}

function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .shnctl-translate-panel {
      --shnctl-translate-scale: 0.8;
      position: fixed;
      z-index: 2147483647;
      max-width: min(380px, calc(100vw - 24px));
      max-height: min(320px, calc(100vh - 24px));
      overflow: auto;
      padding: 10px 12px;
      border: 1px solid color-mix(in srgb, var(--shnctl-border-default, #dbe3ef) 82%, transparent);
      border-radius: 8px;
      background: color-mix(in srgb, var(--shnctl-background-elevated, #ffffff) 96%, transparent);
      box-shadow: 0 12px 34px color-mix(in srgb, var(--shnctl-background-app, #0f172a) 24%, transparent);
      color: var(--shnctl-foreground-primary, #111827);
      font: 13px/1.45 var(--shnctl-ui-font-family, "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      pointer-events: auto;
      user-select: text;
      -webkit-user-select: text;
      transform: scale(var(--shnctl-translate-scale));
      transform-origin: top left;
      backdrop-filter: blur(18px) saturate(150%);
      -webkit-backdrop-filter: blur(18px) saturate(150%);
    }

    .shnctl-translate-panel.is-error {
      color: color-mix(in srgb, #dc2626 82%, var(--shnctl-foreground-primary, #111827));
    }
  `;
  document.head.append(style);
  return () => style.remove();
}

function showPanel(panel: HTMLElement, anchorPoint: { x: number; y: number }, text: string, isError = false) {
  const gap = 10;
  panel.classList.toggle('is-error', isError);
  panel.textContent = text;
  panel.hidden = false;
  const width = Math.max(panel.offsetWidth, 160);
  const height = Math.max(panel.offsetHeight, 48);

  panel.style.left = `${Math.min(Math.max(12, anchorPoint.x + gap), window.innerWidth - width - 12)}px`;
  panel.style.top = `${Math.min(Math.max(12, anchorPoint.y + gap), window.innerHeight - height - 12)}px`;
}

export function requestSelectionTranslation(documentId: string) {
  window.dispatchEvent(new CustomEvent(TRANSLATE_SELECTION_EVENT, { detail: { documentId } }));
}

export function installSelectionTranslate(registry: PluginRegistry) {
  const selection = registry.getPlugin('selection')?.provides?.() as SelectionCapability | undefined;

  if (!selection) {
    return EMPTY_CLEANUP;
  }

  const panel = document.createElement('div');
  panel.className = 'shnctl-translate-panel';
  panel.hidden = true;
  document.body.append(panel);

  const cleanupStyles = injectStyles();
  let lastPointerPosition = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

  const hidePanel = () => {
    panel.hidden = true;
    panel.textContent = '';
    panel.classList.remove('is-error');
  };
  const handlePointerDown = (event: PointerEvent) => {
    lastPointerPosition = { x: event.clientX, y: event.clientY };
    if (!panel.hidden && !event.composedPath().includes(panel)) {
      hidePanel();
    }
  };
  window.addEventListener('pointerdown', handlePointerDown, { capture: true, passive: true });

  const handleTranslateRequest = (event: Event) => {
    const documentId = (event as CustomEvent<{ documentId?: string }>).detail?.documentId;
    if (!documentId) return;
    const selectionScope = selection.forDocument(documentId);

    showPanel(panel, lastPointerPosition, 'Translating...');
    selectionScope
      .getSelectedText()
      .toPromise()
      .then((parts) => translateSelectedText(normalizeText(parts)))
      .then((translated) => {
        showPanel(panel, lastPointerPosition, translated);
      })
      .catch((error) => {
        showPanel(panel, lastPointerPosition, error instanceof Error ? error.message : 'Translation failed.', true);
      });
  };
  window.addEventListener(TRANSLATE_SELECTION_EVENT, handleTranslateRequest);

  const unsubscribeSelectionChange = selection.onSelectionChange((event) => {
    if (!event.selection) {
      hidePanel();
    }
  });

  window.addEventListener('scroll', hidePanel, { capture: true, passive: true });

  return () => {
    window.removeEventListener(TRANSLATE_SELECTION_EVENT, handleTranslateRequest);
    unsubscribeSelectionChange();
    window.removeEventListener('pointerdown', handlePointerDown, { capture: true });
    window.removeEventListener('scroll', hidePanel, { capture: true });
    cleanupStyles();
    panel.remove();
  };
}
