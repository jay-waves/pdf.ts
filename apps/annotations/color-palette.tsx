import { RadioGroup } from 'radix-ui';
import { useEffect, useState, type CSSProperties } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import type { TrackedAnnotation } from '@embedpdf/plugin-annotation';
import { useStore } from 'zustand';
import { viewerThemeStore } from '../theme/theme';
import { ANNOTATION_PALETTES, getAnnotationPaletteIndex, getDefaultAnnotationColor } from './theme-palette';
import {
  TRANSPARENT_ANNOTATION_COLOR,
  getAnnotationCapability,
  getAnnotationColorFields,
  getAnnotationPresetPatch,
  getAnnotationScope,
  getAnnotationToolLabel,
  getCommonAnnotationTool,
  normalizeAnnotationColor,
  type AnnotationColorFieldKey,
  type AnnotationToolLike,
} from './annotations';
import { Dialog, PanelContent, PanelState } from '../components';
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
  documentId,
  open,
  onClose,
}: {
  registry?: PluginRegistry;
  documentId?: string | null;
  open: boolean;
  onClose(): void;
}) {
  const capability = getAnnotationCapability(registry);
  const theme = useStore(viewerThemeStore, (state) => state.theme);
  const [snapshot, setSnapshot] = useState<PaletteSnapshot>(EMPTY_SNAPSHOT);
  const [selectedField, setSelectedField] = useState<AnnotationColorFieldKey>('strokeColor');
  const { activeTool, contextTool, defaults, selectedAnnotations } = snapshot;

  useEffect(() => {
    const scoped = open ? getAnnotationScope(registry, documentId) : null;
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
    const unsubscribeTools = scoped.capability.onToolsChange(sync);
    return () => {
      unsubscribeTool();
      unsubscribeState();
      unsubscribeTools();
    };
  }, [documentId, open, registry]);

  const colors = ANNOTATION_PALETTES[theme];

  const toolId = contextTool?.id ?? null;
  const values = getAnnotationValues(defaults, selectedAnnotations);
  const colorFields = getAnnotationColorFields(toolId, values);
  const currentColor =
    normalizeAnnotationColor(values[selectedField]) ??
    getDefaultAnnotationColor(theme);
  const currentIndex = getAnnotationPaletteIndex(currentColor);
  const presetValue = currentColor === TRANSPARENT_ANNOTATION_COLOR
    ? TRANSPARENT_ANNOTATION_COLOR
    : currentIndex !== null ? colors[currentIndex] : '';

  const applyPatch = (patch: Record<string, unknown>) => {
    const scoped = getAnnotationScope(registry, documentId);
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

    applyPatch(getAnnotationPresetPatch(toolId, selectedField, color));
  };

  const body = !capability
    ? <PanelState>Color tools are not ready.</PanelState>
    : <div className={styles.content}>
        <div className={styles.meta}>
          <span>{getAnnotationToolLabel(contextTool)}</span>
        </div>

        {colorFields.length > 1 ? <RadioGroup.Root
          className={styles.targets}
          value={selectedField}
          onValueChange={(value) => setSelectedField(value as AnnotationColorFieldKey)}
          orientation="horizontal"
          aria-label="Color target"
        >
          {colorFields.map(({ key, label }) => <RadioGroup.Item
            key={key}
            value={key}
            className={styles.target}
          >
            {label}
          </RadioGroup.Item>)}
        </RadioGroup.Root> : null}

        {/* Use click so an already selected preset can still be reapplied. */}
        <RadioGroup.Root className={styles.grid} value={presetValue} orientation="horizontal" aria-label="Color presets">
          {colors.map((color, index) => {
            const number = String(index + 1).padStart(2, '0');
            return <RadioGroup.Item
              key={index}
              value={color}
              className={styles.swatch}
              style={{ '--pdf-swatch-color': color } as CSSProperties}
              onClick={() => applyColor(color)}
              aria-label={`Color ${number}`}
            >
              <span className={styles.color} />
            </RadioGroup.Item>;
          })}
          {selectedField === 'color' || selectedField === 'backgroundColor' ? <RadioGroup.Item
            value={TRANSPARENT_ANNOTATION_COLOR}
            className={styles.swatch}
            onClick={() => applyColor(TRANSPARENT_ANNOTATION_COLOR)}
            aria-label="Transparent"
          >
            <span className={`${styles.color} ${styles.transparent}`} />
          </RadioGroup.Item> : null}
        </RadioGroup.Root>

      </div>;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Annotation colors"
      variant="panelCompact"
      contentClassName={styles.dialog}
    >
      <PanelContent>{body}</PanelContent>
    </Dialog>
  );
}
