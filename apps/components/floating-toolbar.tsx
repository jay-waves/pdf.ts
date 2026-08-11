import type { HTMLAttributes, ReactNode } from 'react';

const SURFACE_CLASS = 'min-h-8.5 w-fit max-w-[calc(100vw-32px)] rounded-lg border border-border bg-surface p-1 max-[640px]:max-w-[calc(100vw-16px)]';

export function FloatingSurface({
  as: Component = 'div',
  className = '',
  ...props
}: HTMLAttributes<HTMLElement> & { as?: 'div' | 'nav' }) {
  return <Component className={`${SURFACE_CLASS} ${className}`.trim()} {...props} />;
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
      className={`flex items-center justify-center gap-1.25 data-[overflow=true]:overflow-x-auto ${className}`.trim()}
      role="toolbar"
      aria-label={label}
      data-overflow={overflow ? 'true' : undefined}
    >
      {children}
    </FloatingSurface>
  );
}

export function FloatingToolbarGroup({ children }: { children: ReactNode }) {
  return <div className="inline-flex min-w-0 items-center gap-0.75">{children}</div>;
}

export function FloatingToolbarDivider() {
  return <div className="h-4.5 w-px flex-none bg-border" aria-hidden="true" />;
}
