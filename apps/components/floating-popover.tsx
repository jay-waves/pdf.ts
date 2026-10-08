import type { AriaRole, ReactNode } from 'react';
import { Popover } from 'radix-ui';
import { useViewerControlClick, useViewerFocus } from './viewer-focus';

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
  const focusViewer = useViewerFocus();
  const onControlClick = useViewerControlClick();
  return (
    <Popover.Root open onOpenChange={(nextOpen) => !nextOpen && onClose()} modal={false}>
      <Popover.Anchor asChild>
        <span className="pointer-events-none fixed size-0" style={{ left: anchor.x, top: anchor.y }} />
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
          onClick={role === 'toolbar' ? onControlClick : undefined}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={focusViewer ? (event) => {
            event.preventDefault();
            focusViewer();
          } : undefined}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
