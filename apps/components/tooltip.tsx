import type { ReactElement, ReactNode } from 'react';
import { Tooltip as RadixTooltip } from 'radix-ui';

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={520} skipDelayDuration={120} disableHoverableContent>
      {children}
    </RadixTooltip.Provider>
  );
}

export function Tooltip({
  content,
  children,
}: {
  content: ReactNode;
  children: ReactElement;
}) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content className="shnctl-tooltip" side="bottom" sideOffset={8} collisionPadding={8}>
          {content}
          <RadixTooltip.Arrow className="shnctl-tooltip-arrow" width={7} height={4} />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
