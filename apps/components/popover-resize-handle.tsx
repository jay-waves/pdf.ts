import { useRef } from 'react';
import styles from './popover-resize-handle.module.css';

/** A single bottom-right handle; pointer capture keeps dragging outside the panel. */
export function PopoverResizeHandle() {
  const drag = useRef<{ x: number; y: number; width: number; height: number; panel: HTMLElement } | null>(null);
  return <div className={styles.handle} aria-hidden="true" title="Drag to resize"
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      const panel = event.currentTarget.parentElement;
      if (!panel) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = panel.getBoundingClientRect();
      drag.current = { x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, panel };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={(event) => {
      const start = drag.current;
      if (!start) return;
      const rect = start.panel.getBoundingClientRect();
      const maxWidth = Math.max(0, window.innerWidth - rect.left - 8);
      const maxHeight = Math.max(0, window.innerHeight - rect.top - 8);
      start.panel.style.width = `${Math.min(maxWidth, Math.max(240, start.width + event.clientX - start.x))}px`;
      start.panel.style.height = `${Math.min(maxHeight, Math.max(140, start.height + event.clientY - start.y))}px`;
    }}
    onPointerUp={(event) => {
      drag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={() => { drag.current = null; }}
    onLostPointerCapture={() => { drag.current = null; }}
  />;
}
