import type { PluginRegistry } from '@embedpdf/core';
import {
  PdfAnnotationName,
  PdfAnnotationSubtype,
  PdfBlendMode,
  type PdfAnnotationObject,
  type PdfHighlightAnnoObject,
  type PdfSquigglyAnnoObject,
  type PdfSquareAnnoObject,
  type PdfStrikeOutAnnoObject,
  type PdfUnderlineAnnoObject,
  type Rect,
} from '@embedpdf/models';
import {
  LockModeType,
  type AnnotationCapability,
  type AnnotationPluginConfig,
  type TrackedAnnotation,
} from '@embedpdf/plugin-annotation';
import type { SelectionCapability } from '@embedpdf/plugin-selection';
import { getPluginCapability } from '../shared/utils';
import { viewerThemeStore, type ViewerTheme } from '../theme/theme';

// Appearance and palette configuration

export const TRANSPARENT_ANNOTATION_COLOR = 'transparent';

// Saturated, medium-lightness colors remain visible for translucent highlights
// as well as opaque drawing and text annotations.
export const DEFAULT_HIGHLIGHT_COLOR = '#ffcd45';
export const DEFAULT_ANNOTATION_COLOR = '#e44234';
export const DEFAULT_ANNOTATION_COLORS = [
  DEFAULT_HIGHLIGHT_COLOR,
  '#ff8d00',
  DEFAULT_ANNOTATION_COLOR,
  '#ec4899',
  '#c544ce',
  '#8b5cf6',
  '#597ce2',
  '#0ea5e9',
  '#25d2d1',
  '#14b86e',
  '#84cc16',
];

type ThemeHighlightPolicy = {
  color: string;
  blendMode: PdfBlendMode;
  opacity: number;
};

const THEME_HIGHLIGHT_POLICIES: Record<ViewerTheme, ThemeHighlightPolicy> = {
  light: { color: DEFAULT_HIGHLIGHT_COLOR, blendMode: PdfBlendMode.Multiply, opacity: 1 },
  dark: { color: '#a8a8a8', blendMode: PdfBlendMode.Normal, opacity: 0.2 },
  nord: { color: '#b1d4dc', blendMode: PdfBlendMode.Normal, opacity: 0.2 },
  gruvbox: { color: '#d8c58b', blendMode: PdfBlendMode.Normal, opacity: 0.2 },
  solar: { color: '#78a79f', blendMode: PdfBlendMode.Multiply, opacity: 1 },
  'catppuccin-latte': {
    color: '#df8e1d',
    blendMode: PdfBlendMode.Multiply,
    opacity: 1,
  },
  'catppuccin-mocha': {
    color: '#94e2d5',
    blendMode: PdfBlendMode.Normal,
    opacity: 0.2,
  },
};

export function getThemeHighlightPolicy(theme = viewerThemeStore.getState().theme) {
  return THEME_HIGHLIGHT_POLICIES[theme];
}

export function hasAutoHighlightColor(annotation: PdfHighlightAnnoObject) {
  const color = (annotation.strokeColor ?? annotation.color)?.toLowerCase();
  return color === DEFAULT_HIGHLIGHT_COLOR;
}

export const HIGHLIGHT_STYLES = [
  { label: 'Marker', value: PdfBlendMode.Multiply },
  { label: 'Bright', value: PdfBlendMode.Screen },
  { label: 'Normal', value: PdfBlendMode.Normal },
  { label: 'Soft', value: PdfBlendMode.SoftLight },
] as const;

export const TEXT_MARKUP_TYPES = new Set<PdfAnnotationSubtype>([
  PdfAnnotationSubtype.HIGHLIGHT,
  PdfAnnotationSubtype.UNDERLINE,
  PdfAnnotationSubtype.STRIKEOUT,
  PdfAnnotationSubtype.SQUIGGLY,
]);

export type PdfTextMarkupAnnotation = PdfHighlightAnnoObject | PdfUnderlineAnnoObject |
  PdfStrikeOutAnnoObject | PdfSquigglyAnnoObject;
export type PdfCaptureAnnotation = PdfTextMarkupAnnotation | PdfSquareAnnoObject;
export type TextMarkupSubtype =
  | PdfAnnotationSubtype.HIGHLIGHT
  | PdfAnnotationSubtype.UNDERLINE
  | PdfAnnotationSubtype.STRIKEOUT;

export type AnnotationColorFieldKey =
  | 'strokeColor'
  | 'color'
  | 'fontColor'
  | 'backgroundColor';

interface AnnotationColorField {
  key: AnnotationColorFieldKey;
  label: string;
}

export interface AnnotationToolLike {
  id: string;
  name?: string;
  defaults?: Record<string, unknown>;
}

const COLOR_FIELDS = {
  stroke: { key: 'strokeColor', label: 'Stroke' },
  fill: { key: 'color', label: 'Fill' },
  color: { key: 'strokeColor', label: 'Color' },
  text: { key: 'fontColor', label: 'Text' },
  background: { key: 'color', label: 'Background' },
} as const satisfies Record<string, AnnotationColorField>;

const FALLBACK_COLOR_FIELDS: AnnotationColorField[] = [
  COLOR_FIELDS.stroke,
  COLOR_FIELDS.fill,
  COLOR_FIELDS.text,
  { key: 'backgroundColor', label: 'Background' },
];

const SINGLE_COLOR_TOOL_IDS = new Set([
  'highlight',
  'underline',
  'strikeout',
  'squiggly',
  'ink',
  'inkHighlighter',
  'line',
  'lineArrow',
  'polyline',
  'textComment',
]);

const SHAPE_TOOL_IDS = new Set(['square', 'circle', 'polygon']);
const STROKE_COLOR_ALIAS_TOOL_IDS = new Set([
  'highlight',
  'underline',
  'strikeout',
  'squiggly',
  'ink',
  'inkHighlighter',
]);

const TOOL_LABELS: Record<string, string> = {
  highlight: 'Highlight',
  underline: 'Underline',
  strikeout: 'Strikeout',
  squiggly: 'Squiggly',
  ink: 'Ink',
  inkHighlighter: 'Highlighter',
  square: 'Rectangle',
  circle: 'Circle',
  polygon: 'Polygon',
  line: 'Line',
  lineArrow: 'Arrow',
  polyline: 'Polyline',
  textComment: 'Comment',
  freeText: 'Text',
  freeTextCallout: 'Callout',
};

const ANNOTATION_LABELS = new Map<PdfAnnotationSubtype, string>([
  [PdfAnnotationSubtype.TEXT, 'Comment'],
  [PdfAnnotationSubtype.HIGHLIGHT, 'Highlight'],
  [PdfAnnotationSubtype.UNDERLINE, 'Underline'],
  [PdfAnnotationSubtype.STRIKEOUT, 'Strikeout'],
  [PdfAnnotationSubtype.SQUIGGLY, 'Squiggly'],
  [PdfAnnotationSubtype.FREETEXT, 'Text'],
  [PdfAnnotationSubtype.STAMP, 'Stamp'],
  [PdfAnnotationSubtype.INK, 'Drawing'],
]);

// Registry access

export function getAnnotationCapability(registry: PluginRegistry | undefined) {
  return getPluginCapability<AnnotationCapability>(registry, 'annotation');
}

export function getAnnotationScope(
  registry: PluginRegistry | undefined,
  documentId: string | null | undefined,
) {
  const capability = getAnnotationCapability(registry);
  return capability && documentId
    ? { documentId, capability, scope: capability.forDocument(documentId) }
    : null;
}

// Annotation model helpers

export function isTextMarkupAnnotation(
  annotation: PdfAnnotationObject | undefined,
): annotation is PdfTextMarkupAnnotation {
  return Boolean(annotation && TEXT_MARKUP_TYPES.has(annotation.type));
}

export function isCaptureAnnotation(
  annotation: PdfAnnotationObject | undefined,
): annotation is PdfCaptureAnnotation {
  return isTextMarkupAnnotation(annotation) || annotation?.type === PdfAnnotationSubtype.SQUARE;
}

export function getAnnotationRects(annotation: PdfAnnotationObject): Rect[] {
  return isTextMarkupAnnotation(annotation) && annotation.segmentRects.length
    ? annotation.segmentRects
    : [annotation.rect];
}

export function rectsIntersect(left: Rect, right: Rect) {
  return left.origin.x < right.origin.x + right.size.width &&
    left.origin.x + left.size.width > right.origin.x &&
    left.origin.y < right.origin.y + right.size.height &&
    left.origin.y + left.size.height > right.origin.y;
}

export function getAnnotationLabel(annotation: PdfAnnotationObject) {
  return ANNOTATION_LABELS.get(annotation.type) ?? 'Annotation';
}

export function getAnnotationToolLabel(tool: AnnotationToolLike | null) {
  return tool
    ? TOOL_LABELS[tool.id] ?? tool.name ?? 'Annotation tool'
    : 'Selected annotation';
}

export function getCommonAnnotationTool(
  capability: AnnotationCapability,
  annotations: TrackedAnnotation[],
) {
  const tools = annotations.map(({ object }) => capability.findToolForAnnotation(object));
  return tools[0] && tools.every((tool) => tool?.id === tools[0]?.id)
    ? tools[0]
    : null;
}

export function getAnnotationColorFields(
  toolId: string | null,
  values: Record<string, unknown>,
): AnnotationColorField[] {
  if (toolId && SINGLE_COLOR_TOOL_IDS.has(toolId)) return [COLOR_FIELDS.color];
  if (toolId && SHAPE_TOOL_IDS.has(toolId)) return [COLOR_FIELDS.stroke, COLOR_FIELDS.fill];
  if (toolId === 'freeText' || toolId === 'freeTextCallout') {
    return [COLOR_FIELDS.text, COLOR_FIELDS.background];
  }

  const fields = FALLBACK_COLOR_FIELDS.filter(({ key }) => key in values);
  return fields.length ? fields : [COLOR_FIELDS.color];
}

export function getAnnotationColorPatch(
  toolId: string | null,
  field: AnnotationColorFieldKey,
  color: string,
) {
  const patch: Record<string, unknown> = { [field]: color };
  if (field === 'strokeColor' && toolId && STROKE_COLOR_ALIAS_TOOL_IDS.has(toolId)) {
    patch.color = color;
  }
  if (field === 'color' && (toolId === 'freeText' || toolId === 'freeTextCallout')) {
    patch.backgroundColor = color;
  }
  return patch;
}

export function getAnnotationAutoColor(
  toolId: string | null,
  field: AnnotationColorFieldKey,
) {
  if (field === 'fontColor') return DEFAULT_ANNOTATION_COLOR;
  if (field !== 'strokeColor') return null;
  return toolId === 'highlight' || toolId === 'inkHighlighter' || toolId === 'textComment'
    ? DEFAULT_HIGHLIGHT_COLOR
    : DEFAULT_ANNOTATION_COLOR;
}

export function hasAutoAnnotationStrokeColor(annotation: PdfAnnotationObject) {
  const values = annotation as unknown as Record<string, unknown>;
  const color = normalizeAnnotationColor(values.strokeColor ?? values.color);
  const expected = annotation.type === PdfAnnotationSubtype.HIGHLIGHT
    || annotation.type === PdfAnnotationSubtype.TEXT
    || (annotation.type === PdfAnnotationSubtype.INK && annotation.intent === 'InkHighlight')
    ? DEFAULT_HIGHLIGHT_COLOR
    : DEFAULT_ANNOTATION_COLOR;
  return color === expected;
}

export function hasAutoAnnotationTextColor(annotation: PdfAnnotationObject) {
  return 'fontColor' in annotation
    && normalizeAnnotationColor(annotation.fontColor) === DEFAULT_ANNOTATION_COLOR;
}

export function normalizeAnnotationColor(value: unknown) {
  if (value === TRANSPARENT_ANNOTATION_COLOR) return TRANSPARENT_ANNOTATION_COLOR;
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

export function normalizeAnnotationOpacity(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : null;
}

// Annotation creation

export function createCommentAnnotation(
  scope: ReturnType<AnnotationCapability['forDocument']>,
  target: PdfAnnotationObject,
) {
  const id = crypto.randomUUID();
  const size = 24;
  scope.createAnnotation(target.pageIndex, {
    id,
    type: PdfAnnotationSubtype.TEXT,
    pageIndex: target.pageIndex,
    rect: {
      origin: {
        x: Math.max(0, target.rect.origin.x + target.rect.size.width - size),
        y: Math.max(0, target.rect.origin.y + target.rect.size.height - size),
      },
      size: { width: size, height: size },
    },
    contents: '',
    name: PdfAnnotationName.Comment,
    strokeColor: DEFAULT_HIGHLIGHT_COLOR,
    opacity: 1,
    flags: ['print', 'noRotate', 'noZoom'],
    created: new Date(),
  });
  return id;
}

export function createTextMarkupAnnotations(
  annotationScope: ReturnType<AnnotationCapability['forDocument']>,
  selectionScope: ReturnType<SelectionCapability['forDocument']>,
  type: TextMarkupSubtype,
) {
  const isHighlight = type === PdfAnnotationSubtype.HIGHLIGHT;
  const slices = selectionScope.getState().slices;

  for (const selection of selectionScope.getFormattedSelection()) {
    const slice = slices[selection.pageIndex];
    annotationScope.createAnnotation(selection.pageIndex, {
      id: crypto.randomUUID(),
      type,
      pageIndex: selection.pageIndex,
      rect: selection.rect,
      segmentRects: selection.segmentRects,
      strokeColor: isHighlight ? DEFAULT_HIGHLIGHT_COLOR : DEFAULT_ANNOTATION_COLOR,
      opacity: 1,
      ...(isHighlight ? { blendMode: PdfBlendMode.Multiply } : {}),
      custom: slice ? { pdfTs: { textSlice: {
        charIndex: slice.start,
        charCount: slice.count,
      } } } : undefined,
    });
  }
  selectionScope.clear();
}

// Plugin setup and lifecycle events

export function createAnnotationPluginConfig(): AnnotationPluginConfig {
  return {
    locked: { type: LockModeType.Include, categories: ['form', 'link'] },
    autoOpenLinks: false,
    deactivateToolAfterCreate: true,
    colorPresets: DEFAULT_ANNOTATION_COLORS,
    tools: [
      ...['square', 'lineArrow', 'ink'].map((id) => ({
        id,
        defaults: { strokeWidth: 2 },
      })),
      {
        id: 'highlight',
        defaults: {
          strokeColor: DEFAULT_HIGHLIGHT_COLOR,
          color: DEFAULT_HIGHLIGHT_COLOR,
          blendMode: PdfBlendMode.Multiply,
          opacity: 1,
        },
      },
      {
        id: 'textComment',
        behavior: { editAfterCreate: true },
      },
      // Register the tool so existing stamps resolve their built-in renderer.
      { id: 'stamp' },
      // Link annotations stay interactive for URI and destination navigation.
      { id: 'link', categories: ['link'] },
    ],
  };
}

export function installAnnotationPreview(registry: PluginRegistry, documentId: string) {
  const scoped = getAnnotationScope(registry, documentId);
  if (!scoped) return;

  const root = document.documentElement;
  const sync = () => {
    const active = scoped.scope.getActiveTool();
    const tool = active?.id ? scoped.capability.getTool(active.id) ?? active : null;
    const defaults = tool?.defaults as Record<string, unknown> | undefined;
    const autoColor = getAnnotationAutoColor(tool?.id ?? null, 'strokeColor');
    const strokeColor = normalizeAnnotationColor(defaults?.strokeColor ?? defaults?.color);

    if (autoColor && strokeColor === autoColor) {
      root.dataset.pdfAnnotationAutoPreview = tool?.id ?? '';
    } else {
      delete root.dataset.pdfAnnotationAutoPreview;
    }
  };

  sync();
  const unsubscribeTool = scoped.scope.onActiveToolChange(sync);
  const unsubscribeTools = scoped.capability.onToolsChange(sync);
  return () => {
    unsubscribeTool();
    unsubscribeTools();
    delete root.dataset.pdfAnnotationAutoPreview;
  };
}

export function installAnnotationDirty(
  registry: PluginRegistry,
  onDirty: () => void,
) {
  const capability = getAnnotationCapability(registry);
  if (!capability) return;

  return capability.onAnnotationEvent((event) => {
    // The plugin emits an immediate uncommitted event and a second committed
    // event after PDFium catches up. Mark dirty on the first one.
    if (event.type !== 'loaded' && !event.committed) onDirty();
  });
}

export function installAnnotationLinks(
  registry: PluginRegistry,
  openExternal: (uri: string) => void,
) {
  const capability = getAnnotationCapability(registry);
  if (!capability) return;

  return capability.onNavigate((event) => {
    if (event.result.outcome === 'uri') openExternal(event.result.uri);
  });
}

export function installCommentEditor(
  registry: PluginRegistry,
  onCreate: (annotationId: string) => void,
) {
  const capability = getAnnotationCapability(registry);
  if (!capability) return;

  return capability.onAnnotationEvent((event) => {
    if (
      event.type === 'create' &&
      !event.committed &&
      event.editAfterCreate &&
      event.annotation.type === PdfAnnotationSubtype.TEXT
    ) {
      onCreate(event.annotation.id);
    }
  });
}
