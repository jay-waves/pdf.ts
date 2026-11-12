import type { HTMLAttributes } from 'react';
import { Slot } from 'radix-ui';

export function SettingsCard({ asChild = false, className = '', ...props }: HTMLAttributes<HTMLElement> & { asChild?: boolean }) {
  const Component = asChild ? Slot.Root : 'section';
  return <Component
    className={`grid gap-[var(--settings-card-gap,0.75rem)] rounded-lg border border-border-subtle bg-section p-4 [box-shadow:var(--pdf-section-shadow)] ${className}`.trim()}
    {...props}
  />;
}
