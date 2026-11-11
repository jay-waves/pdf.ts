import type { Kernel } from '@embedpdf/core';
import { annotationKey } from '@embedpdf/core';
import type { Rect } from '@embedpdf/core-geometry';
import { AnnotationToken, type Annotation, type AnnotationCapability, type AnnotationConfig, type AnnotationSubtype, type AnnotationToolInput } from '@embedpdf/plugin-annotation';
import { ActionsToken } from '@embedpdf/plugin-actions';
import { InteractionToken } from '@embedpdf/plugin-interaction';
import { isDarkViewerTheme, viewerThemeStore } from '../theme/theme';
import { getDefaultAnnotationColor, getThemeAnnotationColor } from './theme-palette';

export const TRANSPARENT_ANNOTATION_COLOR = 'transparent';
export const DEFAULT_HIGHLIGHT_COLOR = '#ffcd45';
export const DEFAULT_ANNOTATION_COLOR = '#e44234';
export const VECTOR_ANNOTATION_OPACITY = 0.75;
export const VECTOR_ANNOTATION_STROKE_WIDTH = 1.25;
export const TEXT_MARKUP_TYPES = new Set<AnnotationSubtype>(['highlight', 'underline', 'strikeout', 'squiggly']);
export type TextMarkupSubtype = 'highlight' | 'underline' | 'strikeout';
export type TextMarkupAnnotation = Extract<Annotation, { subtype: 'highlight' | 'underline' | 'strikeout' | 'squiggly' }>;
export type CaptureAnnotation = TextMarkupAnnotation | Extract<Annotation, { subtype: 'square' }>;
export type AnnotationColorFieldKey = 'color' | 'interiorColor' | 'textColor';
export interface AnnotationToolLike { id: string; name?: string; defaults?: Record<string, unknown> }

const VECTOR_TOOL_IDS = new Set(['square', 'circle', 'polygon', 'line', 'lineArrow', 'polyline', 'ink', 'underline', 'strikeout', 'squiggly', 'freeTextCallout']);
const TOOL_LABELS: Record<string, string> = {
  highlight: 'Highlight', underline: 'Underline', strikeout: 'Strikeout', squiggly: 'Squiggly',
  note: 'Comment', 'free-text': 'Text', 'free-text-callout': 'Callout', 'ink-highlight': 'Highlighter',
  ink: 'Ink', inkHighlighter: 'Highlighter', square: 'Rectangle', circle: 'Circle', polygon: 'Polygon',
  line: 'Line', lineArrow: 'Arrow', polyline: 'Polyline', text: 'Comment', textComment: 'Comment',
  freeText: 'Text', freeTextCallout: 'Callout', freetext: 'Text', stamp: 'Stamp',
};

export function getThemeHighlightPolicy(theme = viewerThemeStore.getState().theme) {
  return { color: getDefaultAnnotationColor(theme), blendMode: isDarkViewerTheme(theme) ? 'normal' : 'multiply', opacity: isDarkViewerTheme(theme) ? 0.4 : 1 };
}
export function hasAutoHighlightColor(annotation: Annotation) { return 'color' in annotation && annotation.color?.toLowerCase() === DEFAULT_HIGHLIGHT_COLOR; }
export function getAnnotationCapability(kernel: Kernel | undefined, documentId?: string | null) {
  return kernel?.tryCapability(AnnotationToken, documentId ?? undefined) ?? null;
}
export function getAnnotationScope(kernel: Kernel | undefined, documentId: string | null | undefined) {
  const scope = documentId ? getAnnotationCapability(kernel, documentId) : null;
  return scope && kernel ? { documentId: documentId!, capability: scope, scope, interaction: kernel.tryCapability(InteractionToken, documentId!) } : null;
}
export function isTextMarkupAnnotation(annotation: Annotation | undefined): annotation is TextMarkupAnnotation { return !!annotation && TEXT_MARKUP_TYPES.has(annotation.subtype); }
export function isCaptureAnnotation(annotation: Annotation | undefined): annotation is CaptureAnnotation { return isTextMarkupAnnotation(annotation) || annotation?.subtype === 'square'; }
export function getAnnotationRects(annotation: Annotation): Rect[] {
  if ('quadPoints' in annotation && Array.isArray(annotation.quadPoints) && annotation.quadPoints.length) {
    return annotation.quadPoints.map((quad) => {
      const points = [quad.upperLeft, quad.upperRight, quad.lowerLeft, quad.lowerRight];
      const x = Math.min(...points.map((p) => p.x)), y = Math.min(...points.map((p) => p.y));
      return { x, y, width: Math.max(...points.map((p) => p.x)) - x, height: Math.max(...points.map((p) => p.y)) - y };
    });
  }
  return [annotation.rect];
}
export function getAnnotationLabel(annotation: Annotation) { return TOOL_LABELS[annotation.subtype] ?? 'Annotation'; }
export function getAnnotationToolLabel(tool: AnnotationToolLike | null) { return tool ? TOOL_LABELS[tool.id] ?? tool.name ?? 'Annotation tool' : 'Selected annotation'; }
export function getCommonAnnotationTool(capability: AnnotationCapability, annotations: readonly Annotation[]) {
  const subtype = annotations[0]?.subtype;
  return subtype && annotations.every((annotation) => annotation.subtype === subtype)
    ? capability.tools.list().find((tool) => tool.subtype === subtype) ?? null : null;
}
function getAnnotationColorPatch(field: AnnotationColorFieldKey, color: string) { return field === 'textColor' ? { richText: { body: { color: color === TRANSPARENT_ANNOTATION_COLOR ? '#000000' : color } } } : { [field]: color === TRANSPARENT_ANNOTATION_COLOR ? null : color }; }
export function getAnnotationPresetPatch(toolId: string | null, field: AnnotationColorFieldKey, color: string) {
  return { ...getAnnotationColorPatch(field, getThemeAnnotationColor(color, 'light') ?? color),
    opacity: toolId && VECTOR_TOOL_IDS.has(toolId) ? VECTOR_ANNOTATION_OPACITY : 1,
    ...(toolId === 'highlight' || toolId === 'inkHighlighter' ? { blendMode: 'multiply' as const } : {}) };
}
export function normalizeAnnotationColor(value: unknown) {
  if (value === TRANSPARENT_ANNOTATION_COLOR || value === null) return TRANSPARENT_ANNOTATION_COLOR;
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
}
export async function createCommentAnnotation(scope: AnnotationCapability, target: Pick<Annotation, 'page' | 'rect'>, rect?: Rect) {
  const { annotation } = await scope.create(target.page, { subtype: 'text', rect: rect ?? { x: Math.max(0, target.rect.x + target.rect.width - 24), y: Math.max(0, target.rect.y + target.rect.height + 4), width: 24, height: 24 }, contents: '', icon: 'comment', color: getDefaultAnnotationColor('light'), opacity: 1, print: true, noRotate: true, noZoom: true });
  return annotationKey(annotation.ref);
}
export async function createTextMarkupAnnotations(scope: AnnotationCapability, type: TextMarkupSubtype) { return (await scope.createFromSelection(type)).annotations; }
export function createAnnotationPluginConfig(): AnnotationConfig {
  return { afterCreate: { select: true, tool: 'default', editText: true },
    editable: ['text', 'highlight', 'underline', 'strikeout', 'squiggly', 'free-text', 'square', 'circle', 'polygon', 'polyline', 'line', 'ink', 'stamp'],
    tools: [...(['square', 'circle', 'polygon', 'line', 'polyline', 'ink', 'underline', 'strikeout', 'squiggly'] as const).map((id) => ({ id, defaults: { ...(['underline', 'strikeout', 'squiggly'].includes(id) ? {} : { strokeWidth: VECTOR_ANNOTATION_STROKE_WIDTH }), opacity: VECTOR_ANNOTATION_OPACITY } } as AnnotationToolInput)),
      { id: 'highlight', defaults: { color: DEFAULT_HIGHLIGHT_COLOR, blendMode: 'multiply', opacity: 1 } },
      { id: 'textComment', extends: 'note' }, { id: 'freeText', extends: 'free-text' },
      { id: 'freeTextCallout', extends: 'free-text-callout' }, { id: 'inkHighlighter', extends: 'ink-highlight' },
      { id: 'lineArrow', extends: 'line', defaults: { lineEndings: { start: 'none', end: 'open-arrow' } } }],
  };
}
export function initializeAnnotationPalette(kernel: Kernel, documentId: string) {
  const capability = getAnnotationCapability(kernel, documentId);
  if (!capability) return;
  for (const tool of capability.tools.list()) {
    const defaults = capability.tools.getDefaults(tool.id) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const field of ['color', 'interiorColor', 'textColor']) {
      const current = normalizeAnnotationColor(defaults[field]);
      if (!current || current === TRANSPARENT_ANNOTATION_COLOR) continue;
      const color = current === DEFAULT_HIGHLIGHT_COLOR || current === DEFAULT_ANNOTATION_COLOR ? getDefaultAnnotationColor('light') : getThemeAnnotationColor(current, 'light');
      if (color && color !== current) patch[field] = color;
    }
    if (Object.keys(patch).length) capability.tools.updateDefaults(tool.id, patch);
  }
}
export function installAnnotationDirty(kernel: Kernel, onDirty: () => void) {
  return kernel.documents.onUnsavedChangesChanged((event) => { if (event.hasUnsavedChanges) onDirty(); });
}
export function installAnnotationLinks(kernel: Kernel, openExternal: (uri: string) => void) {
  const cleanups = new Map<string, () => void>();
  const attach = (id: string) => {
    cleanups.get(id)?.();
    const actions = kernel.tryCapability(ActionsToken, id);
    if (actions) cleanups.set(id, actions.setUiAdapter({ openUri: openExternal, print: () => { void kernel.documents.print(id, { includeAnnotations: true }).catch(error => console.error('[pdf-ts] PDF action print failed', error)); } }));
  };
  kernel.documents.list().forEach((info) => attach(info.id));
  const unsubscribe = kernel.documents.onOpened(({ documentId }) => attach(documentId));
  return () => { unsubscribe(); cleanups.forEach((cleanup) => cleanup()); };
}
export function installCommentEditor(kernel: Kernel, onCreate: (id: string) => void) {
  const cleanups = new Map<string, () => void>();
  const attach = (id: string) => {
    cleanups.get(id)?.();
    const scope = getAnnotationCapability(kernel, id);
    if (scope) cleanups.set(id, scope.onCreated(({ annotation }) => { if (annotation.subtype === 'text' && !annotation.reply) onCreate(annotationKey(annotation.ref)); }));
  };
  kernel.documents.list().forEach((info) => attach(info.id));
  const unsubscribe = kernel.documents.onOpened(({ documentId }) => attach(documentId));
  return () => { unsubscribe(); cleanups.forEach((cleanup) => cleanup()); };
}
