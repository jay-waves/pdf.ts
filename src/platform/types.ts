export interface ReadingProgress {
  pageNumber: number;
  scrollStrategy?: string;
  spreadMode?: string;
  updatedAt: string;
}

export interface ViewerPlatform {
  readonly capabilities: {
    readonly translation: boolean;
  };
  getInitialDocumentUrl(): string | undefined;
  getDocumentKey(): string | undefined;
  getPdfiumWasmUrl(bundledUrl: string): string;
  prepareResourceUrl(url: string, contentType: string): Promise<string>;
  getPreference(key: string): string | null;
  setPreference(key: string, value: string): void;
  readReadingProgress(documentKey: string): Promise<ReadingProgress | undefined>;
  writeReadingProgress(documentKey: string, progress: ReadingProgress): Promise<void>;
}
