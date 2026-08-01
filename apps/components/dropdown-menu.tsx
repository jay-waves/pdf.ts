import type { ReactElement, ReactNode } from 'react';
import { DropdownMenu as RadixDropdownMenu } from 'radix-ui';

export function DropdownMenu({
  trigger,
  children,
  open,
  onOpenChange,
  align = 'start',
}: {
  trigger: ReactElement;
  children: ReactNode;
  open?: boolean;
  onOpenChange?(open: boolean): void;
  align?: 'start' | 'center' | 'end';
}) {
  return (
    <RadixDropdownMenu.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <RadixDropdownMenu.Trigger asChild>{trigger}</RadixDropdownMenu.Trigger>
      <RadixDropdownMenu.Portal>
        <RadixDropdownMenu.Content
          className="relative z-40 grid min-w-26 gap-0.5 rounded-md border border-border bg-toolbar-secondary p-1 shadow-popover"
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
  active,
  disabled,
  onSelect,
}: {
  children: ReactNode;
  className?: string;
  active?: boolean;
  disabled?: boolean;
  onSelect(): void;
}) {
  return (
    <RadixDropdownMenu.Item asChild disabled={disabled} onSelect={onSelect}>
      <button
        type="button"
        className={[
          'flex h-6.5 w-full cursor-pointer items-center gap-1.75 rounded-md',
          'border border-transparent bg-transparent px-2 text-left text-inherit',
          'transition-[border-color,box-shadow,color] duration-150 ease-control motion-reduce:transition-none',
          'hover:border-accent hover:shadow-control focus-visible:border-accent focus-visible:shadow-control focus-visible:outline-none',
          'disabled:cursor-default disabled:opacity-46',
          'data-[active=true]:border-accent data-[active=true]:text-accent data-[active=true]:shadow-control',
          className ?? '',
        ].join(' ')}
        disabled={disabled}
        data-active={active ? 'true' : undefined}
      >
        {children}
      </button>
    </RadixDropdownMenu.Item>
  );
}
