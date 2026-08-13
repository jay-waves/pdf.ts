import type { ComponentProps } from 'react';
import { Dialog } from './components';
import styles from './document-dialogs.module.css';

export function DocumentDialog(props: ComponentProps<typeof Dialog>) {
  return (
    <Dialog
      {...props}
      variant="popup"
      titleVariant="popup"
      contentClassName={styles.flatDialog}
      overlayClassName={styles.flatOverlay}
    />
  );
}
