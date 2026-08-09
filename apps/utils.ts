import type { PluginRegistry } from '@embedpdf/core';
import {
  type PdfActionObject,
  type PdfDestinationObject,
  type PdfLinkTarget,
} from '@embedpdf/models';
import { ScrollStrategy } from '@embedpdf/plugin-scroll';

export const EMPTY_CLEANUP = () => {};

export function normalizePdfText(text: string) {
  return text.normalize('NFKC');
}

export function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.matches('input, textarea, select, [contenteditable="true"]') || target.isContentEditable;
}

export function getActiveDocumentId(registry: PluginRegistry) {
  return registry.getStore().getState().core.activeDocumentId;
}

export function getPluginCapability<T>(registry: PluginRegistry | undefined, pluginId: string) {
  return registry?.getPlugin(pluginId)?.provides?.() as T | undefined;
}

export function getDocumentCapability<T>(
  registry: PluginRegistry | undefined,
  pluginId: string,
  documentId = registry ? getActiveDocumentId(registry) : undefined,
) {
  const capability = getPluginCapability<T>(registry, pluginId);
  return documentId && capability ? { documentId, capability } : null;
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

export type { ScrollCapability } from '@embedpdf/plugin-scroll';
