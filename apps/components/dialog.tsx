import type { HTMLAttributes, ReactNode } from 'react';
import { Dialog as RadixDialog } from 'radix-ui';

export function Dialog({
  open,
  onClose,
  preventClose = false,
  title,
  children,
  contentClassName = '',
  overlayClassName = 'bg-black/50',
  variant = 'panel',
  titleClassName = 'sr-only',
}: {
  open: boolean;
  onClose(): void;
  preventClose?: boolean;
  title: ReactNode;
  children: ReactNode;
  contentClassName?: string;
  overlayClassName?: string;
  variant?: 'panel' | 'panelCompact' | 'popup' | 'popupWide';
  titleClassName?: string;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen && !preventClose) onClose();
    }}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={`fixed inset-0 z-20 ${overlayClassName}`} />
        <RadixDialog.Content
          className={[
            'fixed top-1/2 left-1/2 z-21 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-md border border-border bg-surface',
            variant === 'panel' ? 'h-[min(720px,calc(100vh-42px))] w-[min(720px,calc(100vw-42px))] shadow-dialog max-[640px]:h-[min(640px,calc(100vh-22px))] max-[640px]:w-[calc(100vw-22px)]' : '',
            variant === 'panelCompact' ? 'w-[min(332px,calc(100vw-42px))] shadow-dialog' : '',
            variant === 'popup' ? 'w-[min(360px,calc(100vw-32px))] shadow-popup' : '',
            variant === 'popupWide' ? 'w-[min(520px,calc(100vw-32px))] shadow-popup' : '',
            contentClassName,
          ].join(' ')}
          aria-describedby={undefined}
        >
          <RadixDialog.Title className={titleClassName}>{title}</RadixDialog.Title>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export function DialogActions({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`flex justify-end gap-1.5 ${className}`.trim()} {...props} />;
}
