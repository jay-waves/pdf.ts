import { useEffect, type RefObject } from 'react';
import { useOptionalCapability } from '@embedpdf/react/runtime';
import { InteractionToken } from '@embedpdf/plugin-interaction';
import { SelectionToken } from '@embedpdf/plugin-selection';
import { AnnotationToken } from '@embedpdf/plugin-annotation';
import { viewerControls } from '../components/control-visibility';
import { useStage } from '@embedpdf/react/stage';
import type { ViewerStage } from './viewer-stage';
import { installStageWheelZoom, installStageWheelScroll } from '../renderer/stage-input-controller';

/** App wheel policy and touch control visibility; Stage owns PDF gestures. */
export function StageSurface({ stage, containerRef }: {
  stage?: ViewerStage | null;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  const native = useStage();
  const interaction = useOptionalCapability(InteractionToken);
  const selection = useOptionalCapability(SelectionToken);
  const annotations = useOptionalCapability(AnnotationToken);
  useEffect(() => {
    const viewport = containerRef.current?.querySelector<HTMLElement>('.viewer');
    if (!viewport) return;
    const disposeZoom = installStageWheelZoom(viewport, native, stage);
    const disposeScroll = installStageWheelScroll(viewport, native);
    let touch: { id: number; x: number; y: number; time: number; moved: boolean } | null = null;
    const down = (event: PointerEvent) => {
      touch = null;
      if (event.pointerType !== 'touch' || !event.isPrimary) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, button, [contenteditable="true"]')) return;
      if (interaction && !['pointer', 'pan'].includes(interaction.getActiveToolId())) return;
      const bounds = viewport.getBoundingClientRect();
      const hit = native.getPageAt({ x: event.clientX - bounds.left - viewport.clientLeft, y: event.clientY - bounds.top - viewport.clientTop });
      if (hit && annotations?.getAt(hit.ref, hit.point)) return;
      touch = { id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now(), moved: false };
    };
    const move = (event: PointerEvent) => {
      if (touch?.id !== event.pointerId || touch.moved) return;
      if (Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > 8) {
        touch.moved = true; viewerControls.hide();
      }
    };
    const up = (event: PointerEvent) => {
      if (touch?.id !== event.pointerId) return;
      if (!touch.moved && performance.now() - touch.time < 300 && !selection?.hasSelection()) viewerControls.toggle();
      touch = null;
    };
    const cancel = () => { touch = null; };
    viewport.addEventListener('pointerdown', down, { capture: true });
    window.addEventListener('pointermove', move, { capture: true });
    window.addEventListener('pointerup', up, { capture: true });
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    return () => {
      disposeScroll(); disposeZoom();
      viewport.removeEventListener('pointerdown', down, { capture: true });
      window.removeEventListener('pointermove', move, { capture: true });
      window.removeEventListener('pointerup', up, { capture: true });
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
    };
  }, [containerRef, native, stage, interaction, selection, annotations]);
  return null;
}
