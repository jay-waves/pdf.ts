import {
  PdfAnnotationSubtype,
  PdfBlendMode,
  blendModeToCss,
  type PdfAnnotationObject,
  type PdfHighlightAnnoObject,
} from '@embedpdf/models';
import { createRenderer } from '@embedpdf/plugin-annotation/react';
import { getCurrentViewerTheme, isDarkViewerTheme } from './theme';
import { getThemeHighlightPolicy, hasThemeHighlightAppearance } from './annotations';

function isHighlight(annotation: PdfAnnotationObject): annotation is PdfHighlightAnnoObject {
  return annotation.type === PdfAnnotationSubtype.HIGHLIGHT;
}

function usesThemeHighlight() {
  return isDarkViewerTheme(getCurrentViewerTheme());
}

export const themeHighlightRenderer = createRenderer<PdfHighlightAnnoObject>({
  id: 'themeHighlight',
  matches: (annotation): annotation is PdfHighlightAnnoObject => (
    isHighlight(annotation)
    && (usesThemeHighlight() || hasThemeHighlightAppearance(annotation))
  ),
  useAppearanceStream: false,
  zIndex: 0,
  defaultBlendMode: PdfBlendMode.Multiply,
  containerStyle: () => ({
    mixBlendMode: blendModeToCss(getThemeHighlightPolicy().blendMode),
  }),
  interactionDefaults: {
    isDraggable: false,
    isResizable: false,
    isRotatable: false,
  },
  render: ({ currentObject, scale, onClick }) => {
    const policy = getThemeHighlightPolicy();

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
          opacity: policy.opacity,
          pointerEvents: onClick ? 'auto' : 'none',
          cursor: onClick ? 'pointer' : 'default',
          zIndex: onClick ? 1 : undefined,
        }}
      />)}
    </>;
  },
});
