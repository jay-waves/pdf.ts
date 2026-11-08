import { useRichTextEditor, type AnnotationRenderer, type AnnotationRendererProps } from '@embedpdf/react/annotation';
import { fromDTO, initialModel, pageItems, scene, type SceneNode } from '@embedpdf/core-annotation';
import type { CSSProperties } from 'react';
import { annotationKey } from '@embedpdf/core';
import { MessageSquareMore } from 'lucide-react';
import { useStore } from 'zustand';
import { isDarkViewerTheme, viewerThemeStore } from '../theme/theme';
import { ANNOTATION_PALETTES, getAnnotationDisplayColors, getThemeAnnotationColor } from './theme-palette';
import { getAnnotationRects, getThemeHighlightPolicy, hasAutoHighlightColor, VECTOR_ANNOTATION_OPACITY, VECTOR_ANNOTATION_STROKE_WIDTH } from './annotations';
import styles from './theme-renderers.module.css';

function ThemeMarkup({ annotation, frame }: AnnotationRendererProps) {
  const theme = useStore(viewerThemeStore, (state) => state.theme);
  const dark = isDarkViewerTheme(theme);
  const policy = getThemeHighlightPolicy(theme);
  const rawColor = 'color' in annotation ? annotation.color : null;
  const color = hasAutoHighlightColor(annotation) ? policy.color : getThemeAnnotationColor(rawColor, theme) ?? rawColor ?? policy.color;
  const rects = getAnnotationRects(annotation);
  const line = annotation.subtype !== 'highlight' || dark;
  const last = rects.at(-1) ?? annotation.rect;
  return <>
    {rects.map((rect, index) => <div key={index} style={{
      position: 'absolute', left: rect.x - annotation.rect.x, top: rect.y - annotation.rect.y,
      width: rect.width, height: rect.height, background: line ? 'transparent' : color,
      opacity: line ? 1 : ('opacity' in annotation ? annotation.opacity : 1),
      mixBlendMode: line ? 'normal' : 'multiply',
    }}>{line ? <div style={{ position: 'absolute', left: 0, right: 0,
      ...(annotation.subtype === 'strikeout' ? { top: '50%', transform: 'translateY(-50%)' } : { bottom: 0 }),
      height: annotation.subtype === 'strikeout' ? Math.max(1.5 / frame.scale, 1.75) : VECTOR_ANNOTATION_STROKE_WIDTH,
      borderRadius: 1, background: color, opacity: 'opacity' in annotation ? annotation.opacity : VECTOR_ANNOTATION_OPACITY,
    }} /> : null}</div>)}
    {annotation.contents?.trim() ? <button type="button" className={styles.commentBadge}
      data-annotation-comment-id={annotationKey(annotation.ref)} aria-label="Edit annotation comment" title={annotation.contents}
      onPointerDown={(event) => event.stopPropagation()}
      style={{ left: last.x + last.width - annotation.rect.x + 3 / frame.scale, top: last.y - annotation.rect.y,
        transform: `scale(${1 / frame.scale})`, transformOrigin: 'top left' }}>
      <MessageSquareMore size={14} aria-hidden="true" />
    </button> : null}
  </>;
}

function ThemeComment({ annotation }: AnnotationRendererProps) {
  const theme = useStore(viewerThemeStore, (state) => state.theme);
  const rawColor = 'color' in annotation ? annotation.color : null;
  const color = getThemeAnnotationColor(rawColor, theme) ?? rawColor ?? getThemeHighlightPolicy(theme).color;
  return <MessageSquareMore width="100%" height="100%" data-annotation-note-icon={annotationKey(annotation.ref)} fill={color} color="#202020" strokeWidth={1.75} />;
}

function SceneShape({ node }: { node: SceneNode }) {
  const paint = node.paint;
  const props = { fill: paint.fill ?? 'none', stroke: paint.stroke ?? 'none', strokeWidth: paint.width,
    opacity: paint.opacity, strokeDasharray: paint.dash?.join(' '), strokeLinecap: paint.lineCap,
    strokeLinejoin: paint.join, fillRule: paint.fillRule,
    style: { mixBlendMode: paint.blend } as CSSProperties };
  switch (node.kind) {
    case 'rect': return <rect {...node.rect} {...props} />;
    case 'ellipse': return <ellipse cx={node.rect.x + node.rect.width / 2} cy={node.rect.y + node.rect.height / 2} rx={node.rect.width / 2} ry={node.rect.height / 2} {...props} />;
    case 'line': return <line x1={node.a.x} y1={node.a.y} x2={node.b.x} y2={node.b.y} {...props} />;
    case 'poly': return node.closed ? <polygon points={node.points.map((p) => `${p.x},${p.y}`).join(' ')} {...props} /> : <polyline points={node.points.map((p) => `${p.x},${p.y}`).join(' ')} {...props} />;
    case 'path': return <path d={node.d} {...props} />;
    case 'text': case 'textRun': return <text x={node.at.x} y={node.at.y} fontSize={node.fontSize} fontFamily={node.fontFamily} {...props}>{node.text}</text>;
  }
}

/** The v3 portable scene is public and contains only drawing data. Theme
 * copies never enter the editing model or an engine mutation. */
function ThemeGeometry({ annotation, native }: AnnotationRendererProps) {
  const theme = useStore(viewerThemeStore, (state) => state.theme);
  const display = getAnnotationDisplayColors(annotation, theme);
  if (display === annotation && annotation.subtype !== 'free-text') return <>{native}</>;
  const record = fromDTO(display);
  const item = pageItems({ ...initialModel, byId: { [record.id]: record }, order: [record.id] }, annotation.page)[0];
  if (!item) return <>{native}</>;
  return <svg viewBox={`${item.box.x} ${item.box.y} ${item.box.width} ${item.box.height}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}>
    {scene(item).map((node, index) => <SceneShape key={index} node={node} />)}
  </svg>;
}

function ThemeFreeText(props: AnnotationRendererProps) {
  const theme = useStore(viewerThemeStore, (state) => state.theme);
  // The editor always receives the original record. Text fill is a display
  // property, separate from the color declarations the editor serializes.
  const editor = useRichTextEditor(props.annotation);
  const original = props.annotation.subtype === 'free-text' ? props.annotation.richText?.body.color : null;
  const color = getThemeAnnotationColor(original, theme) ?? original ?? undefined;
  return <><ThemeGeometry {...props} /><div data-annotation-text-theme={theme} ref={editor.ref} style={{ ...editor.style, WebkitTextFillColor: color }} /></>;
}

export function AnnotationThemeStyles() {
  const theme = useStore(viewerThemeStore, state => state.theme);
  const selector = `[data-annotation-text-theme="${theme}"]`;
  const rules = [`${selector} [style*="color:"]{-webkit-text-fill-color:currentColor}`];
  for (const source of new Set(Object.values(ANNOTATION_PALETTES).flat())) {
    const rgb = [1, 3, 5].map(offset => parseInt(source.slice(offset, offset + 2), 16)).join(', ');
    const target = getThemeAnnotationColor(source, theme);
    rules.push(`${selector} [style*="color: ${source}"],${selector} [style*="color: rgb(${rgb})"]{-webkit-text-fill-color:${target}}`);
  }
  return <style>{rules.join('')}</style>;
}

export const themeAnnotationRenderers: AnnotationRenderer[] = [
  { id: 'theme-markup', for: (annotation) => ['highlight', 'underline', 'strikeout'].includes(annotation.subtype), component: ThemeMarkup },
  { id: 'theme-comment', for: (annotation) => annotation.subtype === 'text' && !annotation.reply, component: ThemeComment },
  { id: 'theme-free-text', for: (annotation) => annotation.subtype === 'free-text', component: ThemeFreeText },
  { id: 'theme-geometry', for: (annotation) => ['square', 'circle', 'line', 'polyline', 'polygon', 'ink', 'squiggly'].includes(annotation.subtype), component: ThemeGeometry },
];
