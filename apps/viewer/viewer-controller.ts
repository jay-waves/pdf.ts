import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import type { HistoryCapability } from '@embedpdf/plugin-history';
import type { RotateCapability } from '@embedpdf/plugin-rotate';
import { ScrollStrategy } from '@embedpdf/plugin-scroll';
import { SpreadMode } from '@embedpdf/plugin-spread';
import type { ZoomCapability, ZoomLevel } from '@embedpdf/plugin-zoom';
import { getAnnotationScope } from '../annotations/annotations';
import { EMPTY_PAGE_VIEW, type PageController } from './page-controller';

const subscribeEmptyView = () => () => {};
const getEmptyView = () => EMPTY_PAGE_VIEW;
import { toggleViewerColorMode } from '../theme/theme';
import { getDocumentScope, getPluginCapability } from '../shared/utils';
import { viewerActivity, type ViewerInputSource } from './viewer-activity';

type ViewerDialog = 'print' | 'protect' | 'metadata' | 'signatures' | 'theme' | 'developer';
type ViewerPanel = 'outline' | 'thumbnails' | 'colors';
export type ViewerTranslationRequest = {
  documentId: string;
  anchor: { x: number; y: number };
};

type ViewerSidePanel =
  | { type: ViewerPanel }
  | { type: 'comments'; target: { annotationId: string; isNew: boolean } };

type ViewerOverlay =
  | { type: 'side-panel'; panel: ViewerSidePanel }
  | { type: 'dialog'; dialog: ViewerDialog }
  | { type: 'translation'; request: ViewerTranslationRequest }
  | null;

type ViewerUiState = {
  panMode: boolean;
  searchOpen: boolean;
  overlay: ViewerOverlay;
};

type ViewerUiCommand =
  | { type: 'ui/set-pan'; enabled: boolean }
  | { type: 'ui/set-search'; open: boolean }
  | { type: 'ui/toggle-panel'; panel: Extract<ViewerPanel, 'thumbnails' | 'colors'> }
  | { type: 'ui/open-panel'; panel: ViewerPanel }
  | { type: 'ui/open-comments'; annotationId: string; isNew: boolean }
  | { type: 'ui/open-translation'; documentId: string; anchor: { x: number; y: number } }
  | { type: 'ui/open-dialog'; dialog: ViewerDialog }
  | { type: 'ui/close-overlay' };

type ViewerUiAction = ViewerUiCommand | { type: 'ui/reset' };

export const INITIAL_VIEWER_UI: ViewerUiState = {
  panMode: false,
  searchOpen: false,
  overlay: null,
};

export function reduceViewerUi(state: ViewerUiState, action: ViewerUiAction): ViewerUiState {
  switch (action.type) {
    case 'ui/reset': return INITIAL_VIEWER_UI;
    case 'ui/set-pan': return {
      ...state,
      panMode: action.enabled,
      searchOpen: action.enabled ? false : state.searchOpen,
    };
    case 'ui/set-search': return {
      ...state,
      panMode: action.open ? false : state.panMode,
      searchOpen: action.open,
      overlay: action.open ? null : state.overlay,
    };
    case 'ui/toggle-panel': {
      const current = state.overlay?.type === 'side-panel' ? state.overlay.panel : null;
      return {
        ...state,
        searchOpen: false,
        overlay: current?.type === action.panel
          ? null
          : { type: 'side-panel', panel: { type: action.panel } },
      };
    }
    case 'ui/open-panel': return {
      ...state,
      searchOpen: false,
      overlay: { type: 'side-panel', panel: { type: action.panel } },
    };
    case 'ui/open-comments': return {
      ...state,
      searchOpen: false,
      overlay: {
        type: 'side-panel',
        panel: {
          type: 'comments',
          target: { annotationId: action.annotationId, isNew: action.isNew },
        },
      },
    };
    case 'ui/open-dialog': return {
      ...state,
      searchOpen: false,
      overlay: { type: 'dialog', dialog: action.dialog },
    };
    case 'ui/open-translation': return {
      ...state,
      searchOpen: false,
      overlay: {
        type: 'translation',
        request: { documentId: action.documentId, anchor: action.anchor },
      },
    };
    case 'ui/close-overlay': return { ...state, overlay: null };
  }
}

export type ViewerCommand = ViewerUiCommand
  | { type: 'view/set-presentation'; enabled: boolean }
  | { type: 'navigation/go-to-page'; pageNumber: number }
  | { type: 'navigation/move-pages'; delta: number; source?: ViewerInputSource }
  | { type: 'view/zoom-step'; direction: -1 | 1 }
  | { type: 'view/set-zoom'; level: ZoomLevel }
  | { type: 'view/toggle-spread' }
  | { type: 'view/set-scroll'; strategy: ScrollStrategy }
  | { type: 'view/rotate' }
  | { type: 'annotation/toggle-tool'; toolId: string }
  | { type: 'annotation/clear-tool' }
  | { type: 'annotation/history'; direction: 'undo' | 'redo' }
  | { type: 'theme/toggle' }
  | { type: 'document/save' }
  | { type: 'document/export' };

export type ViewerCommandDispatch = (command: ViewerCommand) => void;

export type ViewerCapabilityFeedback = {
  zoomPercent: number;
  zoomLevel: ZoomLevel;
  activeTool: string | null;
  spreadMode: SpreadMode;
  scrollStrategy: ScrollStrategy;
};

type ViewerControllerDependencies = {
  registry?: PluginRegistry;
  documentId?: string | null;
  pages?: PageController | null;
  updateUi(command: ViewerUiCommand): void;
  saveDocument(): void;
  exportDocument(): void;
};

function executeViewerCommand(
  command: ViewerCommand,
  dependencies: ViewerControllerDependencies,
) {
  const { registry, documentId, updateUi } = dependencies;

  // Presentation accepts navigation and exit; reading-only commands must not
  // change the inactive viewport through global keyboard shortcuts.
  if (dependencies.pages?.getSnapshot().mode === 'presentation'
    && command.type !== 'view/set-presentation'
    && !command.type.startsWith('navigation/')
    && !command.type.startsWith('document/')
    && command.type !== 'theme/toggle') return;

  switch (command.type) {
    case 'ui/set-pan':
      if (command.enabled) {
        getAnnotationScope(registry, documentId)?.scope.setActiveTool(null);
      }
      updateUi(command);
      return;
    case 'ui/set-search':
      if (command.open) {
        getAnnotationScope(registry, documentId)?.scope.setActiveTool(null);
      }
      updateUi(command);
      return;
    case 'ui/toggle-panel':
    case 'ui/open-panel':
    case 'ui/open-comments':
    case 'ui/open-translation':
    case 'ui/open-dialog':
    case 'ui/close-overlay':
      updateUi(command);
      return;
    case 'navigation/go-to-page':
      dependencies.pages?.goToPage(command.pageNumber);
      return;
    case 'navigation/move-pages':
      dependencies.pages?.movePages(command.delta);
      if (command.source) viewerActivity.pulse(command.source, ['Navigation', 'Page']);
      return;
    case 'view/zoom-step': {
      const zoom = getDocumentScope<ZoomCapability>(registry, 'zoom', documentId);
      if (command.direction > 0) zoom?.zoomIn();
      else zoom?.zoomOut();
      return;
    }
    case 'view/set-zoom':
      getDocumentScope<ZoomCapability>(registry, 'zoom', documentId)?.requestZoom(command.level);
      return;
    case 'view/set-presentation':
      if (command.enabled) {
        updateUi({ type: 'ui/close-overlay' });
        updateUi({ type: 'ui/set-search', open: false });
        getAnnotationScope(registry, documentId)?.scope.setActiveTool(null);
      }
      dependencies.pages?.setPresentation(command.enabled);
      return;
    case 'view/toggle-spread':
      dependencies.pages?.toggleSpread();
      return;
    case 'view/set-scroll':
      dependencies.pages?.setStrategy(command.strategy);
      return;
    case 'view/rotate':
      getPluginCapability<RotateCapability>(registry, 'rotate')?.rotateForward();
      return;
    case 'annotation/toggle-tool': {
      const annotation = getAnnotationScope(registry, documentId);
      if (!annotation) return;
      updateUi({ type: 'ui/set-search', open: false });
      updateUi({ type: 'ui/set-pan', enabled: false });
      const current = annotation.scope.getActiveTool()?.id ?? null;
      annotation.scope.setActiveTool(current === command.toolId ? null : command.toolId);
      return;
    }
    case 'annotation/clear-tool':
      getAnnotationScope(registry, documentId)?.scope.setActiveTool(null);
      return;
    case 'annotation/history': {
      const history = getDocumentScope<HistoryCapability>(registry, 'history', documentId);
      if (command.direction === 'undo') history?.undo();
      else history?.redo();
      return;
    }
    case 'theme/toggle':
      toggleViewerColorMode();
      return;
    case 'document/save':
      dependencies.saveDocument();
      return;
    case 'document/export':
      dependencies.exportDocument();
  }
}

function useViewerCapabilityFeedback(
  registry: PluginRegistry | undefined,
  documentId: string | null | undefined,
): Omit<ViewerCapabilityFeedback, 'spreadMode' | 'scrollStrategy'> {
  const [zoomPercent, setZoomPercent] = useState(100);
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>(1);
  const [activeTool, setActiveTool] = useState<string | null>(null);

  useEffect(() => {
    const zoom = getDocumentScope<ZoomCapability>(registry, 'zoom', documentId);
    if (!zoom) {
      setZoomPercent(100);
      setZoomLevel(1);
      return;
    }
    const sync = (state = zoom.getState()) => {
      setZoomPercent(Math.round(state.currentZoomLevel * 100));
      setZoomLevel(state.zoomLevel);
    };
    sync();
    return zoom.onStateChange(sync);
  }, [documentId, registry]);

  useEffect(() => {
    const annotation = getAnnotationScope(registry, documentId);
    if (!annotation) {
      setActiveTool(null);
      return;
    }
    const sync = (tool = annotation.scope.getActiveTool()) => setActiveTool(tool?.id ?? null);
    sync();
    return annotation.scope.onActiveToolChange(sync);
  }, [documentId, registry]);

  return { zoomPercent, zoomLevel, activeTool };
}

export function useViewerController(dependencies: ViewerControllerDependencies) {
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  const dispatch = useCallback<ViewerCommandDispatch>((command) => {
    executeViewerCommand(command, dependenciesRef.current);
  }, []);
  const feedback = useViewerCapabilityFeedback(
    dependencies.registry,
    dependencies.documentId,
  );

  const view = useSyncExternalStore(
    dependencies.pages?.subscribe ?? subscribeEmptyView,
    dependencies.pages?.getSnapshot ?? getEmptyView,
  );
  return { dispatch, view, feedback: { ...feedback, spreadMode: view.spread, scrollStrategy: view.strategy } };
}
