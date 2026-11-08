import type { PdfWritePlan, PdfWriteResult, SharedSaveState } from '../renderer/document-save';
export interface ReadingProgress {
  pageNumber: number;
  scrollStrategy?: string;
  spreadMode?: string;
}

export interface PdfFileWriter {
  writeShared?(plan: PdfWritePlan): Promise<PdfWriteResult>;
  save(data: ArrayBuffer): Promise<boolean>;
}

export interface ExternalDocumentChange {
  readonly resource: ManagedResource;
  accept(): void;
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
  observeSharedSave?(state?: SharedSaveState): void;
  prepareWrite(): Promise<PdfFileWriter | null>;
  saveCopy?(data: ArrayBuffer): Promise<string>;
}

export interface ManagedResource {
  readonly draftLocation?: import('../renderer/draft-storage').DraftLocation;
  readonly sharedIdentity?: string | FileSystemFileHandle;
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
  watchForChanges?(listener: (change: ExternalDocumentChange) => void): () => void;
}

export interface ViewerResources {
  readonly wasm: ManagedResource;
  readonly document?: PlatformDocument;
}

export interface ViewerPlatform {
  loadViewerResources(bundledWasmUrl: string): Promise<ViewerResources>;
  openLocalDocument?(file?: File): Promise<PlatformDocument | undefined>;
  openExternal(url: string): void;
  getPreference(key: string): string | null;
  setPreference(key: string, value: string): void;
  readReadingProgress(documentKey: string): Promise<ReadingProgress | undefined>;
  writeReadingProgress(documentKey: string, progress: ReadingProgress): Promise<void>;
  requestAi?(request: AiRequest, signal?: AbortSignal, onText?: (text: string) => void): Promise<string>;
  getAiConfig?(): Promise<AiConfig>;
  setAiConfig?(config: AiConfigUpdate): Promise<void>;
}

export type AiConfig = { model: string; baseUrl: string; apiKeyConfigured: boolean; rememberApiKey: boolean; prompt: string; totalTokens: number };
export type AiConfigUpdate = Partial<Omit<AiConfig, 'apiKeyConfigured' | 'totalTokens'>> & { apiKey?: string; reset?: boolean };

export type AiMessage = { role: 'user' | 'assistant'; content: string };

export type AiRequest = {
  history?: AiMessage[];
  text: string;
  task?: 'translate';
};
