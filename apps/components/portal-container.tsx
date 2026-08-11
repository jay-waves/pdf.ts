import { createContext, useContext, type ReactNode } from 'react';

const PortalContainerContext = createContext<HTMLElement | null>(null);

export function PortalProvider({
  container,
  children,
}: {
  container: HTMLElement | null;
  children: ReactNode;
}) {
  return (
    <PortalContainerContext.Provider value={container}>
      {children}
    </PortalContainerContext.Provider>
  );
}

export function usePortalContainer() {
  return useContext(PortalContainerContext);
}
