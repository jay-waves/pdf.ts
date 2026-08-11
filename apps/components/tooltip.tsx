import type { ReactElement, ReactNode } from 'react';
import { Tooltip as RadixTooltip } from 'radix-ui';
import { usePortalContainer } from './portal-container';

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
  const portalContainer = usePortalContainer();
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal container={portalContainer ?? undefined}>
        <RadixTooltip.Content
          className="pointer-events-none relative z-[2147483647] max-w-45 whitespace-nowrap rounded-md border border-border bg-foreground px-1.75 py-1 text-center text-[10px] leading-3.5 font-normal text-surface shadow-float"
          side="bottom"
          sideOffset={8}
          collisionPadding={8}
        >
          {content}
          <RadixTooltip.Arrow className="fill-foreground" width={7} height={4} />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
