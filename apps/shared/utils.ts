import type { PluginRegistry } from '@embedpdf/core';
import {
  type PdfActionObject,
  type PdfDestinationObject,
  type PdfLinkTarget,
} from '@embedpdf/models';
import { ScrollStrategy } from '@embedpdf/plugin-scroll';

export function normalizePdfText(text: string) {
  return text.normalize('NFKC');
}

export function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (
    error
    && typeof error === 'object'
    && 'message' in error
    && typeof error.message === 'string'
  ) {
    return error.message;
  }
  return fallback;
}

export function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.matches('input, textarea, select, [contenteditable="true"]') || target.isContentEditable;
}

export function isViewerNavigationTarget(target: EventTarget | null) {
  if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return false;
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select, button, a[href], [contenteditable], [role="button"], [role="link"], [role="menu"], [role="menuitem"], [role="listbox"], [role="option"], [role="slider"], [role="spinbutton"], [role="checkbox"], [role="switch"], [role="radio"], [role="tab"]')) return false;
  return target === document.body || target === document.documentElement || Boolean(target.closest('.viewer'));
}

export function getPluginCapability<T>(registry: PluginRegistry | undefined, pluginId: string) {
  return registry?.getPlugin(pluginId)?.provides?.() as T | undefined;
}

export function getDocumentScope<T extends { forDocument(documentId: string): unknown }>(
  registry: PluginRegistry | undefined,
  pluginId: string,
  documentId: string | null | undefined,
) {
  const capability = getPluginCapability<T>(registry, pluginId);
  return documentId && capability
    ? capability.forDocument(documentId) as ReturnType<T['forDocument']>
    : null;
}

export function getDocumentScrollStrategy(registry: PluginRegistry, documentId: string) {
  const state = registry.getStore().getState() as {
    plugins?: { scroll?: { documents?: Record<string, { strategy?: ScrollStrategy }> } };
  };
  const strategy = state.plugins?.scroll?.documents?.[documentId]?.strategy;
  return strategy === ScrollStrategy.Horizontal ? strategy : ScrollStrategy.Vertical;
}

export function getDestinationFromTarget(target?: PdfLinkTarget): PdfDestinationObject | undefined {
  if (!target) {
    return undefined;
  }

  if (target.type === 'destination') {
    return target.destination;
  }

  if (target.type === 'action') {
    const action = target.action as PdfActionObject;
    return 'destination' in action ? action.destination : undefined;
  }

  return undefined;
}
