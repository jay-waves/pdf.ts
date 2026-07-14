import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { PluginRegistry } from '@embedpdf/core';
import { Check } from 'lucide-react';
import { getActiveDocumentId } from './utils';

const FALLBACK_COLORS = [
  '#facc15',
  '#fb923c',
  '#f87171',
  '#f472b6',
  '#a78bfa',
  '#60a5fa',
  '#22d3ee',
  '#34d399',
  '#4ade80',
  '#94a3b8',
  '#111827',
  '#ffffff',
];

const COLOR_FIELDS = [
  { key: 'strokeColor', label: 'Stroke' },
  { key: 'color', label: 'Fill' },
  { key: 'fontColor', label: 'Text' },
  { key: 'backgroundColor', label: 'Background' },
] as const;

const MARKUP_TOOL_IDS = new Set(['highlight', 'underline', 'strikeout', 'squiggly']);
const STROKE_AND_FILL_TOOL_IDS = new Set(['ink', 'inkHighlighter', 'square', 'circle', 'line', 'polyline']);

type ColorFieldKey = (typeof COLOR_FIELDS)[number]['key'];

interface AnnotationToolLike {
  id: string;
  name?: string;
  defaults?: Record<string, unknown>;
}

interface TrackedAnnotationLike {
  object: {
    id: string;
    pageIndex: number;
    type?: string;
    strokeColor?: string;
    color?: string;
    fontColor?: string;
    backgroundColor?: string;
    opacity?: number;
  };
}

interface AnnotationScopeLike {
  getActiveTool(): AnnotationToolLike | null;
  getSelectedAnnotations(): TrackedAnnotationLike[];
  updateAnnotations(patches: Array<{ pageIndex: number; id: string; patch: Record<string, unknown> }>): void;
  onActiveToolChange(listener: (tool: AnnotationToolLike | null) => void): () => void;
  onStateChange?(listener: () => void): () => void;
}

interface AnnotationCapabilityLike {
  getColorPresets?(): string[];
  addColorPreset?(color: string): void;
  getTool?(toolId: string): AnnotationToolLike | undefined;
  setToolDefaults?(toolId: string, patch: Record<string, unknown>): void;
  forDocument(documentId: string): AnnotationScopeLike;
}

function getAnnotationCapability(registry?: PluginRegistry) {
  return registry?.getPlugin('annotation')?.provides?.() as AnnotationCapabilityLike | undefined;
}

function normalizeColor(value: unknown) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
}

function getAvailableFields(defaults: Record<string, unknown>, selectedAnnotations: TrackedAnnotationLike[]) {
  const selectedObject = selectedAnnotations[0]?.object ?? {};
  const fields = COLOR_FIELDS.filter(({ key }) => key in defaults || key in selectedObject);
  return fields.length ? fields : COLOR_FIELDS.slice(0, 2);
}

function getInitialField(defaults: Record<string, unknown>, selectedAnnotations: TrackedAnnotationLike[]) {
  const fields = getAvailableFields(defaults, selectedAnnotations);
  return fields.find(({ key }) => key === 'strokeColor')?.key ?? fields[0].key;
}

function getColorPatch(toolId: string | null, field: ColorFieldKey, color: string, defaults: Record<string, unknown>) {
  const patch: Record<string, unknown> = { [field]: color };

  if (
    field === 'strokeColor' &&
    'color' in defaults &&
    toolId &&
    (MARKUP_TOOL_IDS.has(toolId) || STROKE_AND_FILL_TOOL_IDS.has(toolId))
  ) {
    patch.color = color;
  }

  return patch;
}

function normalizeOpacity(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : null;
}

function getToolLabel(tool: AnnotationToolLike | null) {
  if (!tool) {
    return 'Selected annotation';
  }

  return tool.name || tool.id.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (char) => char.toUpperCase());
}

export function ShnctlColorPalette({
  registry,
  open,
  onClose,
}: {
  registry?: PluginRegistry;
  open: boolean;
  onClose: () => void;
}) {
  const annotation = useMemo(() => getAnnotationCapability(registry), [registry]);
  const [activeTool, setActiveTool] = useState<AnnotationToolLike | null>(null);
  const [defaults, setDefaults] = useState<Record<string, unknown>>({});
  const [selectedAnnotations, setSelectedAnnotations] = useState<TrackedAnnotationLike[]>([]);
  const [selectedField, setSelectedField] = useState<ColorFieldKey>('strokeColor');

  useEffect(() => {
    if (!open || !registry || !annotation) {
      return;
    }

    const documentId = getActiveDocumentId(registry);
    if (!documentId) {
      return;
    }

    const scope = annotation.forDocument(documentId);
    const sync = (nextTool = scope.getActiveTool()) => {
      const tool = nextTool?.id ? annotation.getTool?.(nextTool.id) ?? nextTool : nextTool;
      const nextDefaults = tool?.defaults ?? {};
      const nextSelectedAnnotations = scope.getSelectedAnnotations();

      setActiveTool(tool);
      setDefaults(nextDefaults);
      setSelectedAnnotations(nextSelectedAnnotations);
      setSelectedField((currentField) => {
        const availableFields = getAvailableFields(nextDefaults, nextSelectedAnnotations);
        return availableFields.some(({ key }) => key === currentField)
          ? currentField
          : getInitialField(nextDefaults, nextSelectedAnnotations);
      });
    };

    sync();
    const unsubscribeTool = scope.onActiveToolChange(sync);
    const unsubscribeState = scope.onStateChange?.(() => sync());

    return () => {
      unsubscribeTool();
      unsubscribeState?.();
    };
  }, [annotation, open, registry]);

  const colors = useMemo(() => {
    const presets = annotation?.getColorPresets?.() ?? [];
    const merged = [...presets, ...FALLBACK_COLORS]
      .map(normalizeColor)
      .filter((color): color is string => Boolean(color));

    return Array.from(new Set(merged));
  }, [annotation, open]);

  const availableFields = getAvailableFields(defaults, selectedAnnotations);
  const selectedObject = selectedAnnotations[0]?.object ?? {};
  const currentColor =
    normalizeColor(defaults[selectedField]) ??
    normalizeColor(selectedObject[selectedField]) ??
    colors[0] ??
    FALLBACK_COLORS[0];
  const currentOpacity = normalizeOpacity(defaults.opacity) ?? normalizeOpacity(selectedObject.opacity) ?? 1;

  const applyPatch = (patch: Record<string, unknown>) => {
    const documentId = registry ? getActiveDocumentId(registry) : undefined;
    if (!annotation || !documentId) {
      return;
    }

    if (activeTool?.id) {
      annotation.setToolDefaults?.(activeTool.id, patch);
      setDefaults((currentDefaults) => ({ ...currentDefaults, ...patch }));
    }

    if (selectedAnnotations.length) {
      annotation.forDocument(documentId).updateAnnotations(
        selectedAnnotations.map(({ object }) => ({
          pageIndex: object.pageIndex,
          id: object.id,
          patch,
        })),
      );
    }
  };

  const applyColor = (color: string) => {
    const normalizedColor = normalizeColor(color);
    if (!normalizedColor || !annotation) {
      return;
    }

    const patch = getColorPatch(activeTool?.id ?? null, selectedField, normalizedColor, defaults);
    applyPatch(patch);
    annotation.addColorPreset?.(normalizedColor);
  };

  const applyOpacity = (opacity: number) => {
    applyPatch({ opacity: Math.min(1, Math.max(0, opacity)) });
  };

  const body = (() => {
    if (!annotation) {
      return <div className="shnctl-state">Color tools are not ready.</div>;
    }

    return (
      <div className="shnctl-color-content">
        <div className="shnctl-color-meta">
          <span>{getToolLabel(activeTool)}</span>
          {selectedAnnotations.length ? <span>{selectedAnnotations.length} selected</span> : null}
        </div>
        <div className="shnctl-color-targets" role="group" aria-label="Color target">
          {availableFields.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={`shnctl-color-target${selectedField === key ? ' is-active' : ''}`}
              onClick={() => setSelectedField(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="shnctl-color-grid" role="list" aria-label="Color presets">
          {colors.map((color) => (
            <button
              key={color}
              type="button"
              className={`shnctl-color-swatch${currentColor === color ? ' is-active' : ''}`}
              style={{ '--shnctl-swatch-color': color } as CSSProperties}
              onClick={() => applyColor(color)}
              aria-label={color}
            >
              {currentColor === color ? <Check size={13} strokeWidth={2.2} /> : null}
            </button>
          ))}
        </div>
        <label className="shnctl-color-custom">
          <span>Custom</span>
          <input
            className="shnctl-color-input"
            type="color"
            value={currentColor}
            onChange={(event) => applyColor(event.currentTarget.value)}
          />
          <span className="shnctl-color-value">{currentColor}</span>
        </label>
        <label className="shnctl-color-opacity">
          <span>Opacity</span>
          <input
            className="shnctl-color-opacity-input"
            type="range"
            min="0"
            max="100"
            step="1"
            value={Math.round(currentOpacity * 100)}
            onChange={(event) => applyOpacity(Number(event.currentTarget.value) / 100)}
          />
          <span className="shnctl-color-value">{Math.round(currentOpacity * 100)}%</span>
        </label>
      </div>
    );
  })();

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="shnctl-overlay" />
        <Dialog.Content className="shnctl-panel shnctl-color-panel" aria-describedby={undefined}>
          <Dialog.Title className="shnctl-visually-hidden">Annotation colors</Dialog.Title>
          <div className="shnctl-content">{body}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
