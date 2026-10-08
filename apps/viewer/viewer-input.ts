import type { ViewerCommand, ViewerCommandDispatch } from './viewer-controller';
import type { ViewerStage } from './viewer-stage';
import { isEditableTarget, isViewerNavigationTarget } from '../shared/utils';
import { installMousePageGesture } from './mouse-page-gesture';

export function installViewerCommandKeys(dispatch: ViewerCommandDispatch) {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || (!event.ctrlKey && !event.metaKey)) return;
    if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;

    const key = event.key.toLowerCase();
    let command: ViewerCommand | null = null;
    if (!event.shiftKey && key === 'f') {
      command = { type: 'ui/set-toolbar-section', section: 'search' };
    } else if (!event.shiftKey && key === 's') {
      command = { type: 'document/save' };
    } else if (!isEditableTarget(event.target)) {
      if (key === 'y' || (key === 'z' && event.shiftKey)) {
        command = { type: 'annotation/history', direction: 'redo' };
      } else if (key === 'z') {
        command = { type: 'annotation/history', direction: 'undo' };
      }
    }
    if (!command) return;

    event.preventDefault();
    event.stopPropagation();
    dispatch(command);
  };

  window.addEventListener('keydown', onKeyDown, { capture: true });
  return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
}

export function installStageNavigationInput(stage: ViewerStage, dispatch: ViewerCommandDispatch) {
  const navigate = (delta: number, source: 'Keyboard' | 'Mouse') => {
    dispatch({ type: 'navigation/move-pages', delta, source });
  };
  const mouseGesture = installMousePageGesture(
    (target) => !stage.getSnapshot().selectingRegion
      && isViewerNavigationTarget(target)
      && target instanceof Element
      && Boolean(target.closest('.viewer, [data-viewer-presentation]')),
    (delta) => {
      navigate(delta, 'Mouse');
      stage.focusViewportAfterAction();
    },
  );
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Escape' && mouseGesture.cancel()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === 'Escape' && stage.getSnapshot().selectingRegion
      && !document.querySelector('[role="dialog"], [role="alertdialog"]')) {
      event.preventDefault();
      event.stopPropagation();
      dispatch({ type: 'view/cancel-reading-region' });
      return;
    }
    if (!isViewerNavigationTarget(event.target)) return;
    const presenting = stage.getSnapshot().mode === 'presentation';
    if (presenting && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dispatch({ type: 'view/set-presentation', enabled: false });
      return;
    }
    if (event.shiftKey && (!presenting || event.key !== ' ')) return;
    const key = event.key === 'h' ? 'ArrowLeft' : event.key === 'j' ? 'ArrowDown'
      : event.key === 'k' ? 'ArrowUp' : event.key === 'l' ? 'ArrowRight' : event.key;
    if (!presenting && (event.key === 'j' || event.key === 'k')) {
      event.preventDefault();
      event.stopPropagation();
      stage.scrollVertically(key === 'ArrowDown' ? 40 : -40);
      return;
    }
    if (!presenting && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(key)) {
      stage.cancelPendingNavigation();
    }
    const delta = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1
      : presenting && (key === 'PageUp' || key === 'ArrowUp') ? -1
      : presenting && (key === 'PageDown' || key === 'ArrowDown') ? 1
      : presenting && key === ' ' ? (event.shiftKey ? -1 : 1) : null;
    if (delta === null) return;
    event.preventDefault();
    event.stopPropagation();
    navigate(delta, 'Keyboard');
  };
  const stopSideButtonEvent = (event: MouseEvent | PointerEvent) => {
    if (!isViewerNavigationTarget(event.target)) return;
    if (event.button !== 3 && event.button !== 4) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onSideButtonUp = (event: MouseEvent) => {
    if (!isViewerNavigationTarget(event.target)) return;
    if (event.button !== 3 && event.button !== 4) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    navigate(event.button === 3 ? -1 : 1, 'Mouse');
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!isViewerNavigationTarget(event.target) || !(event.buttons & 24)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  window.addEventListener('keydown', onKeyDown, { capture: true });
  window.addEventListener('mousedown', stopSideButtonEvent, { capture: true });
  window.addEventListener('mouseup', onSideButtonUp, { capture: true });
  window.addEventListener('pointermove', onPointerMove, { capture: true });
  window.addEventListener('auxclick', stopSideButtonEvent, { capture: true });
  return () => {
    mouseGesture.dispose();
    window.removeEventListener('keydown', onKeyDown, { capture: true });
    window.removeEventListener('mousedown', stopSideButtonEvent, { capture: true });
    window.removeEventListener('mouseup', onSideButtonUp, { capture: true });
    window.removeEventListener('pointermove', onPointerMove, { capture: true });
    window.removeEventListener('auxclick', stopSideButtonEvent, { capture: true });
  };
}
