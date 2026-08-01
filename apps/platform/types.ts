export interface ReadingProgress {
  pageNumber: number;
  scrollStrategy?: string;
  spreadMode?: string;
  updatedAt: string;
}

export interface PdfFileWriter {
  save(data: ArrayBuffer): Promise<boolean>;
  saveIncremental?(revision: {
    baseSize: number;
    delta: ArrayBuffer;
  }): Promise<boolean>;
}

/**
 * Cross-platform reference to the PDF currently being edited.
 *
 * Browser platforms back this with a FileSystemFileHandle, VS Code backs it
 * with the custom document Uri, and docflow backs it with its daemon session.
 * Preparing the writer is deliberately separate from writing because browser
 * permission prompts must run while the save user gesture is still active.
 */
export interface PdfFileHandle {
  readonly name?: string;
  prepareWrite(): Promise<PdfFileWriter | null>;
}

export interface ManagedResource {
  readonly url: string;
  /** Opens the original bytes without materializing another full ArrayBuffer. */
  openStream?(): ReadableStream<Uint8Array>;
  release?(): void;
}

export interface PlatformDocument {
  readonly resource: ManagedResource;
  readonly key?: string;
  readonly name?: string;
  readonly fileHandle: PdfFileHandle;
}

export interface ViewerResources {
  readonly wasm: ManagedResource;
  readonly document?: PlatformDocument;
}

export type PlatformTranslationResult =
  | { type: 'inline'; text: string }
  | { type: 'external'; url: string };

export interface ViewerPlatform {
  loadViewerResources(bundledWasmUrl: string): Promise<ViewerResources>;
  openLocalDocument?(file: File): PlatformDocument;
  pickLocalDocument?(): Promise<PlatformDocument | undefined>;
  requestDocumentSave?(): void;
  onDocumentSaveRequested?(
    handler: (preserveDirty: boolean) => Promise<boolean>,
  ): () => void;
  setDocumentDirty?(dirty: boolean): void;
  openExternal(url: string): void;
  translate(text: string): Promise<PlatformTranslationResult>;
  getPreference(key: string): string | null;
  setPreference(key: string, value: string): void;
  readReadingProgress(documentKey: string): Promise<ReadingProgress | undefined>;
  writeReadingProgress(documentKey: string, progress: ReadingProgress): Promise<void>;
}
