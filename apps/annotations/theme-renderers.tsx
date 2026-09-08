import {
  PdfAnnotationSubtype,
  PdfBlendMode,
  blendModeToCss,
  getContrastStrokeColor,
  type PdfAnnotationObject,
  type PdfHighlightAnnoObject,
  type PdfStrikeOutAnnoObject,
  type PdfTextAnnoObject,
  type PdfUnderlineAnnoObject,
} from '@embedpdf/models';
import { createRenderer, type AnnotationRendererProps, type CustomAnnotationRenderer } from '@embedpdf/plugin-annotation/react';
import { cloneElement, type ReactElement, type ComponentProps } from 'react';
import { MessageSquareMore } from 'lucide-react';
import { useStore } from 'zustand';
import { isDarkViewerTheme, viewerThemeStore } from '../theme/theme';
import { getAnnotationDisplayColors, getThemeAnnotationColor } from './theme-palette';
import {
  getThemeHighlightPolicy,
  VECTOR_ANNOTATION_OPACITY,
  VECTOR_ANNOTATION_STROKE_WIDTH,
  hasAutoHighlightColor,
} from './annotations';
import styles from './theme-renderers.module.css';

export const themeAnnotationColorRenderer: CustomAnnotationRenderer<PdfAnnotationObject> = ({
  annotation,
  children,
}) => <ThemeAnnotationColors annotation={annotation}>{children}</ThemeAnnotationColors>;

function ThemeAnnotationColors({ annotation, children }: {
  annotation: PdfAnnotationObject;
  children: ReactElement;
}) {
  const theme = useStore(viewerThemeStore, (state) => state.theme);
  // These renderers already resolve their colors from the theme.
  if (annotation.type === PdfAnnotationSubtype.HIGHLIGHT
    || annotation.type === PdfAnnotationSubtype.TEXT
    || annotation.type === PdfAnnotationSubtype.UNDERLINE
    || annotation.type === PdfAnnotationSubtype.STRIKEOUT) return children;
  const display = getAnnotationDisplayColors(annotation, theme);
  const mapped = display !== annotation;
  const element = children as ReactElement<Record<string, unknown>>;
  const tracked = element.props.annotation as { object: PdfAnnotationObject } | undefined;
  // EmbedPDF's geometry renderers take colors directly; FreeText takes a
  // tracked annotation. Change only visual props, retaining all edit handlers.
  return <span className={styles.root} data-themed={mapped ? 'true' : undefined}>
    {mapped ? cloneElement(element, {
      ...getAnnotationDisplayColors(element.props, theme),
      ...(tracked ? { annotation: { ...tracked, object: display } } : {}),
      appearanceActive: false,
    }) : children}
  </span>;
}

function isComment(annotation: PdfAnnotationObject): annotation is PdfTextAnnoObject {
  return annotation.type === PdfAnnotationSubtype.TEXT && !annotation.inReplyToId;
}

export const themeCommentRenderer = createRenderer<PdfTextAnnoObject>({
  id: 'themeComment',
  matches: (annotation): annotation is PdfTextAnnoObject => (
    isComment(annotation) && getThemeAnnotationColor(annotation.strokeColor ?? annotation.color, 'light') !== null
  ),
  useAppearanceStream: false,
  interactionDefaults: {
    isDraggable: true,
    isResizable: false,
    isRotatable: false,
  },
  render: (props) => <ThemeComment {...props} />,
});

function ThemeComment({ currentObject, isSelected, onClick }: AnnotationRendererProps<PdfTextAnnoObject>) {
    const theme = useStore(viewerThemeStore, (state) => state.theme);
    const color = getThemeAnnotationColor(currentObject.strokeColor ?? currentObject.color, theme)
      ?? currentObject.strokeColor ?? currentObject.color ?? getThemeHighlightPolicy().color;
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
        style={{
          position: 'absolute',
          inset: 0,
          opacity: currentObject.opacity ?? 1,
          pointerEvents: 'none',
        }}
      />
    </div>;
}

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
  ),
  useAppearanceStream: false,
  zIndex: 0,
  defaultBlendMode: PdfBlendMode.Multiply,
  containerStyle: (annotation) => ({
    mixBlendMode: isDarkViewerTheme(viewerThemeStore.getState().theme)
      ? 'normal'
      : blendModeToCss(getHighlightAppearance(annotation).blendMode),
  }),
  interactionDefaults: {
    isDraggable: false,
    isResizable: false,
    isRotatable: false,
  },
  render: (props) => <ThemeHighlight {...props} />,
});

function ThemeHighlight({ currentObject, scale, onClick }: AnnotationRendererProps<PdfHighlightAnnoObject>) {
    const theme = useStore(viewerThemeStore, (state) => state.theme);
    const dark = isDarkViewerTheme(theme);
    const policy = getThemeHighlightPolicy();
    const { opacity } = getHighlightAppearance(currentObject);
    const color = hasAutoHighlightColor(currentObject)
      ? policy.color
      : getThemeAnnotationColor(currentObject.strokeColor ?? currentObject.color, theme)
        ?? currentObject.strokeColor ?? currentObject.color ?? policy.color;

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
          background: dark ? 'transparent' : color,
          opacity: dark ? 1 : opacity,
          pointerEvents: onClick ? 'auto' : 'none',
          cursor: onClick ? 'pointer' : 'default',
          zIndex: onClick ? 1 : undefined,
        }}
      >
        {dark ? <div style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: VECTOR_ANNOTATION_STROKE_WIDTH * scale,
          borderRadius: VECTOR_ANNOTATION_STROKE_WIDTH * scale / 2,
          background: color,
          opacity: VECTOR_ANNOTATION_OPACITY,
          pointerEvents: 'none',
        }} /> : null}
      </div>)}
    </>;
}

type ThemeLineMarkupProps = {
  annotation: PdfUnderlineAnnoObject | PdfStrikeOutAnnoObject;
  placement: 'bottom' | 'middle';
  scale: number;
  onClick?: ComponentProps<'div'>['onPointerDown'];
};

function ThemeLineMarkup({ annotation, placement, scale, onClick }: ThemeLineMarkupProps) {
  const theme = useStore(viewerThemeStore, (state) => state.theme);
  const thickness = VECTOR_ANNOTATION_STROKE_WIDTH * scale;
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
        background: getThemeAnnotationColor(annotation.strokeColor ?? annotation.color, theme)
          ?? annotation.strokeColor ?? annotation.color,
        borderRadius: thickness / 2,
        opacity: annotation.opacity ?? VECTOR_ANNOTATION_OPACITY,
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
