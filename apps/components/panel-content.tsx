import { forwardRef, type HTMLAttributes } from 'react';

export const PanelContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & {
  overflow?: 'auto' | 'hidden';
  padding?: 'default' | 'compact';
}>(function PanelContent({ overflow = 'auto', padding = 'default', className = '', ...props }, ref) {
  return (
    <div
      ref={ref}
      className={`h-full ${padding === 'compact' ? 'p-2.5' : 'p-3.5 max-[640px]:p-3'} ${overflow === 'hidden' ? 'overflow-hidden' : 'overflow-auto'} ${className}`.trim()}
      {...props}
    />
  );
});

export function PanelState({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`px-0.5 py-1.25 text-[10.5px] leading-3.75 text-muted ${className}`.trim()} {...props} />;
}
