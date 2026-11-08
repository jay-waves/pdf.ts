import { createSHA256 } from 'hash-wasm';

/** Hash a file without another full-file ArrayBuffer in the renderer. */
export async function fingerprintFile(file: Blob) {
  const hash = await createSHA256();
  const reader = file.stream().getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      hash.update(value);
    }
    return hash.digest();
  } finally { reader.releaseLock(); }
}
