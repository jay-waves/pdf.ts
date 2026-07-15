import type { ReactElement, ReactNode } from 'react';
import { DropdownMenu as RadixDropdownMenu } from 'radix-ui';

export function DropdownMenu({
  trigger,
  children,
  open,
  onOpenChange,
  className = 'shnctl-toolbar-menu',
  align = 'start',
}: {
  trigger: ReactElement;
  children: ReactNode;
  open?: boolean;
  onOpenChange?(open: boolean): void;
  className?: string;
  align?: 'start' | 'center' | 'end';
}) {
  return (
    <RadixDropdownMenu.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <RadixDropdownMenu.Trigger asChild>{trigger}</RadixDropdownMenu.Trigger>
      <RadixDropdownMenu.Portal>
        <RadixDropdownMenu.Content
          className={className}
          align={align}
          sideOffset={5}
          collisionPadding={6}
        >
          {children}
        </RadixDropdownMenu.Content>
      </RadixDropdownMenu.Portal>
    </RadixDropdownMenu.Root>
  );
}

export function DropdownMenuItem({
  children,
  className,
  disabled,
  onSelect,
}: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onSelect(): void;
}) {
  return (
    <RadixDropdownMenu.Item asChild disabled={disabled} onSelect={onSelect}>
      <button type="button" className={className} disabled={disabled}>{children}</button>
    </RadixDropdownMenu.Item>
  );
}
