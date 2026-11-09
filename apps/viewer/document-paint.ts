/** Wait for the staged document's visible base rasters, not merely PDF parsing.
 * Hidden staging layers still lay out and paint canvases at their final size. */
export function waitForDocumentPaint(root: HTMLElement, documentId: string, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    let frame = 0;
    let stableFrames = 0;
    const finish = (error?: Error) => {
      cancelAnimationFrame(frame);
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(new DOMException('Document replacement cancelled.', 'AbortError'));
    const timeout = setTimeout(() => finish(new Error('The updated PDF could not be rendered.')), 15_000);
    const check = () => {
      const layer = [...root.querySelectorAll<HTMLElement>('[data-pdf-document-layer]')]
        .find((element) => element.dataset.pdfDocumentLayer === documentId);
      const presentation = layer?.querySelector('[data-viewer-presentation]');
      const container = presentation ?? layer;
      const bounds = root.getBoundingClientRect();
      const pages = container ? [...container.querySelectorAll<HTMLElement>(
        presentation ? '[data-presentation-page]' : '[data-pdf-page-index]',
      )].filter((page) => {
        const rect = page.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.right > bounds.left
          && rect.left < bounds.right && rect.bottom > bounds.top && rect.top < bounds.bottom;
      }) : [];
      const ready = pages.length > 0 && pages.every((page) => {
        const canvas = page.querySelector<HTMLCanvasElement>('.pdf-native-render-layer canvas[data-plane="base"][data-painted="true"]');
        return !!canvas && canvas.width > 0 && canvas.height > 0;
      });
      stableFrames = ready ? stableFrames + 1 : 0;
      if (stableFrames >= 2) finish();
      else frame = requestAnimationFrame(check);
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort(); else frame = requestAnimationFrame(check);
  });
}

export function nextDocumentFrame(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      cancelAnimationFrame(frame);
      signal.removeEventListener('abort', abort);
      reject(new DOMException('Document replacement cancelled.', 'AbortError'));
    };
    const frame = requestAnimationFrame(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
