export interface ReadingProgress {
  pageNumber: number;
  scrollStrategy?: string;
  spreadMode?: string;
}

interface PdfFileWriter {
  save(data: ArrayBuffer): Promise<boolean>;
  /** Save a complete incremental-mode serialization, letting the host strip
   *  the unchanged base bytes before transport. */
  saveIncrementalDocument?(data: ArrayBuffer): Promise<boolean>;
  saveIncremental?(revision: {
    baseSize: number;
    delta: ArrayBuffer;
  }): Promise<boolean>;
}

/**
 * Cross-platform reference to the PDF currently being edited.
 *
 * Browser platforms back this with a FileSystemFileHandle, VS Code backs it
 * with the custom document Uri, and pdf.ts backs it with its daemon session.
 * Preparing the writer is deliberately separate from writing because browser
 * permission prompts must run while the save user gesture is still active.
 */
export interface PdfFileHandle {
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
  | {
    type: 'downloadable';
    downloading: boolean;
    sourceLanguage: string;
    targetLanguage: string;
  };

export interface PlatformLanguageDetectionResult {
  confidence?: number;
  detectedLanguage: string;
}

export type PlatformTranslationAvailability =
  | 'available'
  | 'downloadable'
  | 'downloading'
  | 'unavailable';

export interface PlatformTranslationOptions {
  allowModelDownload?: boolean;
  onDownloadProgress?(progress: number): void;
  signal?: AbortSignal;
  sourceLanguage?: string;
  targetLanguage: string;
}

export interface ViewerPlatform {
  loadViewerResources(bundledWasmUrl: string): Promise<ViewerResources>;
  openLocalDocument?(file?: File): Promise<PlatformDocument | undefined>;
  openExternal(url: string): void;
  detectLanguage(text: string): Promise<PlatformLanguageDetectionResult>;
  getTranslationAvailability(
    sourceLanguage: string,
    targetLanguage: string,
  ): Promise<PlatformTranslationAvailability>;
  translate(text: string, options: PlatformTranslationOptions): Promise<PlatformTranslationResult>;
  getPreference(key: string): string | null;
  setPreference(key: string, value: string): void;
  readReadingProgress(documentKey: string): Promise<ReadingProgress | undefined>;
  writeReadingProgress(documentKey: string, progress: ReadingProgress): Promise<void>;
}
