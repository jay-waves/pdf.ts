import type { AriaRole, ReactNode } from 'react';
import { Popover } from 'radix-ui';

export function FloatingPopover({
  onClose,
  anchor,
  className,
  label,
  role,
  align = 'start',
  sideOffset = 0,
  children,
}: {
  onClose(): void;
  anchor: { x: number; y: number };
  className: string;
  label: string;
  role?: AriaRole;
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  children: ReactNode;
}) {
  return (
    <Popover.Root open onOpenChange={(nextOpen) => !nextOpen && onClose()} modal={false}>
      <Popover.Anchor asChild>
        <span className="shnctl-floating-anchor" style={{ left: anchor.x, top: anchor.y }} />
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          className={className}
          side="bottom"
          align={align}
          sideOffset={sideOffset}
          collisionPadding={8}
          aria-label={label}
          role={role}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
