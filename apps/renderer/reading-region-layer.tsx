import { useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { useDocumentState } from '@embedpdf/core/react';
import { useAnnotationCapability } from '@embedpdf/plugin-annotation/react';
import { useInteractionManagerCapability } from '@embedpdf/plugin-interaction-manager/react';
import type { Rect, Rotation } from '@embedpdf/models';
import type { ViewerStage } from '../viewer/viewer-stage';
import { EMPTY_STAGE_SNAPSHOT } from '../viewer/viewer-stage';
import { READING_REGION_MODE } from '../shared/reading-region';
import { createReadingRegionHandlers } from './reading-region-input';

const subscribeEmpty = () => () => {};
const getEmptySnapshot = () => EMPTY_STAGE_SNAPSHOT;

function useRegionStage(stage?: ViewerStage | null) {
  return useSyncExternalStore(stage?.subscribe ?? subscribeEmpty, stage?.getSnapshot ?? getEmptySnapshot);
}

export function ReadingRegionLayer({ documentId, pageIndex, stage }: {
  documentId: string; pageIndex: number; stage?: ViewerStage | null;
}) {
  const { selectingRegion } = useRegionStage(stage);
  const document = useDocumentState(documentId);
  const page = document?.document?.pages[pageIndex];
  const scale = document?.scale ?? 1;
  const rotation = ((page?.rotation ?? 0) + (document?.rotation ?? 0)) % 4 as Rotation;
  const { provides: annotations } = useAnnotationCapability();
  const { provides: interaction } = useInteractionManagerCapability();
  const [preview, setPreview] = useState<Rect | null>(null);

  useLayoutEffect(() => {
    const tool = annotations?.getTool('square');
    if (!selectingRegion || !stage || !page || !tool || !interaction) return;
    const handlers = createReadingRegionHandlers(tool, {
      pageIndex, pageSize: page.size, pageRotation: rotation, scale,
      onPreview: setPreview,
      onCommit: (rect) => stage.completeRegionSelection(pageIndex, rect),
    });
    if (!handlers) return;
    const unregister = interaction.registerHandlers({ documentId, pageIndex, modeId: READING_REGION_MODE, handlers });
    return () => { unregister(); setPreview(null); };
  }, [annotations, documentId, interaction, page, pageIndex, rotation, scale, selectingRegion, stage]);

  if (!selectingRegion || !page) return null;
  const rect = preview;
  return rect ? <div className="pdf-reading-region-outline" style={{
    left: rect.origin.x * scale, top: rect.origin.y * scale,
    width: rect.size.width * scale, height: rect.size.height * scale,
  }} /> : null;
}

export function ReadingRegionControls({ stage }: { stage?: ViewerStage | null }) {
  const { selectingRegion } = useRegionStage(stage);
  if (!selectingRegion) return null;
  return <div className="pdf-reading-region-controls pdf-glass-surface" role="region" aria-label="Reading area">
    <span role="status">Draw area</span>
  </div>;
}
