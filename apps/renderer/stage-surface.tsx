import { useLayoutEffect, type RefObject } from 'react';
import { useStage } from '@embedpdf/react/stage';
import type { ViewerStage } from '../viewer/viewer-stage';
import { installStageWheelZoom } from './stage-input-controller';

/** Only application-specific wheel policy remains above the native v3 surface. */
export function StageSurface({ stage, containerRef }: {
  documentId: string;
  stage?: ViewerStage | null;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  const native = useStage();
  useLayoutEffect(() => {
    const viewport = containerRef.current?.querySelector<HTMLElement>('.viewer');
    return viewport ? installStageWheelZoom(viewport, native, stage) : undefined;
  }, [containerRef, native, stage]);
  return null;
}
