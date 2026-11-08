import { useSyncExternalStore } from 'react';
import { usePage } from '@embedpdf/react/runtime';
import { EMPTY_STAGE_SNAPSHOT, type ViewerStage } from '../viewer/viewer-stage';
const subscribeEmpty = () => () => {};
const getEmptySnapshot = () => EMPTY_STAGE_SNAPSHOT;
function useRegionStage(stage?: ViewerStage | null) {
  return useSyncExternalStore(stage?.subscribe ?? subscribeEmpty, stage?.getSnapshot ?? getEmptySnapshot);
}
export function ReadingRegionLayer({ pageIndex, stage }: {
  documentId: string; pageIndex: number; stage?: ViewerStage | null;
}) {
  const { selectingRegion, regionPreview } = useRegionStage(stage);
  const page = usePage();
  if (!selectingRegion || regionPreview?.pageIndex !== pageIndex) return null;
  const rect = regionPreview.rect;
  const origin = page.transform.toPixels(rect);
  const end = page.transform.toPixels({ x: rect.x + rect.width, y: rect.y + rect.height });
  return <div className="pdf-reading-region-outline" style={{ left: origin.x, top: origin.y, width: end.x - origin.x, height: end.y - origin.y }} />;
}
export function ReadingRegionControls({ stage }: { stage?: ViewerStage | null }) {
  const { selectingRegion } = useRegionStage(stage);
  if (!selectingRegion) return null;
  return <div className="pdf-reading-region-controls pdf-glass-surface" role="region" aria-label="Reading area"><span role="status">Draw area</span></div>;
}
