// Chrome is the default platform for TypeScript and the existing build. The
// VS Code Vite build aliases this module to platform/vscode.ts.
export { documentEditingEnabled, platform } from './platform/chrome';
export type { ReadingProgress, ViewerPlatform } from './platform/types';
