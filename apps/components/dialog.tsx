import type { HTMLAttributes, ReactNode } from 'react';
import { Dialog as RadixDialog } from 'radix-ui';

type DialogVariant = 'panel' | 'panelCompact' | 'popup' | 'popupWide';
type DialogTitleVariant = 'hidden' | 'panel' | 'popup';

const VARIANT_CLASSES: Record<DialogVariant, string> = {
  panel: 'h-[min(720px,calc(100vh-42px))] w-[min(720px,calc(100vw-42px))] max-[640px]:h-[min(640px,calc(100vh-22px))] max-[640px]:w-[calc(100vw-22px)]',
  panelCompact: 'w-[min(332px,calc(100vw-42px))]',
  popup: 'w-[min(360px,calc(100vw-32px))]',
  popupWide: 'w-[min(520px,calc(100vw-32px))]',
};

const TITLE_VARIANT_CLASSES: Record<DialogTitleVariant, string> = {
  hidden: 'sr-only',
  panel: 'm-0 border-b border-border-subtle bg-transparent px-3.5 py-3 text-xs font-semibold',
  popup: "relative m-0 bg-transparent px-3.5 py-3 text-xs font-semibold text-foreground after:absolute after:inset-x-4.5 after:bottom-0 after:h-px after:bg-[color-mix(in_srgb,var(--pdf-foreground-primary)_14%,transparent)] after:content-['']",
};

export function Dialog({
  open,
  onClose,
  preventClose = false,
  title,
  children,
  contentClassName = '',
  overlayClassName = '',
  variant = 'panel',
  titleVariant = 'hidden',
}: {
  open: boolean;
  onClose(): void;
  preventClose?: boolean;
  title: ReactNode;
  children: ReactNode;
  contentClassName?: string;
  overlayClassName?: string;
  variant?: DialogVariant;
  titleVariant?: DialogTitleVariant;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen && !preventClose) onClose();
    }}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={`pdf-dialog-overlay fixed inset-0 z-20 ${overlayClassName}`} />
        <RadixDialog.Content
          className={`pdf-mica-surface pdf-dialog-content fixed top-1/2 left-1/2 z-21 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border ${VARIANT_CLASSES[variant]} ${contentClassName}`.trim()}
          aria-describedby={undefined}
        >
          <RadixDialog.Title className={TITLE_VARIANT_CLASSES[titleVariant]}>{title}</RadixDialog.Title>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export function DialogActions({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`flex justify-end gap-1.5 ${className}`.trim()} {...props} />;
}
