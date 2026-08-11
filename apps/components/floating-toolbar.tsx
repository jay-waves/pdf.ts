import type { HTMLAttributes, ReactNode } from 'react';
import styles from './floating-toolbar.module.css';

export function FloatingSurface({
  as: Component = 'div',
  className = '',
  ...props
}: HTMLAttributes<HTMLElement> & { as?: 'div' | 'nav' }) {
  return <Component className={`${styles.surface} ${className}`.trim()} {...props} />;
}

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
    <FloatingSurface
      className={`${styles.toolbar} ${className}`.trim()}
      role="toolbar"
      aria-label={label}
      data-overflow={overflow ? 'true' : undefined}
    >
      {children}
    </FloatingSurface>
  );
}

export function FloatingToolbarGroup({ children }: { children: ReactNode }) {
  return <div className={styles.group}>{children}</div>;
}

export function FloatingToolbarDivider() {
  return <div className={styles.divider} aria-hidden="true" />;
}
