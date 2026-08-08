import {
  PdfAnnotationSubtype,
  getContrastStrokeColor,
  type PdfAnnotationObject,
  type PdfTextAnnoObject,
} from '@embedpdf/models';
import { createRenderer } from '@embedpdf/plugin-annotation/react';
import { MessageSquareMore } from 'lucide-react';
import { getThemeHighlightPolicy } from './annotations';
import { getCurrentViewerTheme, isDarkViewerTheme } from './theme';

function isComment(annotation: PdfAnnotationObject): annotation is PdfTextAnnoObject {
  return annotation.type === PdfAnnotationSubtype.TEXT && !annotation.inReplyToId;
}

export const themeCommentRenderer = createRenderer<PdfTextAnnoObject>({
  id: 'themeComment',
  matches: (annotation): annotation is PdfTextAnnoObject => (
    isComment(annotation) && isDarkViewerTheme(getCurrentViewerTheme())
  ),
  useAppearanceStream: false,
  interactionDefaults: {
    isDraggable: true,
    isResizable: false,
    isRotatable: false,
  },
  render: ({ isSelected, onClick }) => {
    const color = getThemeHighlightPolicy().color;
    const lineColor = getContrastStrokeColor(color);

    return <div
      onPointerDown={onClick}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 2,
        pointerEvents: !onClick || isSelected ? 'none' : 'auto',
        cursor: isSelected ? 'move' : onClick ? 'pointer' : 'default',
      }}
    >
      <MessageSquareMore
        aria-hidden="true"
        size="100%"
        fill={color}
        color={lineColor}
        strokeWidth={1.25}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      />
    </div>;
  },
});
