import { annotationKey } from '@embedpdf/core';
import { RadioGroup } from 'radix-ui';
import { useEffect, useState, type CSSProperties } from 'react';
import { useAnnotation, useAnnotationProperties, useAnnotationState } from '@embedpdf/react/annotation';
import { useInteractionState } from '@embedpdf/react/interaction';
import { useStore } from 'zustand';
import { viewerThemeStore } from '../theme/theme';
import { ANNOTATION_PALETTES, getAnnotationPaletteIndex, getDefaultAnnotationColor } from './theme-palette';
import { TRANSPARENT_ANNOTATION_COLOR, getAnnotationPresetPatch, getAnnotationToolLabel, getCommonAnnotationTool, normalizeAnnotationColor } from './annotations';
import { Dialog, PanelContent, PanelState } from '../components';
import styles from './color-palette.module.css';

export function ColorPalette({ open, onClose }: { open: boolean; onClose(): void }) {
  const capability = useAnnotation();
  const activeId = useInteractionState(state => state.activeToolId);
  const selected = useAnnotationState(state => state.selected);
  const activeTool = activeId ? capability.tools.get(activeId) : null;
  const contextTool = activeTool ?? getCommonAnnotationTool(capability, selected);
  const { properties, values, mixed } = useAnnotationProperties(activeTool?.id);
  const theme = useStore(viewerThemeStore, state => state.theme);
  const [selectedField, setSelectedField] = useState('color');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const selectionKey = selected.map(annotation => annotationKey(annotation.ref)).join(',');
  useEffect(() => { setError(''); }, [open, activeId, selectionKey]);
  const labels: Record<string, string> = { color: 'Stroke', interiorColor: 'Fill', fontColor: 'Text' };
  const colorFields = properties.filter(property => property.key in labels)
    .map(property => ({ key: property.key, label: labels[property.key] }));
  const field = colorFields.some(item => item.key === selectedField) ? selectedField : colorFields[0]?.key ?? 'color';
  const colors = ANNOTATION_PALETTES[theme];
  const readOnly = !activeTool && selected.length > 0 && selected.every(annotation => !capability.canUpdate(annotation.ref));
  const currentColor = normalizeAnnotationColor(values[field]) ?? getDefaultAnnotationColor(theme);
  const currentIndex = getAnnotationPaletteIndex(currentColor);
  const presetValue = mixed.includes(field) ? '' : currentColor === TRANSPARENT_ANNOTATION_COLOR
    ? TRANSPARENT_ANNOTATION_COLOR : currentIndex !== null ? colors[currentIndex] : '';

  const applyColor = async (value: string) => {
    const color = normalizeAnnotationColor(value);
    if (!color || busy || readOnly) return;
    const patch = getAnnotationPresetPatch(contextTool?.id ?? null,
      field === 'fontColor' ? 'textColor' : field as 'color' | 'interiorColor', color);
    // The plugin's style fields respect an active rich-text range or caret.
    const changes = field === 'fontColor'
      ? { ...patch, richText: undefined, fontColor: (patch.richText as { body: { color: string } }).body.color }
      : patch;
    setBusy(true); setError('');
    try {
      if (activeTool) capability.tools.updateDefaults(activeTool.id, changes);
      if (selected.length) {
        const lockedCount = selected.filter(annotation => !capability.canUpdate(annotation.ref)).length;
        const result = await capability.selection.update(annotation => capability.canUpdate(annotation.ref) ? changes : {});
        const failedCount = lockedCount + result.failed.length;
        if (failedCount) setError(`${failedCount} annotation(s) could not be updated. They may be locked or read-only.`);
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Failed to update colors.'); }
    finally { setBusy(false); }
  };

  const body = !colorFields.length
    ? <PanelState>Select an annotation or drawing tool to change its colors.</PanelState>
    : <div className={styles.content}>
        <div className={styles.meta}>
          {mixed.includes(field) ? <span>Mixed colors</span> : null}
          <span>{getAnnotationToolLabel(contextTool)}</span>
        </div>

        {colorFields.length > 1 ? <RadioGroup.Root
          className={styles.targets}
          value={field}
          onValueChange={(value) => setSelectedField(value)}
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
              disabled={busy || readOnly}
              onClick={() => void applyColor(color)}
              aria-label={`Color ${number}`}
            >
              <span className={styles.color} />
            </RadioGroup.Item>;
          })}
          {field === 'color' || field === 'interiorColor' ? <RadioGroup.Item
            value={TRANSPARENT_ANNOTATION_COLOR}
            className={styles.swatch}
            disabled={busy || readOnly}
            onClick={() => void applyColor(TRANSPARENT_ANNOTATION_COLOR)}
            aria-label="Transparent"
          >
            <span className={`${styles.color} ${styles.transparent}`} />
          </RadioGroup.Item> : null}
        </RadioGroup.Root>

        {readOnly ? <p role="status">Selected annotations are locked or read-only.</p> : null}
        {error ? <p role="alert">{error}</p> : null}
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
