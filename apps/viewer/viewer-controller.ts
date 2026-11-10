import { useCallback, useReducer, useRef, useSyncExternalStore } from 'react';
import type { Kernel } from '@embedpdf/core';
import { HistoryToken } from '@embedpdf/plugin-history';
import { StageToken } from '@embedpdf/plugin-stage';
import { ScrollStrategy } from './viewer-stage';
import type { ZoomLevel } from './viewer-stage';
import { getAnnotationScope } from '../annotations/annotations';
import { EMPTY_STAGE_SNAPSHOT, type ViewerStage } from './viewer-stage';

const subscribeEmptyView = () => () => {};
const getEmptyView = () => EMPTY_STAGE_SNAPSHOT;
import { toggleViewerColorMode } from '../theme/theme';

type ViewerDialog = 'print' | 'protect' | 'signatures' | 'theme' | 'developer';
type ViewerPanel = 'outline' | 'thumbnails' | 'colors' | 'comments';
export type ToolbarSection = 'document' | 'page' | 'search' | 'draw';
export type ViewerTranslationRequest = {
  mode?: 'translate' | 'llm';
  documentId: string;
  anchor: { x: number; y: number };
};

type ViewerSidePanel = { type: ViewerPanel };

type ViewerOverlay =
  | { type: 'side-panel'; panel: ViewerSidePanel }
  | { type: 'dialog'; dialog: ViewerDialog }
  | { type: 'translation'; request: ViewerTranslationRequest }
  | { type: 'comment-editor'; annotationId: string; pointerX?: number }
  | null;

type ViewerUiState = {
  panMode: boolean;
  toolbarSection: ToolbarSection | null;
  overlay: ViewerOverlay;
};

type ViewerUiCommand =
  | { type: 'ui/reset' }
  | { type: 'ui/set-pan'; enabled: boolean }
  | { type: 'ui/set-toolbar-section'; section: ToolbarSection | null }
  | { type: 'ui/toggle-panel'; panel: Extract<ViewerPanel, 'thumbnails' | 'colors'> }
  | { type: 'ui/open-panel'; panel: ViewerPanel }
  | { type: 'ui/open-comments'; annotationId: string; pointerX?: number }
  | ({ type: 'ui/open-translation' } & ViewerTranslationRequest)
  | { type: 'ui/open-dialog'; dialog: ViewerDialog }
  | { type: 'ui/close-overlay' };

const INITIAL_VIEWER_UI: ViewerUiState = {
  panMode: false,
  toolbarSection: null,
  overlay: null,
};

function reduceViewerUi(state: ViewerUiState, action: ViewerUiCommand): ViewerUiState {
  switch (action.type) {
    case 'ui/reset': return INITIAL_VIEWER_UI;
    case 'ui/set-pan': return {
      ...state,
      panMode: action.enabled,
      toolbarSection: action.enabled && state.toolbarSection === 'search'
        ? null
        : state.toolbarSection,
    };
    case 'ui/set-toolbar-section': return {
      ...state,
      panMode: action.section === 'search' ? false : state.panMode,
      toolbarSection: action.section,
      overlay: action.section === 'search' ? null : state.overlay,
    };
    case 'ui/toggle-panel': {
      const current = state.overlay?.type === 'side-panel' ? state.overlay.panel : null;
      return {
        ...state,
        toolbarSection: state.toolbarSection === 'search' ? null : state.toolbarSection,
        overlay: current?.type === action.panel
          ? null
          : { type: 'side-panel', panel: { type: action.panel } },
      };
    }
    case 'ui/open-panel': return {
      ...state,
      toolbarSection: state.toolbarSection === 'search' ? null : state.toolbarSection,
      overlay: { type: 'side-panel', panel: { type: action.panel } },
    };
    case 'ui/open-comments': return {
      ...state,
      toolbarSection: state.toolbarSection === 'search' ? null : state.toolbarSection,
      overlay: {
        type: 'comment-editor',
        annotationId: action.annotationId,
        pointerX: action.pointerX,
      },
    };
    case 'ui/open-dialog': return {
      ...state,
      toolbarSection: state.toolbarSection === 'search' ? null : state.toolbarSection,
      overlay: { type: 'dialog', dialog: action.dialog },
    };
    case 'ui/open-translation': return {
      ...state,
      toolbarSection: state.toolbarSection === 'search' ? null : state.toolbarSection,
      overlay: {
        type: 'translation',
        request: { documentId: action.documentId, anchor: action.anchor, mode: action.mode },
      },
    };
    case 'ui/close-overlay': return { ...state, overlay: null };
  }
}

export type ViewerCommand = ViewerUiCommand
  | { type: 'view/set-presentation'; enabled: boolean }
  | { type: 'navigation/go-to-page'; pageNumber: number }
  | { type: 'navigation/move-pages'; delta: number }
  | { type: 'view/zoom-step'; direction: -1 | 1 }
  | { type: 'view/set-zoom'; level: ZoomLevel }
  | { type: 'view/select-reading-region' }
  | { type: 'view/cancel-reading-region' }
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

type ViewerControllerDependencies = {
  registry?: Kernel;
  documentId?: string | null;
  stage?: ViewerStage | null;
  saveDocument(): void;
  exportDocument(): void;
};

type ViewerCommandContext = ViewerControllerDependencies & {
  updateUi(command: ViewerUiCommand): void;
};

function executeViewerCommand(
  command: ViewerCommand,
  dependencies: ViewerCommandContext,
) {
  const { registry, documentId, updateUi } = dependencies;

  // Presentation accepts navigation and exit; reading-only commands must not
  // change the inactive viewport through global keyboard shortcuts.
  if (dependencies.stage?.getSnapshot().mode === 'presentation'
    && command.type !== 'view/set-presentation'
    && command.type !== 'ui/reset'
    && !command.type.startsWith('navigation/')
    && !command.type.startsWith('document/')
    && command.type !== 'theme/toggle') return;

  switch (command.type) {
    case 'ui/reset':
      updateUi(command);
      return;
    case 'ui/set-pan': {
      const interaction = getAnnotationScope(registry, documentId)?.interaction;
      if (command.enabled) interaction?.activateTool('pan');
      else interaction?.activateDefaultTool();
      updateUi(command);
      return;
    }
    case 'ui/set-toolbar-section':
      if (command.section === 'search') {
        getAnnotationScope(registry, documentId)?.interaction?.activateDefaultTool();
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
      dependencies.stage?.goToPage(command.pageNumber);
      return;
    case 'navigation/move-pages':
      dependencies.stage?.movePages(command.delta);
      return;
    case 'view/zoom-step': {
      if (dependencies.stage) {
        dependencies.stage.stepZoom(command.direction);
        return;
      }
      const zoom = documentId ? registry?.tryCapability(StageToken, documentId) : null;
      if (command.direction > 0) zoom?.zoomIn();
      else zoom?.zoomOut();
      return;
    }
    case 'view/set-zoom':
      if (dependencies.stage) dependencies.stage.setZoom(command.level);
      else if (documentId) registry?.tryCapability(StageToken, documentId)?.zoomTo(typeof command.level === 'number' ? command.level : { mode: command.level });
      return;
    case 'view/select-reading-region':
      updateUi({ type: 'ui/set-pan', enabled: false });
      updateUi({ type: 'ui/close-overlay' });
      dependencies.stage?.beginRegionSelection();
      return;
    case 'view/cancel-reading-region':
      dependencies.stage?.cancelRegionSelection();
      return;
    case 'view/set-presentation':
      if (command.enabled) {
        updateUi({ type: 'ui/set-pan', enabled: false });
        updateUi({ type: 'ui/close-overlay' });
        updateUi({ type: 'ui/set-toolbar-section', section: null });
        getAnnotationScope(registry, documentId)?.interaction?.activateDefaultTool();
      }
      dependencies.stage?.setPresentation(command.enabled);
      return;
    case 'view/toggle-spread':
      dependencies.stage?.toggleSpread();
      return;
    case 'view/set-scroll':
      dependencies.stage?.setStrategy(command.strategy);
      return;
    case 'view/rotate':
      if (dependencies.stage) dependencies.stage.rotate();
      else if (documentId) registry?.tryCapability(StageToken, documentId)?.rotateViewBy(90);
      return;
    case 'annotation/toggle-tool': {
      const annotation = getAnnotationScope(registry, documentId);
      if (!annotation) return;
      updateUi({ type: 'ui/set-toolbar-section', section: null });
      updateUi({ type: 'ui/set-pan', enabled: false });
      const current = annotation.interaction?.getActiveToolId();
      if (current === command.toolId) annotation.interaction?.activateDefaultTool();
      else annotation.interaction?.activateTool(command.toolId);
      return;
    }
    case 'annotation/clear-tool':
      updateUi({ type: 'ui/set-pan', enabled: false });
      getAnnotationScope(registry, documentId)?.interaction?.activateDefaultTool();
      return;
    case 'annotation/history': {
      const history = documentId ? registry?.tryCapability(HistoryToken, documentId) : null;
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

export function useViewerController(dependencies: ViewerControllerDependencies) {
  const [uiSnapshot, updateUi] = useReducer(reduceViewerUi, INITIAL_VIEWER_UI);
  const dependenciesRef = useRef<ViewerCommandContext>({ ...dependencies, updateUi });
  dependenciesRef.current = { ...dependencies, updateUi };
  const dispatch = useCallback<ViewerCommandDispatch>((command) => {
    executeViewerCommand(command, dependenciesRef.current);
  }, []);
  const stageSnapshot = useSyncExternalStore(
    dependencies.stage?.subscribe ?? subscribeEmptyView,
    dependencies.stage?.getSnapshot ?? getEmptyView,
  );
  return {
    dispatch,
    uiSnapshot,
    stageSnapshot,
  };
}
