import { PdfAnnotationSubtype, type PdfAnnotationObject } from '@embedpdf/models';
import type { CustomAnnotationRenderer } from '@embedpdf/plugin-annotation/react';
import {
  hasAutoAnnotationStrokeColor,
  hasAutoAnnotationTextColor,
} from './annotations';
import styles from './theme-annotation-color.module.css';

export const themeAnnotationColorRenderer: CustomAnnotationRenderer<PdfAnnotationObject> = ({
  annotation,
  children,
}) => {
  // Highlight and text-comment AUTO colors have dedicated renderers because
  // their visuals need more than a simple stroke/text CSS override.
  const dedicatedRenderer = annotation.type === PdfAnnotationSubtype.HIGHLIGHT
    || annotation.type === PdfAnnotationSubtype.TEXT
    || annotation.type === PdfAnnotationSubtype.UNDERLINE
    || annotation.type === PdfAnnotationSubtype.STRIKEOUT;
  const autoStroke = !dedicatedRenderer && hasAutoAnnotationStrokeColor(annotation);
  const autoText = hasAutoAnnotationTextColor(annotation);

  if (!autoStroke && !autoText) return children;

  return <span
    className={styles.root}
    data-auto-stroke={autoStroke ? 'true' : undefined}
    data-auto-text={autoText ? 'true' : undefined}
  >
    {children}
  </span>;
};
