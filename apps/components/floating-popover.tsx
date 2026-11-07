import { useEffect, useState, type AriaRole, type ReactNode } from 'react';
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
  dismissOnFocusOutside = true,
  stableSide = false,
  children,
}: {
  onClose(): void;
  anchor: { x: number; y: number; height?: number };
  className: string;
  label: string;
  role?: AriaRole;
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  dismissOnFocusOutside?: boolean;
  stableSide?: boolean;
  children: ReactNode;
}) {
  const focusViewer = useViewerFocus();
  const onControlClick = useViewerControlClick();
  const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight);
  useEffect(() => {
    if (!stableSide) return;
    const onResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [stableSide]);
  const spaceBelow = Math.max(0, viewportHeight - anchor.y - (anchor.height ?? 0) - sideOffset - 9);
  const spaceAbove = Math.max(0, anchor.y - sideOffset - 9);
  // Choose from anchor geometry, not content height, so streaming cannot flip the panel.
  const side = stableSide && spaceBelow < 200 && spaceAbove > spaceBelow ? 'top' : 'bottom';
  return (
    <Popover.Root open onOpenChange={(nextOpen) => !nextOpen && onClose()} modal={false}>
      <Popover.Anchor asChild>
        <span className="pointer-events-none fixed size-0" style={{ left: anchor.x, top: anchor.y, height: anchor.height }} />
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          className={className}
          side={side}
          style={stableSide ? { maxHeight: side === 'top' ? spaceAbove : spaceBelow } : undefined}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={8}
          aria-label={label}
          role={role}
          onClick={role === 'toolbar' ? onControlClick : undefined}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onFocusOutside={dismissOnFocusOutside ? undefined : (event) => event.preventDefault()}
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
