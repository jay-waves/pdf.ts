import {
  PDF_FORM_FIELD_TYPE,
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
  type PdfWidgetAnnoObject,
} from '@embedpdf/models';
import { createRenderer } from '@embedpdf/plugin-annotation/react';
import { ShieldCheck } from 'lucide-react';

function isSignatureWidget(annotation: PdfAnnotationObject): annotation is PdfWidgetAnnoObject {
  return annotation.type === PdfAnnotationSubtype.WIDGET
    && annotation.field?.type === PDF_FORM_FIELD_TYPE.SIGNATURE;
}

export const signatureWidgetRenderer = createRenderer<PdfWidgetAnnoObject>({
  id: 'signatureWidget',
  matches: isSignatureWidget,
  useAppearanceStream: true,
  interactionDefaults: {
    isDraggable: false,
    isResizable: false,
    isRotatable: false,
  },
  render: ({ currentObject, appearanceActive }) => (
    <div
      className="shnctl-signature-widget"
      data-appearance-active={appearanceActive ? 'true' : undefined}
      title={appearanceActive ? 'Digital signature' : 'Digital signature appearance unavailable'}
    >
      {!appearanceActive ? (
        <>
          <ShieldCheck aria-hidden="true" />
          <span>{currentObject.field?.name || 'Digital signature'}</span>
        </>
      ) : null}
    </div>
  ),
});
