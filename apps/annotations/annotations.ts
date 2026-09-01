import type { AnnotationConfig, AnnotationPropsPatch } from '@embedpdf/plugin-annotation';

export const TRANSPARENT_ANNOTATION_COLOR = 'transparent';
export const DEFAULT_HIGHLIGHT_COLOR = '#ffcd45';
export const DEFAULT_ANNOTATION_COLOR = '#e44234';
export const DEFAULT_ANNOTATION_COLORS = [
  '#ffcd45', '#e44234', '#f97316', '#22c55e', '#06b6d4',
  '#3b82f6', '#8b5cf6', '#ec4899', '#111827', '#f8fafc',
] as const;

export const ANNOTATION_TOOL_IDS = new Set([
  'square', 'circle', 'line', 'polygon', 'polyline', 'ink', 'ink-highlight',
  'free-text', 'free-text-callout', 'highlight', 'underline', 'strikeout',
  'squiggly', 'insert-text', 'replace-text', 'redact', 'stamp', 'note',
  'attachment', 'link',
]);

export const annotationConfig: AnnotationConfig = {
  chrome: { accent: '#3b82f6' },
  tools: [
    { id: 'highlight', defaults: { color: DEFAULT_HIGHLIGHT_COLOR, blendMode: 'multiply' } },
    { id: 'ink-highlight', defaults: { color: DEFAULT_HIGHLIGHT_COLOR, opacity: 0.45, strokeWidth: 12 } },
    { id: 'ink', defaults: { color: DEFAULT_ANNOTATION_COLOR, strokeWidth: 2 } },
    { id: 'square', defaults: { color: DEFAULT_ANNOTATION_COLOR, interiorColor: TRANSPARENT_ANNOTATION_COLOR } },
    { id: 'circle', defaults: { color: DEFAULT_ANNOTATION_COLOR, interiorColor: TRANSPARENT_ANNOTATION_COLOR } },
    { id: 'line', defaults: { color: DEFAULT_ANNOTATION_COLOR } },
    { id: 'polygon', defaults: { color: DEFAULT_ANNOTATION_COLOR, interiorColor: TRANSPARENT_ANNOTATION_COLOR } },
    { id: 'free-text', defaults: { fontColor: DEFAULT_ANNOTATION_COLOR, interiorColor: TRANSPARENT_ANNOTATION_COLOR } },
    { id: 'note', defaults: { color: DEFAULT_ANNOTATION_COLOR } },
  ],
};

export type AnnotationColorKey = 'color' | 'interiorColor' | 'fontColor';

export function getAnnotationColorFields(toolId: string | null): Array<{
  key: AnnotationColorKey;
  label: string;
}> {
  if (toolId === 'square' || toolId === 'circle' || toolId === 'polygon') {
    return [{ key: 'color', label: 'Stroke' }, { key: 'interiorColor', label: 'Fill' }];
  }
  if (toolId === 'free-text' || toolId === 'free-text-callout') {
    return [{ key: 'fontColor', label: 'Text' }, { key: 'interiorColor', label: 'Background' }];
  }
  return [{ key: 'color', label: 'Color' }];
}

export function asAnnotationPatch(key: AnnotationColorKey, value: string): AnnotationPropsPatch {
  return { [key]: value } as AnnotationPropsPatch;
}

export function isAnnotationTool(toolId: string) {
  return ANNOTATION_TOOL_IDS.has(toolId);
}
