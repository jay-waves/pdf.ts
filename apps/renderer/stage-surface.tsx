import { useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useGesture } from '@use-gesture/react';
import { useDocumentState } from '@embedpdf/core/react';
import { restorePosition, transformSize, type Position, type Rotation } from '@embedpdf/models';
import { useInteractionManagerCapability } from '@embedpdf/plugin-interaction-manager/react';
import { useSelectionCapability } from '@embedpdf/plugin-selection/react';
import { useScrollCapability } from '@embedpdf/plugin-scroll/react';
import { useViewportCapability, useViewportElement } from '@embedpdf/plugin-viewport/react';
import { useZoomCapability } from '@embedpdf/plugin-zoom/react';
import type { ViewerStage } from '../viewer/viewer-stage';
import {
  createStageInputController,
  type DragInputState,
  type PinchInputState,
  type StageInputController,
} from './stage-input-controller';

/** React binding for the React-free stage input controller. */
export function StageSurface({
  documentId,
  panMode,
  stage,
}: {
  documentId: string;
  panMode: boolean;
  stage?: ViewerStage | null;
}) {
  const { provides: zoom } = useZoomCapability();
  const { provides: scrollCapability } = useScrollCapability();
  const { provides: viewportCapability } = useViewportCapability();
  const { provides: interactionManager } = useInteractionManagerCapability();
  const { provides: selectionCapability } = useSelectionCapability();
  const documentState = useDocumentState(documentId);
  const documentStateRef = useRef(documentState);
  documentStateRef.current = documentState;
  const viewportElementRef = useViewportElement();
  const controllerRef = useRef<StageInputController | null>(null);
  const panModeRef = useRef(panMode);
  panModeRef.current = panMode;

  useGesture({
    onDrag: (state) => {
      if (!(state.event instanceof PointerEvent)) return;
      controllerRef.current?.drag({
        event: state.event,
        first: state.first,
        last: state.last,
        canceled: state.canceled,
        movement: state.movement,
        velocity: state.velocity,
        direction: state.direction,
        cancel: state.cancel,
      } satisfies DragInputState);
    },
    onPinch: (state) => {
      if (!(state.event instanceof PointerEvent)) return;
      controllerRef.current?.pinch({
        event: state.event,
        first: state.first,
        last: state.last,
        canceled: state.canceled,
        movement: state.movement,
        origin: state.origin,
      } satisfies PinchInputState);
    },
  }, {
    target: viewportElementRef ?? undefined,
    eventOptions: { capture: true, passive: false },
    drag: {
      pointer: {
        buttons: [1, 4],
        capture: false,
        keys: false,
      },
    },
    pinch: { pinchOnWheel: false },
  });

  useLayoutEffect(() => {
    const viewport = viewportElementRef?.current;
    if (!viewport || !zoom || !viewportCapability) return;

    const pointOnPage = (clientX: number, clientY: number) => {
      const target = document.elementFromPoint(clientX, clientY);
      const pageElement = target?.closest<HTMLElement>('[data-pdf-page-index]');
      if (!pageElement || !viewport.contains(pageElement)) return null;
      const pageIndex = Number(pageElement.dataset.pdfPageIndex);
      const currentDocument = documentStateRef.current;
      const page = currentDocument?.document?.pages[pageIndex];
      if (!page || !Number.isInteger(pageIndex)) return null;
      const rotation = ((page.rotation + currentDocument.rotation) % 4) as Rotation;
      const scale = currentDocument.scale;
      const bounds = pageElement.getBoundingClientRect();
      const displaySize = transformSize(page.size, 0 as Rotation, scale);
      const rotatedSize = transformSize(displaySize, rotation, 1);
      const point: Position = restorePosition(
        rotatedSize,
        { x: clientX - bounds.left, y: clientY - bounds.top },
        rotation,
        scale,
      );
      return { pageIndex, point };
    };
    const selectionScope = selectionCapability?.forDocument(documentId);

    const controller = createStageInputController({
      documentId,
      viewport,
      zoom,
      viewportCapability,
      scrollCapability,
      interactionManager,
      stage,
      selection: selectionScope ? {
        begin(clientX, clientY) {
          const location = pointOnPage(clientX, clientY);
          return location
            ? selectionScope.beginLongPressSelection(location.pageIndex, location.point)
            : false;
        },
        update(clientX, clientY) {
          const location = pointOnPage(clientX, clientY);
          if (location) selectionScope.updateLongPressSelection(location.pageIndex, location.point);
        },
        end() {
          selectionScope.endLongPressSelection();
        },
      } : null,
      isPanMode: () => panModeRef.current,
      commitZoom: (apply) => flushSync(apply),
    });
    controllerRef.current = controller;
    return () => {
      if (controllerRef.current === controller) controllerRef.current = null;
      controller.dispose();
    };
  }, [
    documentId,
    interactionManager,
    scrollCapability,
    selectionCapability,
    stage,
    viewportCapability,
    viewportElementRef,
    zoom,
  ]);

  return null;
}
