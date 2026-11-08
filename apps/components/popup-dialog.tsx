/**
 * Common popup chrome and form styling for feature dialogs. Keep feature-specific
 * layout (such as theme previews) beside the feature, not in reusable components.
 */
import type { ComponentProps } from 'react';
import { Dialog } from './dialog';
import styles from './popup-dialog.module.css';

export function PopupDialog({ contentClassName = '', ...props }: ComponentProps<typeof Dialog>) {
  return (
    <Dialog
      {...props}
      variant="popup"
      titleVariant="popup"
      contentClassName={`${styles.flatDialog} ${contentClassName}`.trim()}
      overlayClassName={styles.flatOverlay}
    />
  );
}
