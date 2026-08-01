import type { HTMLAttributes } from 'react';

export function DialogActions({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`flex justify-end gap-1.5 ${className}`.trim()} {...props} />;
}
