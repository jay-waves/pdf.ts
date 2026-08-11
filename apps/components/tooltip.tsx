import type { ReactElement, ReactNode } from 'react';
import { Tooltip as RadixTooltip } from 'radix-ui';
import { usePortalContainer } from './portal-container';
import styles from './tooltip.module.css';

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
          className={styles.content}
          side="bottom"
          sideOffset={8}
          collisionPadding={8}
        >
          {content}
          <RadixTooltip.Arrow className={styles.arrow} width={7} height={4} />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
