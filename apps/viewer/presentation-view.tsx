import { useLayoutEffect, useRef, useState } from 'react';
import { useDocumentState } from '@embedpdf/core/react';
import { Rotate } from '@embedpdf/plugin-rotate/react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { RasterLayer } from '../renderer/viewer-render-layers';
import styles from './presentation-view.module.css';

export function PresentationView({
  documentId,
  pageNumber,
  totalPages,
  renderDpr,
  onNavigate,
  onExit,
}: {
  documentId: string;
  pageNumber: number;
  totalPages: number;
  renderDpr: number;
  onNavigate(delta: -1 | 1): void;
  onExit(): void;
}) {
  const documentState = useDocumentState(documentId);
  const page = documentState?.document?.pages[pageNumber - 1];
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
    (stageSize.width - 48) / rotatedWidth,
    (stageSize.height - 128) / rotatedHeight,
  );
  const ready = page && Number.isFinite(scale) && scale > 0;

  return (
    <section className={styles.presentation} aria-label="Presentation mode">
      <div ref={stageRef} className={styles.stage}>
        {ready ? (
          <div
            className={styles.page}
            style={{ width: rotatedWidth * scale, height: rotatedHeight * scale }}
          >
            <Rotate documentId={documentId} pageIndex={pageNumber - 1} scale={scale}>
              <div style={{ width: pageWidth * scale, height: pageHeight * scale }}>
                <RasterLayer
                  documentId={documentId}
                  pageIndex={pageNumber - 1}
                  scale={scale}
                  dpr={renderDpr}
                  draggable={false}
                />
              </div>
            </Rotate>
          </div>
        ) : null}
      </div>
      <nav className={styles.controls} aria-label="Presentation controls">
        <button type="button" aria-label="Previous page" disabled={pageNumber <= 1} onClick={() => onNavigate(-1)}>
          <ChevronLeft size={18} />
        </button>
        <span className={styles.counter}>{pageNumber} / {totalPages}</span>
        <button type="button" aria-label="Next page" disabled={pageNumber >= totalPages} onClick={() => onNavigate(1)}>
          <ChevronRight size={18} />
        </button>
        <span className={styles.divider} />
        <button type="button" aria-label="Exit presentation" onClick={onExit}>
          <X size={17} />
        </button>
      </nav>
    </section>
  );
}
