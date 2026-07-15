import type { ReactNode } from 'react';
import { Dialog as RadixDialog } from 'radix-ui';

export function Dialog({
  open,
  onClose,
  preventClose = false,
  title,
  children,
  contentClassName,
  titleClassName = 'shnctl-visually-hidden',
}: {
  open: boolean;
  onClose(): void;
  preventClose?: boolean;
  title: ReactNode;
  children: ReactNode;
  contentClassName: string;
  titleClassName?: string;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen && !preventClose) onClose();
    }}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="shnctl-overlay" />
        <RadixDialog.Content className={contentClassName} aria-describedby={undefined}>
          <RadixDialog.Title className={titleClassName}>{title}</RadixDialog.Title>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export const DialogClose = RadixDialog.Close;
