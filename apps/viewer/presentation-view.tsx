import { useLayoutEffect, useRef, useState } from 'react';
import { usePageList } from '@embedpdf/react/runtime';
import { useStageState } from '@embedpdf/react/stage';
import { PageView } from '@embedpdf/react/page-view';
import { RenderLayer } from '../renderer/viewer-render-layers';
import styles from './presentation-view.module.css';

export function PresentationView({ documentId, pageNumber, onNavigate, onExit }: {
  documentId: string; pageNumber: number;
  onNavigate(delta: -1 | 1): void; onExit(): void;
}) {
  const pages = usePageList();
  const page = pages[pageNumber - 1];
  const viewRotation = useStageState(state => state.viewRotation);
  const endScreen = pageNumber > pages.length;
  const stageRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(stage); return () => observer.disconnect();
  }, []);
  const rotation = ((page?.rotation ?? 0) + viewRotation) % 360;
  const turned = rotation % 180 !== 0;
  const width = (turned ? page?.size.height : page?.size.width) ?? 0;
  const height = (turned ? page?.size.width : page?.size.height) ?? 0;
  const scale = Math.min((size.width - 32) / width, (size.height - 32) / height);
  const ready = page && Number.isFinite(scale) && scale > 0;
  const ownWidth = page?.rotation % 180 !== 0 ? page?.size.height : page?.size.width;
  const ownHeight = page?.rotation % 180 !== 0 ? page?.size.width : page?.size.height;
  return <section className={styles.presentation} data-viewer-presentation aria-label="Presentation mode">
    <div ref={stageRef} className={styles.stage} onClick={endScreen ? onExit : undefined}>
      {ready ? <div className={styles.page} data-presentation-page onClick={() => onNavigate(1)}
        style={{ width: width * scale, height: height * scale, position: 'relative' }}>
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: ownWidth * scale, height: ownHeight * scale,
          transform: `translate(-50%, -50%) rotate(${viewRotation}deg)` }}>
          <PageView documentId={documentId} page={page.ref} width={ownWidth * scale}>
            <RenderLayer tiles={false} />
          </PageView>
        </div>
      </div> : null}
    </div>
  </section>;
}
