// The VS Code viewer is intentionally read-only. These exports replace the
// editing-only EmbedPDF React packages at bundle time so their implementations
// are not shipped in the VS Code extension.
export const AnnotationLayer = () => null;
export const AnnotationPluginPackage = {};
export const FormPluginPackage = {};
export const HistoryPluginPackage = {};
export const ExportPluginPackage = {};
export const LockModeType = { Include: 'include' } as const;
