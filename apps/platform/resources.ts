import type { ManagedResource } from './types';

export function blobResource(blob: Blob): ManagedResource {
  const url = URL.createObjectURL(blob);
  let released = false;

  return {
    url,
    openStream: () => blob.stream(),
    release() {
      if (released) return;
      released = true;
      URL.revokeObjectURL(url);
    },
  };
}
