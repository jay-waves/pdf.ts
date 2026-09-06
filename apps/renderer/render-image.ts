import { PdfErrorCode, type PdfTask } from '@embedpdf/models';

/** Own one render task and its URL; stale completions never reach the view. */
export function renderImage(
  start: () => PdfTask<Blob> | null,
  onReady: (url: string, release: () => void) => void,
  onError: (error: unknown) => void,
) {
  let active = true;
  let settled = false;
  let url: string | undefined;
  let task: PdfTask<Blob> | null = null;
  const release = () => {
    if (url) URL.revokeObjectURL(url);
    url = undefined;
  };

  try {
    task = start();
    task?.wait((blob) => {
      settled = true;
      if (!active) return;
      try {
        url = URL.createObjectURL(blob);
        onReady(url, release);
      } catch (error) {
        release();
        onError(error);
      }
    }, (failure) => {
      settled = true;
      if (active && failure.reason.code !== PdfErrorCode.Cancelled) onError(failure.reason);
    });
  } catch (error) {
    onError(error);
  }

  return () => {
    active = false;
    release();
    if (!settled) task?.abort({ code: PdfErrorCode.Cancelled, message: 'Render image changed' });
  };
}
