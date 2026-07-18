import { PdfAnnotationName, PdfAnnotationSubtype, type PdfAnnotationObject } from '@embedpdf/models';
import type { AnnotationCapability } from '@embedpdf/plugin-annotation';

const COMMENT_ICON_SIZE = 24;

export function createCommentAnnotation(
  annotation: AnnotationCapability,
  documentId: string,
  target: PdfAnnotationObject,
) {
  const id = crypto.randomUUID();
  const targetRight = target.rect.origin.x + target.rect.size.width;
  const targetBottom = target.rect.origin.y + target.rect.size.height;

  annotation.forDocument(documentId).createAnnotation(target.pageIndex, {
    id,
    type: PdfAnnotationSubtype.TEXT,
    pageIndex: target.pageIndex,
    rect: {
      origin: {
        x: Math.max(0, targetRight - COMMENT_ICON_SIZE),
        y: Math.max(0, targetBottom - COMMENT_ICON_SIZE),
      },
      size: { width: COMMENT_ICON_SIZE, height: COMMENT_ICON_SIZE },
    },
    contents: '',
    name: PdfAnnotationName.Comment,
    strokeColor: '#FFCD45',
    opacity: 1,
    flags: ['print', 'noRotate', 'noZoom'],
    created: new Date(),
  });

  return id;
}
