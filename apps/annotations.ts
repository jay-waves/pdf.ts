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
import { EMPTY_CLEANUP, getDocumentCapability, getPluginCapability } from './utils';

// Appearance and palette configuration

export const TRANSPARENT_ANNOTATION_COLOR = 'transparent';

// Saturated, medium-lightness colors remain visible for translucent highlights
// as well as opaque drawing and text annotations.
export const DEFAULT_ANNOTATION_COLORS = [
  '#ffcd45',
  '#ff8d00',
  '#e44234',
  '#ec4899',
  '#c544ce',
  '#8b5cf6',
  '#597ce2',
  '#0ea5e9',
  '#25d2d1',
  '#14b86e',
  '#84cc16',
];

export const DEFAULT_HIGHLIGHT_COLOR = DEFAULT_ANNOTATION_COLORS[0];

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

export interface AnnotationColorField {
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
  documentId?: string | null,
) {
  if (!registry || documentId === null) return null;
  const scoped = getDocumentCapability<AnnotationCapability>(
    registry,
    'annotation',
    documentId,
  );
  return scoped
    ? { ...scoped, scope: scoped.capability.forDocument(scoped.documentId) }
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

export function getAnnotationFocusPosition(annotation: PdfAnnotationObject) {
  const rects = getAnnotationRects(annotation);
  const anchor = rects.reduce((topmost, rect) => (
    rect.origin.y < topmost.origin.y ||
    (rect.origin.y === topmost.origin.y && rect.origin.x < topmost.origin.x)
      ? rect
      : topmost
  ));
  return {
    x: anchor.origin.x + anchor.size.width / 2,
    y: anchor.origin.y + anchor.size.height / 2,
  };
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
  const strokeColor = type === PdfAnnotationSubtype.HIGHLIGHT
    ? DEFAULT_HIGHLIGHT_COLOR
    : DEFAULT_ANNOTATION_COLORS[2];
  const slices = selectionScope.getState().slices;

  for (const selection of selectionScope.getFormattedSelection()) {
    const slice = slices[selection.pageIndex];
    annotationScope.createAnnotation(selection.pageIndex, {
      id: crypto.randomUUID(),
      type,
      pageIndex: selection.pageIndex,
      rect: selection.rect,
      segmentRects: selection.segmentRects,
      strokeColor,
      opacity: 1,
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
      ...['square', 'lineArrow', 'ink'].map((id) => ({ id, defaults: { strokeWidth: 2 } })),
      {
        id: 'highlight',
        defaults: {
          strokeColor: DEFAULT_HIGHLIGHT_COLOR,
          color: DEFAULT_HIGHLIGHT_COLOR,
        },
      },
      { id: 'textComment', behavior: { editAfterCreate: true } },
      // Keep existing stamp annotations backed by PDFium's appearance-stream
      // renderer. Without an enabled stamp tool they have no matching runtime
      // behavior and some stamped PDFs are loaded without a visible seal.
      { id: 'stamp', behavior: { useAppearanceStream: false } },
      // Link annotations stay interactive for URI and destination navigation.
      { id: 'link', categories: ['link'] },
    ],
  };
}

export function installAnnotationDirtyTracker(
  registry: PluginRegistry,
  onDirty: () => void,
) {
  const capability = getAnnotationCapability(registry);
  if (!capability) return EMPTY_CLEANUP;

  return capability.onAnnotationEvent((event) => {
    // The plugin emits an immediate uncommitted event and a second committed
    // event after PDFium catches up. Mark dirty on the first one.
    if (event.type !== 'loaded' && !event.committed) onDirty();
  });
}

export function installAnnotationUriNavigation(
  registry: PluginRegistry,
  openExternal: (uri: string) => void,
) {
  const capability = getAnnotationCapability(registry);
  if (!capability) return EMPTY_CLEANUP;

  return capability.onNavigate((event) => {
    if (event.result.outcome === 'uri') openExternal(event.result.uri);
  });
}

export function installNewCommentEditor(
  registry: PluginRegistry,
  onCreate: (annotationId: string) => void,
) {
  const capability = getAnnotationCapability(registry);
  if (!capability) return EMPTY_CLEANUP;

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
