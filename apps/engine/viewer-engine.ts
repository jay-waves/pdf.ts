import { localEngine } from '@embedpdf/engine';
import { interactionPlugin } from '@embedpdf/plugin-interaction';
import { metadataPlugin } from '@embedpdf/plugin-metadata';
import { renderPlugin } from '@embedpdf/plugin-render';
import { searchPlugin } from '@embedpdf/plugin-search';
import { selectionPlugin } from '@embedpdf/plugin-selection';
import { stagePlugin } from '@embedpdf/plugin-stage';

export const createViewerEngine = () => localEngine({ encoderWorker: false });

export const viewerPlugins = [
  interactionPlugin(),
  stagePlugin({
    flow: 'continuous',
    layout: 'vertical',
    spread: 'none',
    padding: 20,
    gap: { px: 12 },
    zoom: { mode: 'fit-page' },
  }),
  selectionPlugin(),
  searchPlugin(),
  metadataPlugin(),
  renderPlugin(),
];
