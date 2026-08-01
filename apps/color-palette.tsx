import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import { PdfBlendMode } from '@embedpdf/models';
import type { TrackedAnnotation } from '@embedpdf/plugin-annotation';
import { Check } from 'lucide-react';
import {
  DEFAULT_ANNOTATION_COLORS,
  HIGHLIGHT_STYLES,
  TRANSPARENT_ANNOTATION_COLOR,
  getAnnotationCapability,
  getAnnotationColorFields,
  getAnnotationColorPatch,
  getAnnotationScope,
  getAnnotationToolLabel,
  getCommonAnnotationTool,
  normalizeAnnotationColor,
  normalizeAnnotationOpacity,
  type AnnotationColorFieldKey,
  type AnnotationToolLike,
} from './annotations';
import { Dialog, PanelContent, PanelState } from './components';
import styles from './color-palette.module.css';

interface PaletteSnapshot {
  activeTool: AnnotationToolLike | null;
  contextTool: AnnotationToolLike | null;
  defaults: Record<string, unknown>;
  selectedAnnotations: TrackedAnnotation[];
}

const EMPTY_SNAPSHOT: PaletteSnapshot = {
  activeTool: null,
  contextTool: null,
  defaults: {},
  selectedAnnotations: [],
};

function getAnnotationValues(
  defaults: Record<string, unknown>,
  selectedAnnotations: TrackedAnnotation[],
) {
  const selected = (selectedAnnotations[0]?.object ?? {}) as unknown as Record<string, unknown>;
  return { ...selected, ...defaults };
}

export function ColorPalette({
  registry,
  open,
  onClose,
}: {
  registry?: PluginRegistry;
  open: boolean;
  onClose(): void;
}) {
  const capability = getAnnotationCapability(registry);
  const [snapshot, setSnapshot] = useState<PaletteSnapshot>(EMPTY_SNAPSHOT);
  const [selectedField, setSelectedField] = useState<AnnotationColorFieldKey>('strokeColor');
  const { activeTool, contextTool, defaults, selectedAnnotations } = snapshot;

  useEffect(() => {
    const scoped = open ? getAnnotationScope(registry) : null;
    if (!scoped) {
      setSnapshot(EMPTY_SNAPSHOT);
      return;
    }

    const sync = () => {
      const active = scoped.scope.getActiveTool();
      const resolvedActive = active?.id ? scoped.capability.getTool(active.id) ?? active : null;
      const selected = scoped.scope.getSelectedAnnotations();
      const context = resolvedActive ?? getCommonAnnotationTool(scoped.capability, selected);
      const nextDefaults = resolvedActive?.defaults ?? {};
      const fields = getAnnotationColorFields(
        context?.id ?? null,
        getAnnotationValues(nextDefaults, selected),
      );

      setSnapshot({
        activeTool: resolvedActive,
        contextTool: context,
        defaults: nextDefaults,
        selectedAnnotations: selected,
      });
      setSelectedField((current) => (
        fields.some(({ key }) => key === current) ? current : fields[0].key
      ));
    };

    sync();
    const unsubscribeTool = scoped.scope.onActiveToolChange(sync);
    const unsubscribeState = scoped.scope.onStateChange(sync);
    return () => {
      unsubscribeTool();
      unsubscribeState();
    };
  }, [open, registry]);

  const colors = useMemo(() => {
    const presets = capability?.getColorPresets() ?? [];
    return Array.from(new Set([
      TRANSPARENT_ANNOTATION_COLOR,
      ...presets,
      ...DEFAULT_ANNOTATION_COLORS,
    ].map(normalizeAnnotationColor).filter((color): color is string => Boolean(color))));
  }, [capability, open]);

  const toolId = contextTool?.id ?? null;
  const values = getAnnotationValues(defaults, selectedAnnotations);
  const colorFields = getAnnotationColorFields(toolId, values);
  const currentColor =
    normalizeAnnotationColor(values[selectedField]) ??
    DEFAULT_ANNOTATION_COLORS[0];
  const customInputColor = currentColor === TRANSPARENT_ANNOTATION_COLOR
    ? DEFAULT_ANNOTATION_COLORS[0]
    : currentColor;
  const currentOpacity = normalizeAnnotationOpacity(values.opacity) ?? 1;
  const currentHighlightStyle = typeof values.blendMode === 'number'
    ? values.blendMode
    : PdfBlendMode.Multiply;

  const applyPatch = (patch: Record<string, unknown>) => {
    const scoped = getAnnotationScope(registry);
    if (!scoped) return;

    if (activeTool?.id) {
      scoped.capability.setToolDefaults(activeTool.id, patch);
      setSnapshot((current) => ({
        ...current,
        defaults: { ...current.defaults, ...patch },
      }));
    }

    if (selectedAnnotations.length) {
      scoped.scope.updateAnnotations(selectedAnnotations.map(({ object }) => ({
        pageIndex: object.pageIndex,
        id: object.id,
        patch,
      })));
    }
  };

  const applyColor = (value: string) => {
    const color = normalizeAnnotationColor(value);
    if (!color || !capability) return;

    applyPatch(getAnnotationColorPatch(toolId, selectedField, color));
    if (color !== TRANSPARENT_ANNOTATION_COLOR) capability.addColorPreset(color);
  };

  const body = !capability
    ? <PanelState>Color tools are not ready.</PanelState>
    : <div className={styles.content}>
        <div className={styles.meta}>
          <span>{getAnnotationToolLabel(contextTool)}</span>
          {selectedAnnotations.length ? <span>{selectedAnnotations.length} selected</span> : null}
        </div>

        {toolId === 'highlight' ? <div
          className={styles.targets}
          role="group"
          aria-label="Highlight style"
        >
          {HIGHLIGHT_STYLES.map(({ label, value }) => <button
            key={value}
            type="button"
            className={styles.target}
            data-active={currentHighlightStyle === value ? 'true' : undefined}
            onClick={() => applyPatch({ blendMode: value })}
            aria-pressed={currentHighlightStyle === value}
          >
            {label}
          </button>)}
        </div> : null}

        {colorFields.length > 1 ? <div
          className={styles.targets}
          role="group"
          aria-label="Color target"
        >
          {colorFields.map(({ key, label }) => <button
            key={key}
            type="button"
            className={styles.target}
            data-active={selectedField === key ? 'true' : undefined}
            onClick={() => setSelectedField(key)}
            aria-pressed={selectedField === key}
          >
            {label}
          </button>)}
        </div> : null}

        <div className={styles.grid} role="group" aria-label="Color presets">
          {colors.map((color) => <button
            key={color}
            type="button"
            className={styles.swatch}
            style={{ '--pdf-swatch-color': color } as CSSProperties}
            data-active={currentColor === color ? 'true' : undefined}
            data-transparent={color === TRANSPARENT_ANNOTATION_COLOR ? 'true' : undefined}
            onClick={() => applyColor(color)}
            aria-label={color === TRANSPARENT_ANNOTATION_COLOR ? 'Transparent' : color}
            aria-pressed={currentColor === color}
          >
            {currentColor === color ? <Check size={13} strokeWidth={2.2} /> : null}
          </button>)}
        </div>

        <label className={styles.custom}>
          <span>Custom</span>
          <input
            className={styles.colorInput}
            type="color"
            value={customInputColor}
            onChange={(event) => applyColor(event.currentTarget.value)}
          />
          <span className={styles.value}>{currentColor}</span>
        </label>

        <label className={styles.opacity}>
          <span>Opacity</span>
          <input
            className={styles.opacityInput}
            type="range"
            min="0"
            max="100"
            step="1"
            value={Math.round(currentOpacity * 100)}
            onChange={(event) => applyPatch({
              opacity: Number(event.currentTarget.value) / 100,
            })}
          />
          <span className={styles.value}>{Math.round(currentOpacity * 100)}%</span>
        </label>
      </div>;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Annotation colors"
      variant="panelCompact"
    >
      <PanelContent>{body}</PanelContent>
    </Dialog>
  );
}
