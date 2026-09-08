import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';
import { createStore } from 'zustand/vanilla';
import { PdfAnnotationSubtype, PdfBlendMode } from '@embedpdf/models';
import { ANNOTATION_PALETTES, getAnnotationDisplayColors } from '../apps/annotations/theme-palette.ts';

globalThis.annotationTestTheme = createStore(() => ({ theme: 'dark' }));
globalThis.annotationTestTheme.getInitialState = globalThis.annotationTestTheme.getState;
const rendererUrl = new URL('../apps/annotations/theme-renderers.tsx', import.meta.url);
const rendererCode = await transformWithOxc(readFileSync(rendererUrl, 'utf8'), rendererUrl.pathname, { jsx: { runtime: 'automatic' } });
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '../theme/theme') {
      return {
        url: 'data:text/javascript,export const viewerThemeStore = globalThis.annotationTestTheme; export const isDarkViewerTheme = theme => theme === "dark";',
        shortCircuit: true,
      };
    }
    if (specifier === '../shared/utils' || specifier === './theme-palette' || specifier === './annotations') {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === rendererUrl.href) return { format: 'module', source: rendererCode.code, shortCircuit: true };
    if (url.endsWith('.module.css')) return { format: 'module', source: 'export default { root: "themed-annotation" };', shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { installAnnotationPalette, getAnnotationPresetPatch, createCommentAnnotation, createTextMarkupAnnotations } = await import('../apps/annotations/annotations.ts');
const { themeAnnotationColorRenderer, themeCommentRenderer, themeHighlightRenderer } = await import(rendererUrl.href);
hooks.deregister();

test('theme display copies preserve saved annotation colors and custom colors', () => {
  const saved = Object.freeze({ strokeColor: '#ffe066', fontColor: '#7dd3fc', color: 'transparent', backgroundColor: '#123456', opacity: 0.75 });
  for (const theme of Object.keys(ANNOTATION_PALETTES)) {
    const display = getAnnotationDisplayColors(saved, theme);
    assert.equal(display.strokeColor, ANNOTATION_PALETTES[theme][2]);
    assert.equal(display.fontColor, ANNOTATION_PALETTES[theme][0]);
    assert.equal(display.color, 'transparent');
    assert.equal(display.backgroundColor, '#123456');
    assert.equal(display.opacity, saved.opacity);
  }
  assert.equal(saved.strokeColor, '#ffe066');
  assert.equal(getAnnotationDisplayColors(saved, 'light'), saved);
});

test('selecting a preset in any theme writes the equivalent Light color', () => {
  for (const colors of Object.values(ANNOTATION_PALETTES)) {
    colors.forEach((color, index) => {
      const patch = getAnnotationPresetPatch('highlight', 'strokeColor', color);
      assert.equal(patch.strokeColor, ANNOTATION_PALETTES.light[index]);
      assert.equal(patch.color, ANNOTATION_PALETTES.light[index]);
      assert.equal(patch.opacity, 1);
      assert.equal(patch.blendMode, PdfBlendMode.Multiply);
    });
  }
});

test('initialization and theme changes never read or edit existing annotations', () => {
  const defaults = [];
  const capability = {
    forDocument: () => new Proxy({}, { get() { assert.fail('Existing annotations must not be accessed'); } }),
    getTools: () => [{ id: 'highlight', defaults: { strokeColor: '#ffcd45', opacity: 0.4, blendMode: PdfBlendMode.Normal } }],
    setToolDefaults: (id, patch) => defaults.push({ id, patch }),
  };
  installAnnotationPalette({ getPlugin: () => ({ provides: () => capability }) }, 'doc');
  assert.equal(defaults.length, 1);
  assert.equal(defaults[0].patch.strokeColor, ANNOTATION_PALETTES.light[2]);
  globalThis.annotationTestTheme.setState({ theme: 'light' });
  globalThis.annotationTestTheme.setState({ theme: 'dark' });
  assert.equal(defaults.length, 1);
});

test('comments and selection highlights created in Dark retain Light PDF appearance', () => {
  const annotations = [];
  const scope = { createAnnotation: (_page, annotation) => annotations.push(annotation) };
  const rect = { origin: { x: 10, y: 20 }, size: { width: 100, height: 20 } };
  createCommentAnnotation(scope, { pageIndex: 0, rect });
  createTextMarkupAnnotations(scope, {
    getState: () => ({ slices: {} }),
    getFormattedSelection: () => [{ pageIndex: 0, rect, segmentRects: [rect] }],
    clear() {},
  }, PdfAnnotationSubtype.HIGHLIGHT);
  for (const annotation of annotations) assert.equal(annotation.strokeColor, ANNOTATION_PALETTES.light[2]);
  assert.equal(annotations[1].opacity, 1);
  assert.equal(annotations[1].blendMode, PdfBlendMode.Multiply);
});

test('display renderer maps geometry and text props without replacing edit handlers or saved objects', () => {
  const saved = Object.freeze({ type: PdfAnnotationSubtype.FREETEXT, fontColor: '#ffe066', backgroundColor: 'transparent' });
  const onClick = () => {};
  const seen = [];
  const Child = (props) => { seen.push(props); return createElement('span', null, 'Text'); };
  renderToStaticMarkup(themeAnnotationColorRenderer({
    annotation: saved,
    children: createElement(Child, { annotation: { object: saved }, onClick, appearanceActive: true }),
  }));
  assert.equal(seen[0].annotation.object.fontColor, ANNOTATION_PALETTES.dark[2]);
  assert.equal(seen[0].annotation.object.backgroundColor, 'transparent');
  assert.equal(seen[0].onClick, onClick);
  assert.equal(seen[0].appearanceActive, false);
  assert.equal(saved.fontColor, '#ffe066');

  const square = Object.freeze({ type: PdfAnnotationSubtype.SQUARE, strokeColor: '#7dd3fc', color: '#123456' });
  renderToStaticMarkup(themeAnnotationColorRenderer({ annotation: square, children: createElement(Child, square) }));
  assert.equal(seen[1].strokeColor, ANNOTATION_PALETTES.dark[0]);
  assert.equal(seen[1].color, '#123456');
});

test('comment and highlight callbacks return components whose theme hooks run inside React', () => {
  const rect = { origin: { x: 0, y: 0 }, size: { width: 100, height: 20 } };
  const comment = themeCommentRenderer.render({ currentObject: { strokeColor: '#ffe066', opacity: 1 }, isSelected: false });
  assert.match(renderToStaticMarkup(comment), /#f0f0f0/);
  const highlight = themeHighlightRenderer.render({ currentObject: { strokeColor: '#ffe066', rect, segmentRects: [rect] }, scale: 1 });
  assert.match(renderToStaticMarkup(highlight), /#f0f0f0/);
});
