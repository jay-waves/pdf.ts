import type { PluginRegistry } from '@embedpdf/core';
import type { PDFViewerRef } from '@embedpdf/react-pdf-viewer';

const EMPTY_CLEANUP = () => {};
const TRANSLATE_SELECTION_COMMAND_ID = 'shnctl.selection.translate';
const TRANSLATE_SELECTION_ITEM_ID = 'shnctl-selection-translate-button';
const TRANSLATE_SELECTION_ICON_ID = 'shnctl-translate';
const TRANSLATION_TARGET_LANGUAGE = 'zh';
const FALLBACK_SOURCE_LANGUAGE = 'en';
const MAX_TEXT_LENGTH = 4000;

interface PdfTask<T> {
  toPromise(): Promise<T>;
}

interface SelectionScope {
  getSelectedText(): PdfTask<string[]>;
}

interface SelectionCapability {
  forDocument(documentId: string): SelectionScope;
  onSelectionChange(listener: (event: { documentId: string; selection: unknown | null }) => void): () => void;
}

interface Command {
  id: string;
  label?: string;
  icon?: string;
  action(context: { documentId: string }): void;
}

interface CommandsCapability {
  registerCommand(command: Command): void;
  unregisterCommand(commandId: string): void;
}

interface SelectionMenuCommandItem {
  type: 'command-button';
  id: string;
  commandId: string;
  variant?: 'icon' | 'text' | 'icon-text';
}

interface SelectionMenuSchema {
  id: string;
  items: Array<SelectionMenuCommandItem | { type: string; id: string; items?: SelectionMenuSchema['items'] }>;
}

interface UISchema {
  selectionMenus?: Record<string, SelectionMenuSchema>;
}

interface UICapability {
  getSchema(): UISchema;
  mergeSchema(schema: Partial<UISchema>): void;
}

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

function getTranslatorApi() {
  return (globalThis as typeof globalThis & { Translator?: ChromeTranslatorConstructor }).Translator;
}

function getLanguageDetectorApi() {
  return (globalThis as typeof globalThis & { LanguageDetector?: ChromeLanguageDetectorConstructor }).LanguageDetector;
}

function normalizeText(parts: string[]) {
  return parts
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

function getTargetLanguage(sourceLanguage: string) {
  return sourceLanguage.toLowerCase().startsWith('zh') ? 'en' : TRANSLATION_TARGET_LANGUAGE;
}

async function detectSourceLanguage(text: string) {
  const LanguageDetector = getLanguageDetectorApi();
  if (!LanguageDetector) {
    return FALLBACK_SOURCE_LANGUAGE;
  }

  try {
    const availability = await LanguageDetector.availability();
    if (availability === 'unavailable') {
      return FALLBACK_SOURCE_LANGUAGE;
    }

    const detector = await LanguageDetector.create();
    try {
      const [bestMatch] = await detector.detect(text);
      return bestMatch?.detectedLanguage || FALLBACK_SOURCE_LANGUAGE;
    } finally {
      detector.destroy?.();
    }
  } catch {
    return FALLBACK_SOURCE_LANGUAGE;
  }
}

async function translateSelectedText(text: string) {
  const Translator = getTranslatorApi();
  if (!Translator) {
    throw new Error('Chrome Translator API is not available in this browser.');
  }

  const sourceLanguage = await detectSourceLanguage(text);
  const targetLanguage = getTargetLanguage(sourceLanguage);
  const availability = await Translator.availability({ sourceLanguage, targetLanguage });

  if (availability === 'unavailable') {
    throw new Error(`Translation is not available for ${sourceLanguage} to ${targetLanguage}.`);
  }

  const translator = await Translator.create({ sourceLanguage, targetLanguage });
  try {
    return await translator.translate(text);
  } finally {
    translator.destroy?.();
  }
}

function registerTranslateIcon(container: PDFViewerRef['container']) {
  container?.registerIcons({
    [TRANSLATE_SELECTION_ICON_ID]: {
      viewBox: '0 0 24 24',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      strokeWidth: 2,
      paths: [
        { d: 'm5 8 6 6', stroke: 'primary', fill: 'none' },
        { d: 'm4 14 6-6 2-3', stroke: 'primary', fill: 'none' },
        { d: 'M2 5h12', stroke: 'primary', fill: 'none' },
        { d: 'M7 2h1', stroke: 'primary', fill: 'none' },
        { d: 'm22 22-5-10-5 10', stroke: 'primary', fill: 'none' },
        { d: 'M14 18h6', stroke: 'primary', fill: 'none' },
      ],
    },
  });
}

function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .shnctl-translate-panel {
      position: fixed;
      z-index: 2147483647;
      max-width: min(380px, calc(100vw - 24px));
      max-height: min(320px, calc(100vh - 24px));
      overflow: auto;
      padding: 10px 12px;
      border: 1px solid rgba(17, 24, 39, 0.14);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.98);
      box-shadow: 0 12px 34px rgba(15, 23, 42, 0.18);
      color: #111827;
      font: 13px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      pointer-events: auto;
      user-select: text;
      -webkit-user-select: text;
    }

    .shnctl-translate-panel.is-error {
      color: #991b1b;
    }
  `;
  document.head.append(style);
  return () => style.remove();
}

function selectionMenuWithTranslate(menu: SelectionMenuSchema): SelectionMenuSchema {
  const hasTranslate = (items: SelectionMenuSchema['items']): boolean =>
    items.some((item) => {
      if (item.id === TRANSLATE_SELECTION_ITEM_ID) {
        return true;
      }

      return 'items' in item && Array.isArray(item.items) ? hasTranslate(item.items) : false;
    });

  if (hasTranslate(menu.items)) {
    return menu;
  }

  return {
    ...menu,
    items: [
      ...menu.items,
      {
        type: 'command-button',
        id: TRANSLATE_SELECTION_ITEM_ID,
        commandId: TRANSLATE_SELECTION_COMMAND_ID,
        variant: 'icon',
      },
    ],
  };
}

function installSelectionMenuItem(ui: UICapability) {
  const currentMenus = ui.getSchema().selectionMenus ?? {};
  const nextMenus = Object.fromEntries(
    Object.entries(currentMenus).map(([id, menu]) => [id, selectionMenuWithTranslate(menu)]),
  );

  ui.mergeSchema({
    selectionMenus: nextMenus,
  });
}

function clampPanelPosition(x: number, y: number, panel: HTMLElement) {
  const width = Math.max(panel.offsetWidth, 160);
  const height = Math.max(panel.offsetHeight, 48);
  return {
    x: Math.min(Math.max(12, x), window.innerWidth - width - 12),
    y: Math.min(Math.max(12, y), window.innerHeight - height - 12),
  };
}

function showPanel(panel: HTMLElement, anchorPoint: { x: number; y: number }, text: string, isError = false) {
  const gap = 10;
  panel.classList.toggle('is-error', isError);
  panel.textContent = text;
  panel.hidden = false;

  const position = clampPanelPosition(anchorPoint.x + gap, anchorPoint.y + gap, panel);
  panel.style.left = `${position.x}px`;
  panel.style.top = `${position.y}px`;
}

export function installSelectionTranslate(registry: PluginRegistry, container: PDFViewerRef['container']) {
  const selection = registry.getPlugin('selection')?.provides?.() as SelectionCapability | undefined;
  const commands = registry.getPlugin('commands')?.provides?.() as CommandsCapability | undefined;
  const ui = registry.getPlugin('ui')?.provides?.() as UICapability | undefined;

  if (!selection || !commands || !ui) {
    return EMPTY_CLEANUP;
  }

  registerTranslateIcon(container);
  installSelectionMenuItem(ui);

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
  const rememberPointerPosition = (event: PointerEvent) => {
    lastPointerPosition = { x: event.clientX, y: event.clientY };
  };
  window.addEventListener('pointerdown', rememberPointerPosition, { capture: true, passive: true });

  commands.registerCommand({
    id: TRANSLATE_SELECTION_COMMAND_ID,
    label: 'Translate',
    icon: TRANSLATE_SELECTION_ICON_ID,
    action: ({ documentId }) => {
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
    },
  });

  const unsubscribeSelectionChange = selection.onSelectionChange((event) => {
    if (!event.selection) {
      hidePanel();
    }
  });

  window.addEventListener('scroll', hidePanel, { capture: true, passive: true });

  return () => {
    commands.unregisterCommand(TRANSLATE_SELECTION_COMMAND_ID);
    unsubscribeSelectionChange();
    window.removeEventListener('pointerdown', rememberPointerPosition, { capture: true });
    window.removeEventListener('scroll', hidePanel, { capture: true });
    cleanupStyles();
    panel.remove();
  };
}
