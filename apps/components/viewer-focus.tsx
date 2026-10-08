import { createContext, useContext, type MouseEvent } from 'react';

/** Shared by viewer controls; dialogs suspend it for their own controls. */
export const ViewerFocusContext = createContext<(() => void) | null>(null);

export function useViewerFocus() {
  return useContext(ViewerFocusContext);
}

/** Attach to control groups, rather than listening for clicks across the page. */
export function useViewerControlClick() {
  const focusViewer = useViewerFocus();
  return (event: MouseEvent<HTMLElement>) => {
    if (event.defaultPrevented || !(event.target instanceof Element)) return;
    if (event.target.closest('[role="dialog"], [role="alertdialog"]')) return;
    const button = event.target.closest('button');
    if (button && button.getAttribute('role') !== 'combobox') focusViewer?.();
  };
}
