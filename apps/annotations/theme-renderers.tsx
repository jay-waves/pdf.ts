import type { AnnotationRenderer, AnnotationRendererProps } from '@embedpdf/react';
import { DEFAULT_ANNOTATION_COLOR, DEFAULT_HIGHLIGHT_COLOR } from './annotations';
import styles from './theme-renderers.module.css';

function ThemeAnnotation({ item, native }: AnnotationRendererProps) {
  const autoHighlight = item.subtype === 'highlight'
    && item.style.color.toLowerCase() === DEFAULT_HIGHLIGHT_COLOR;
  const autoStroke = item.subtype !== 'highlight'
    && item.style.color.toLowerCase() === DEFAULT_ANNOTATION_COLOR;
  const autoText = item.text?.fontColor.toLowerCase() === DEFAULT_ANNOTATION_COLOR;

  if (!autoHighlight && !autoStroke && !autoText) return native;
  return <span
    className={styles.root}
    data-auto-highlight={autoHighlight ? 'true' : undefined}
    data-auto-stroke={autoStroke ? 'true' : undefined}
    data-auto-text={autoText ? 'true' : undefined}
  >{native}</span>;
}

export const annotationRenderers: AnnotationRenderer[] = [{
  id: 'viewer-theme-annotations',
  for: () => true,
  component: ThemeAnnotation,
}];
