import { ShieldCheck } from 'lucide-react';
import { FormToken } from '@embedpdf/plugin-form';
import { usePage, useSelector, shallowArray } from '@embedpdf/react/runtime';
import styles from './signatures.module.css';

/** Native forms paint existing signature appearances. Keep the viewer's
 * labelled placeholder for a signature that has no appearance in the PDF. */
export function SignatureFallbackLayer() {
  const page = usePage();
  const widgets = useSelector(FormToken, (form) => form.listWidgets(page.ref).filter((item) =>
    item.control === 'signature' && item.annotationRef && !form.getWidget(item.annotationRef)?.hasAppearance,
  ), shallowArray);
  const scale = page.transform.viewScale;
  return <>{widgets.map((item) => <div key={item.annotObjectNumber}
    style={{ position: 'absolute', left: item.box.x * scale, top: item.box.y * scale,
      width: item.box.width * scale, height: item.box.height * scale, pointerEvents: 'none' }}>
    <div className={styles.widget} title="Digital signature appearance unavailable">
      <ShieldCheck aria-hidden="true" /><span>{item.label || 'Digital signature'}</span>
    </div>
  </div>)}</>;
}
