import { useEffect, useState, type CSSProperties } from 'react';
import {
  useAnnotation,
  useAnnotationDefaults,
  useAnnotationSelection,
  useSelectionProps,
  useTool,
} from '@embedpdf/react';
import { Check } from 'lucide-react';
import { Dialog, PanelContent, PanelState } from '../components';
import {
  DEFAULT_ANNOTATION_COLOR,
  DEFAULT_ANNOTATION_COLORS,
  DEFAULT_HIGHLIGHT_COLOR,
  TRANSPARENT_ANNOTATION_COLOR,
  asAnnotationPatch,
  getAnnotationColorFields,
  isAnnotationTool,
  type AnnotationColorKey,
} from './annotations';
import styles from './color-palette.module.css';

export function ColorPalette({ open, onClose }: { open: boolean; onClose(): void }) {
  const annotation = useAnnotation();
  const { activeToolId } = useTool();
  const selection = useAnnotationSelection();
  const selectionProps = useSelectionProps();
  const editingDefaults = isAnnotationTool(activeToolId);
  const defaults = useAnnotationDefaults(editingDefaults ? activeToolId : 'highlight');
  const toolId = editingDefaults ? activeToolId : null;
  const [selectedField, setSelectedField] = useState<AnnotationColorKey>('color');
  const fields = getAnnotationColorFields(toolId);

  useEffect(() => {
    if (!fields.some(({ key }) => key === selectedField)) setSelectedField(fields[0].key);
  }, [fields, selectedField]);

  const values = selection.length ? selectionProps.values : defaults;
  const value = values[selectedField];
  const currentColor = typeof value === 'string' ? value : DEFAULT_HIGHLIGHT_COLOR;
  const opacity = typeof values.opacity === 'number' ? values.opacity : 1;
  const canEdit = selection.length > 0 || editingDefaults;

  const applyPatch = (patch: Parameters<typeof annotation.updateSelection>[0]) => {
    if (selection.length) annotation.updateSelection(patch);
    else if (editingDefaults) {
      // TODO(next.10): setDefaults is typed as Subtype although defaults are keyed by tool preset.
      annotation.setDefaults(activeToolId as Parameters<typeof annotation.setDefaults>[0], patch);
    }
  };

  const colors = [TRANSPARENT_ANNOTATION_COLOR, ...DEFAULT_ANNOTATION_COLORS];
  const customInputColor = currentColor === TRANSPARENT_ANNOTATION_COLOR
    ? DEFAULT_ANNOTATION_COLOR
    : currentColor;

  return (
    <Dialog open={open} onClose={onClose} title="Annotation colors" variant="panelCompact">
      <PanelContent>
        {!canEdit ? <PanelState>Select an annotation or drawing tool first.</PanelState> : (
          <div className={styles.content}>
            {fields.length > 1 ? <div className={styles.targets} role="group" aria-label="Color target">
              {fields.map(({ key, label }) => <button
                key={key}
                type="button"
                className={styles.target}
                data-active={selectedField === key ? 'true' : undefined}
                onClick={() => setSelectedField(key)}
              >{label}</button>)}
            </div> : null}
            <div className={styles.grid} role="group" aria-label="Color presets">
              {colors.map((color) => <button
                key={color}
                type="button"
                className={styles.swatch}
                style={{ '--pdf-swatch-color': color } as CSSProperties}
                data-active={currentColor === color ? 'true' : undefined}
                data-transparent={color === TRANSPARENT_ANNOTATION_COLOR ? 'true' : undefined}
                onClick={() => applyPatch(asAnnotationPatch(selectedField, color))}
                aria-label={color === TRANSPARENT_ANNOTATION_COLOR ? 'Transparent' : color}
              >{currentColor === color ? <Check size={13} /> : null}</button>)}
            </div>
            <label className={styles.custom}>
              <span>Custom</span>
              <input className={styles.colorInput} type="color" value={customInputColor}
                onChange={(event) => applyPatch(asAnnotationPatch(selectedField, event.currentTarget.value))} />
              <span className={styles.value}>{currentColor}</span>
            </label>
            <label className={styles.opacity}>
              <span>Opacity</span>
              <input className={styles.opacityInput} type="range" min="0" max="100" value={Math.round(opacity * 100)}
                onChange={(event) => applyPatch({ opacity: Number(event.currentTarget.value) / 100 })} />
              <span className={styles.value}>{Math.round(opacity * 100)}%</span>
            </label>
          </div>
        )}
      </PanelContent>
    </Dialog>
  );
}
