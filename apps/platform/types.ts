export interface ReadingProgress {
  pageNumber: number;
  scrollStrategy?: string;
  spreadMode?: string;
  updatedAt: string;
}

export interface SavePdfOptions {
  sourceUrl?: string;
  fileName?: string;
}

export interface PdfSaveTarget {
  save(data: ArrayBuffer): Promise<boolean>;
}

export interface ManagedResource {
  readonly url: string;
  release?(): void;
}

export interface PlatformDocument {
  readonly resource: ManagedResource;
  readonly sourceUrl?: string;
  readonly key?: string;
  readonly name?: string;
}

export interface ViewerResources {
  readonly wasm: ManagedResource;
  readonly document?: PlatformDocument;
}

export interface ViewerPlatform {
  loadViewerResources(bundledWasmUrl: string): Promise<ViewerResources>;
  openLocalDocument?(file: File): PlatformDocument;
  openExternal(url: string): void;
  translate?(text: string): Promise<string>;
  getPreference(key: string): string | null;
  setPreference(key: string, value: string): void;
  preparePdfSave(options: SavePdfOptions): Promise<PdfSaveTarget | null>;
  readReadingProgress(documentKey: string): Promise<ReadingProgress | undefined>;
  writeReadingProgress(documentKey: string, progress: ReadingProgress): Promise<void>;
}
