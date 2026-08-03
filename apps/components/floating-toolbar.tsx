import type { ReactNode } from 'react';
import styles from './floating-toolbar.module.css';

export function FloatingToolbar({
  label,
  children,
  overflow = false,
  className = '',
}: {
  label: string;
  children: ReactNode;
  overflow?: boolean;
  className?: string;
}) {
  return (
    <div
      className={[styles.root, className].filter(Boolean).join(' ')}
      role="toolbar"
      aria-label={label}
      data-overflow={overflow ? 'true' : undefined}
    >
      {children}
    </div>
  );
}

export function FloatingToolbarGroup({ children }: { children: ReactNode }) {
  return <div className={styles.group}>{children}</div>;
}

export function FloatingToolbarDivider() {
  return <div className={styles.divider} aria-hidden="true" />;
}
