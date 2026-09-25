import { useLayoutEffect, useRef, useState } from 'react';
import { useDocumentState } from '@embedpdf/core/react';
import { Rotate } from '@embedpdf/plugin-rotate/react';
import { RenderLayer } from '../renderer/viewer-render-layers';
import styles from './presentation-view.module.css';

export function PresentationView({
  documentId,
  pageNumber,
  renderDpr,
  onNavigate,
  onExit,
}: {
  documentId: string;
  pageNumber: number;
  renderDpr: number;
  onNavigate(delta: -1 | 1, source: 'Mouse'): void;
  onExit(): void;
}) {
  const documentState = useDocumentState(documentId);
  const page = documentState?.document?.pages[pageNumber - 1];
  const endScreen = pageNumber > (documentState?.document?.pageCount ?? 0);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => {
      setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const rotation = ((page?.rotation ?? 0) + (documentState?.rotation ?? 0)) % 4;
  const rotated = rotation % 2 === 1;
  const pageWidth = page?.size.width ?? 0;
  const pageHeight = page?.size.height ?? 0;
  const rotatedWidth = rotated ? pageHeight : pageWidth;
  const rotatedHeight = rotated ? pageWidth : pageHeight;
  const scale = Math.min(
    (stageSize.width - 32) / rotatedWidth,
    (stageSize.height - 32) / rotatedHeight,
  );
  const ready = page && Number.isFinite(scale) && scale > 0;
  const handlePageClick = () => onNavigate(1, 'Mouse');

  return (
    <section className={styles.presentation} data-viewer-presentation aria-label="Presentation mode">
      <div ref={stageRef} className={styles.stage} onClick={endScreen ? onExit : undefined}>
        {ready ? (
          <div
            className={styles.page}
            data-presentation-page
            onClick={handlePageClick}
            style={{ width: rotatedWidth * scale, height: rotatedHeight * scale }}
          >
            <Rotate documentId={documentId} pageIndex={pageNumber - 1} scale={scale}>
              <div style={{ width: pageWidth * scale, height: pageHeight * scale }}>
                <RenderLayer
                  documentId={documentId}
                  pageIndex={pageNumber - 1}
                  dpr={renderDpr}
                  baseScale={scale}
                  tiles={false}
                />
              </div>
            </Rotate>
          </div>
        ) : null}
      </div>
    </section>
  );
}
