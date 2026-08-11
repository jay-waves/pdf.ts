import type { ComponentProps } from 'react';
import { Dialog } from './components';
import styles from './document-dialogs.module.css';

export function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (
    error
    && typeof error === 'object'
    && 'message' in error
    && typeof error.message === 'string'
  ) {
    return error.message;
  }
  return fallback;
}

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
