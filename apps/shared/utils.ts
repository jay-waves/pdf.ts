export function normalizePdfText(text: string) {
  return text.normalize('NFKC');
}

export function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (
    error
    && typeof error === 'object'
    && 'message' in error
    && typeof error.message === 'string'
  ) {
    return error.message;
  }
  return fallback;
}

export function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.matches('input, textarea, select, [contenteditable="true"]') || target.isContentEditable;
}

export function isViewerNavigationTarget(target: EventTarget | null) {
  if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return false;
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select, button, a[href], [contenteditable], [role="button"], [role="link"], [role="menu"], [role="menuitem"], [role="listbox"], [role="option"], [role="slider"], [role="spinbutton"], [role="checkbox"], [role="switch"], [role="radio"], [role="tab"]')) return false;
  return target === document.body || target === document.documentElement
    || Boolean(target.closest('.viewer, [data-viewer-presentation]'));
}
