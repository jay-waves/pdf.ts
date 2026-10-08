import type { AnnotationTool } from '@embedpdf/plugin-annotation';
import type { Rect, Rotation, Size } from '@embedpdf/models';

/** Reuse Rectangle's drag/capture/clamping, committing a view region instead of an annotation. */
export function createReadingRegionHandlers(tool: AnnotationTool, options: {
  pageIndex: number;
  pageSize: Size;
  pageRotation: Rotation;
  scale: number;
  onPreview(rect: Rect | null): void;
  onCommit(rect: Rect): void;
}) {
  const regionTool = {
    ...tool,
    defaults: { ...tool.defaults, strokeWidth: 0, cloudyBorderIntensity: 0 },
    clickBehavior: { enabled: false, defaultSize: { width: 0, height: 0 } },
  };
  return tool.pointerHandler?.create({
    ...options,
    getTool: () => regionTool,
    getToolContext: () => undefined,
    services: { requestFile: () => {} },
    onPreview: (preview) => options.onPreview(preview?.bounds ?? null),
    onCommit: (annotation) => {
      if (Math.min(annotation.rect.size.width, annotation.rect.size.height) * options.scale >= 5) {
        options.onCommit(annotation.rect);
      }
    },
  });
}
