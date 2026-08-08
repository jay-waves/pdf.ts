import {
  PdfAnnotationSubtype,
  PdfBlendMode,
  blendModeToCss,
  type PdfAnnotationObject,
  type PdfHighlightAnnoObject,
  type PdfStrikeOutAnnoObject,
  type PdfUnderlineAnnoObject,
} from '@embedpdf/models';
import { createRenderer } from '@embedpdf/plugin-annotation/react';
import type { ComponentProps } from 'react';
import {
  getThemeHighlightPolicy,
  hasAutoAnnotationStrokeColor,
  hasAutoHighlightColor,
} from './annotations';

function isHighlight(annotation: PdfAnnotationObject): annotation is PdfHighlightAnnoObject {
  return annotation.type === PdfAnnotationSubtype.HIGHLIGHT;
}

function getHighlightAppearance(annotation: PdfHighlightAnnoObject) {
  const blendMode = annotation.blendMode ?? PdfBlendMode.Multiply;
  const opacity = annotation.opacity ?? 1;
  const policy = getThemeHighlightPolicy();
  return blendMode === PdfBlendMode.Multiply && opacity === 1
    ? { blendMode: policy.blendMode, opacity: policy.opacity }
    : { blendMode, opacity };
}

export const themeHighlightRenderer = createRenderer<PdfHighlightAnnoObject>({
  id: 'themeHighlight',
  matches: (annotation): annotation is PdfHighlightAnnoObject => (
    isHighlight(annotation)
    && hasAutoHighlightColor(annotation)
  ),
  useAppearanceStream: false,
  zIndex: 0,
  defaultBlendMode: PdfBlendMode.Multiply,
  containerStyle: (annotation) => ({
    mixBlendMode: blendModeToCss(getHighlightAppearance(annotation).blendMode),
  }),
  interactionDefaults: {
    isDraggable: false,
    isResizable: false,
    isRotatable: false,
  },
  render: ({ currentObject, scale, onClick }) => {
    const policy = getThemeHighlightPolicy();
    const { opacity } = getHighlightAppearance(currentObject);

    return <>
      {currentObject.segmentRects.map((segment, index) => <div
        key={index}
        onPointerDown={onClick}
        style={{
          position: 'absolute',
          left: (segment.origin.x - currentObject.rect.origin.x) * scale,
          top: (segment.origin.y - currentObject.rect.origin.y) * scale,
          width: segment.size.width * scale,
          height: segment.size.height * scale,
          background: policy.color,
          opacity,
          pointerEvents: onClick ? 'auto' : 'none',
          cursor: onClick ? 'pointer' : 'default',
          zIndex: onClick ? 1 : undefined,
        }}
      />)}
    </>;
  },
});

type ThemeLineMarkupProps = {
  annotation: PdfUnderlineAnnoObject | PdfStrikeOutAnnoObject;
  placement: 'bottom' | 'middle';
  scale: number;
  onClick?: ComponentProps<'div'>['onPointerDown'];
};

function ThemeLineMarkup({ annotation, placement, scale, onClick }: ThemeLineMarkupProps) {
  const thickness = 1.5 * scale;
  return <>
    {annotation.segmentRects.map((segment, index) => <div
      key={index}
      onPointerDown={onClick}
      style={{
        position: 'absolute',
        left: (segment.origin.x - annotation.rect.origin.x) * scale,
        top: (segment.origin.y - annotation.rect.origin.y) * scale,
        width: segment.size.width * scale,
        height: segment.size.height * scale,
        background: 'transparent',
        pointerEvents: onClick ? 'auto' : 'none',
        cursor: onClick ? 'pointer' : 'default',
        zIndex: onClick ? 1 : 0,
      }}
    >
      <div style={{
        position: 'absolute',
        left: 0,
        width: '100%',
        height: thickness,
        background: 'var(--pdf-annotation-auto-stroke)',
        opacity: annotation.opacity ?? 0.5,
        pointerEvents: 'none',
        ...(placement === 'bottom'
          ? { bottom: 0 }
          : { top: '50%', transform: 'translateY(-50%)' }),
      }} />
    </div>)}
  </>;
}

export const themeUnderlineRenderer = createRenderer<PdfUnderlineAnnoObject>({
  id: 'themeUnderline',
  matches: (annotation): annotation is PdfUnderlineAnnoObject => (
    annotation.type === PdfAnnotationSubtype.UNDERLINE
    && hasAutoAnnotationStrokeColor(annotation)
  ),
  useAppearanceStream: false,
  zIndex: 0,
  interactionDefaults: {
    isDraggable: false,
    isResizable: false,
    isRotatable: false,
  },
  render: ({ currentObject, scale, onClick }) => <ThemeLineMarkup
    annotation={currentObject}
    placement="bottom"
    scale={scale}
    onClick={onClick}
  />,
});

export const themeStrikeoutRenderer = createRenderer<PdfStrikeOutAnnoObject>({
  id: 'themeStrikeout',
  matches: (annotation): annotation is PdfStrikeOutAnnoObject => (
    annotation.type === PdfAnnotationSubtype.STRIKEOUT
    && hasAutoAnnotationStrokeColor(annotation)
  ),
  useAppearanceStream: false,
  zIndex: 0,
  interactionDefaults: {
    isDraggable: false,
    isResizable: false,
    isRotatable: false,
  },
  render: ({ currentObject, scale, onClick }) => <ThemeLineMarkup
    annotation={currentObject}
    placement="middle"
    scale={scale}
    onClick={onClick}
  />,
});
