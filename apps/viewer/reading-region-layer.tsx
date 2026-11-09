import { useCallback, useSyncExternalStore } from 'react';
import { usePage } from '@embedpdf/react/runtime';
import { EMPTY_STAGE_SNAPSHOT, type ViewerStage } from './viewer-stage';
const subscribeEmpty = () => () => {};
const getEmptySnapshot = () => EMPTY_STAGE_SNAPSHOT.selectingRegion;
function useRegionStage(stage?: ViewerStage | null) {
  return useSyncExternalStore(stage?.subscribe ?? subscribeEmpty, stage ? () => stage.getSnapshot().selectingRegion : getEmptySnapshot);
}
export function ReadingRegionLayer({ pageIndex, stage }: {
  documentId: string; pageIndex: number; stage?: ViewerStage | null;
}) {
  const getPreview = useCallback(() => {
    const preview = stage?.getRegionPreview();
    return preview?.pageIndex === pageIndex ? preview : null;
  }, [stage, pageIndex]);
  const regionPreview = useSyncExternalStore(stage?.subscribeRegionPreview ?? subscribeEmpty, getPreview);
  const page = usePage();
  if (!regionPreview) return null;
  const rect = regionPreview.rect;
  const origin = page.transform.toPixels(rect);
  const end = page.transform.toPixels({ x: rect.x + rect.width, y: rect.y + rect.height });
  return <div className="pdf-reading-region-outline" style={{ left: origin.x, top: origin.y, width: end.x - origin.x, height: end.y - origin.y }} />;
}
export function ReadingRegionControls({ stage }: { stage?: ViewerStage | null }) {
  const selectingRegion = useRegionStage(stage);
  if (!selectingRegion) return null;
  return <div className="pdf-reading-region-controls pdf-glass-surface" role="region" aria-label="Reading area"><span role="status">Draw area</span></div>;
}
