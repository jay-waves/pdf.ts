import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';
import { createStore } from 'zustand/vanilla';
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
const { initializeAnnotationPalette, getAnnotationPresetPatch, createCommentAnnotation, createTextMarkupAnnotations } = await import('../apps/annotations/annotations.ts');
const { themeAnnotationRenderers } = await import(rendererUrl.href);
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
      const patch = getAnnotationPresetPatch('highlight', 'color', color);
      assert.equal(patch.color, ANNOTATION_PALETTES.light[index]);
      assert.equal(patch.opacity, 1);
      assert.equal(patch.blendMode, 'multiply');
    });
  }
});

test('initialization and theme changes never read or edit existing annotations', () => {
  const defaults = [];
  const capability = {
    list() { assert.fail('Existing annotations must not be accessed'); },
    tools: {
      list: () => [{ id: 'highlight' }],
      getDefaults: () => ({ color: '#ffcd45', opacity: 1, blendMode: 'multiply' }),
      updateDefaults: (id, patch) => defaults.push({id,patch}),
    },
  };
  initializeAnnotationPalette({ tryCapability: () => capability }, 'doc');
  assert.equal(defaults.length, 1);
  assert.equal(defaults[0].patch.color, ANNOTATION_PALETTES.light[2]);
  globalThis.annotationTestTheme.setState({ theme: 'light' });
  globalThis.annotationTestTheme.setState({ theme: 'dark' });
  assert.equal(defaults.length, 1);
});

test('selection markup uses the native selection operation and clears through its default policy', async () => {
  const calls=[];
  const annotations=[{subtype:'highlight'}];
  const result=await createTextMarkupAnnotations({createFromSelection:async (...args)=>{calls.push(args);return {annotations};}}, {}, 'highlight');
  assert.deepEqual(calls,[['highlight']]);
  assert.equal(result,annotations);
});

test('comment and highlight renderers keep theme reads in React and leave saved appearance unchanged', () => {
  const rect = { x: 0, y: 0, width: 100, height: 20 };
  const ref={kind:'objectNumber',page:{objectNumber:3},objectNumber:8};
  const base = {ref,page:ref.page,rect,reply:null,color:'#ffe066',opacity:1,contents:''};
  const comment=Object.freeze({...base,subtype:'text'});
  const highlight=Object.freeze({...base,subtype:'highlight',quadPoints:[]});
  for (const annotation of [comment,highlight]) {
    const renderer=themeAnnotationRenderers.find(renderer=>renderer.for(annotation));
    const html=renderToStaticMarkup(createElement(renderer.component,{annotation,frame:{scale:1,rotation:0,width:100,height:20}}));
    assert.match(html,/#f0f0f0/);
    assert.equal(annotation.color,'#ffe066');
  }
});

test('nearby notes retain Light PDF colors and do not rewrite the original markup or its comment', async () => {
  const saved=[];
  const ref={kind:'objectNumber',page:{objectNumber:3},objectNumber:8};
  const scope={create:async(page,annotation)=>{saved.push({page,annotation});return {annotation:{...annotation,page,ref}};}};
  const target=Object.freeze({subtype:'highlight',page:{objectNumber:3},contents:'Existing embedded comment',rect:{x:10,y:20,width:200,height:40}});
  const rect={x:135,y:64,width:24,height:24};
  const id=await createCommentAnnotation(scope,target,rect);
  assert.equal(typeof id,'string');
  assert.equal(saved.length,1);
  assert.deepEqual(saved[0].page,target.page);
  assert.equal(saved[0].annotation.subtype,'text');
  assert.deepEqual(saved[0].annotation.rect,rect);
  assert.equal(saved[0].annotation.color,ANNOTATION_PALETTES.light[2]);
  assert.equal(saved[0].annotation.contents,'');
  assert.equal(saved[0].annotation.reply,undefined);
  assert.equal(target.contents,'Existing embedded comment');
});

test('public geometry scene applies theme without changing the saved shape', () => {
  const annotation = Object.freeze({
    subtype: 'square', ref: {kind:'objectNumber',page:{objectNumber:3},objectNumber:9},
    page: {objectNumber:3}, rect: {x:10,y:20,width:100,height:50}, box: {x:10,y:20,width:100,height:50}, rotation:0,
    color:'#ffe066', interiorColor:'#123456', opacity:1, strokeWidth:2,
  });
  const renderer = themeAnnotationRenderers.find(renderer => renderer.for(annotation));
  const html = renderToStaticMarkup(createElement(renderer.component, {annotation,frame:{scale:1,rotation:0,width:100,height:50}}));
  assert.match(html, /#f0f0f0/);
  assert.match(html, /#123456/);
  assert.equal(annotation.color, '#ffe066');
});

test('free-text palette uses the native rich-text body and interior fill fields', () => {
  const text = getAnnotationPresetPatch('freeText', 'textColor', '#f0f0f0');
  assert.deepEqual(text.richText, {body:{color:'#ffe066'}});
  assert.equal('textColor' in text, false);
  const fill = getAnnotationPresetPatch('freeText', 'interiorColor', '#f0f0f0');
  assert.equal(fill.interiorColor, '#ffe066');
});
