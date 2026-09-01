import { useEffect, useState, type FormEvent } from 'react';
import { getEffectivePermission, type PluginRegistry } from '@embedpdf/core';
import { PdfPermissionFlag } from '@embedpdf/models';
import { Check } from 'lucide-react';
import { RadioGroup as RadixRadioGroup } from 'radix-ui';
import { Button, DialogActions } from '../components';
import { getDocument } from './viewer-document';
import styles from './document-dialogs.module.css';
import { DocumentDialog } from './document-dialog-shared';
import { getErrorMessage } from '../shared/utils';

type PrintMode = 'all' | 'current' | 'custom';

const PRINT_MODE_OPTIONS = [
  { value: 'all', label: 'All pages' },
  { value: 'current', label: 'Current page' },
  { value: 'custom', label: 'Pages' },
] as const;

const PRINT_OPTION_CLASS = [
  'grid min-h-8.25 w-full cursor-pointer',
  'grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2',
  'border-0 border-b border-border bg-transparent px-2 py-1.25',
  'text-left text-inherit outline-none last:border-b-0',
  'transition-[background-color,box-shadow] duration-150 ease-control',
  'hover:bg-hover data-[state=checked]:bg-selected',
  'focus-visible:relative focus-visible:z-1',
  'focus-visible:shadow-[inset_0_0_0_1px_var(--pdf-accent-primary)]',
  'motion-reduce:transition-none',
].join(' ');

function validatePageRange(value: string, totalPages: number) {
  const compact = value.replace(/\s+/g, '');
  if (!compact || !/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(compact)) return null;

  for (const part of compact.split(',')) {
    const [startValue, endValue = startValue] = part.split('-');
    const start = Number(startValue);
    const end = Number(endValue);
    if (start < 1 || end < start || end > totalPages) return null;
  }
  return compact;
}

function openBrowserPrintDialog(data: ArrayBuffer) {
  return new Promise<void>((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
    const iframe = document.createElement('iframe');
    iframe.title = 'Print Document';
    iframe.hidden = true;
    let cleanupTimer = 0;

    const cleanup = () => {
      if (cleanupTimer) window.clearTimeout(cleanupTimer);
      iframe.remove();
      URL.revokeObjectURL(url);
    };

    iframe.onerror = () => {
      cleanup();
      reject(new Error('The browser could not load the print document.'));
    };
    iframe.onload = () => {
      if (iframe.src !== url) return;
      const printWindow = iframe.contentWindow;
      if (!printWindow) {
        cleanup();
        reject(new Error('The browser did not provide a print window.'));
        return;
      }

      printWindow.addEventListener('afterprint', cleanup, { once: true });
      cleanupTimer = window.setTimeout(cleanup, 60_000);
      try {
        printWindow.focus();
        printWindow.print();
        resolve();
      } catch (error) {
        cleanup();
        reject(error);
      }
    };

    document.body.append(iframe);
    iframe.src = url;
  });
}

async function printDocument(
  registry: PluginRegistry | undefined,
  documentId: string | null | undefined,
  pageRange?: string,
) {
  const document = getDocument(registry, documentId);
  const engine = registry?.getEngine();
  if (!registry || !documentId || !document || !engine) {
    throw new Error('Printing is not available.');
  }
  if (!getEffectivePermission(
    registry.getStore().getState().core,
    documentId,
    PdfPermissionFlag.Print,
  )) {
    throw new Error('This document does not allow printing.');
  }

  const data = await engine.preparePrintDocument(document, {
    pageRange,
    includeAnnotations: true,
  }).toPromise();
  await openBrowserPrintDialog(data);
}

export function PrintDialog({ registry, documentId, open, currentPageNumber, totalPages, onClose }: {
  registry?: PluginRegistry;
  documentId?: string | null;
  open: boolean;
  currentPageNumber: number;
  totalPages: number;
  onClose(): void;
}) {
  const [mode, setMode] = useState<PrintMode>('all');
  const [pageRange, setPageRange] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode('all');
    setPageRange('');
    setError('');
    setBusy(false);
  }, [open]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    let selectedRange: string | undefined;
    if (mode === 'current') selectedRange = String(currentPageNumber);
    if (mode === 'custom') {
      selectedRange = validatePageRange(pageRange, totalPages) ?? undefined;
      if (!selectedRange) {
        setError(`Enter pages between 1 and ${totalPages}, for example 1,3,5-7.`);
        return;
      }
    }

    setBusy(true);
    setError('');
    try {
      await printDocument(registry, documentId, selectedRange);
      onClose();
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Failed to prepare the document for printing.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DocumentDialog open={open} onClose={onClose} preventClose={busy} title="Print">
      <form className={styles.form} onSubmit={submit}>
        <RadixRadioGroup.Root
          className={styles.optionGroup}
          value={mode}
          onValueChange={(value) => {
            if (value === 'all' || value === 'current' || value === 'custom') setMode(value);
          }}
          aria-label="Pages to print"
        >
          {PRINT_MODE_OPTIONS.map((option) => (
            <RadixRadioGroup.Item
              key={option.value}
              value={option.value}
              className={PRINT_OPTION_CLASS}
            >
              <span className="grid size-4 shrink-0 place-items-center rounded border border-border-strong bg-input">
                <RadixRadioGroup.Indicator className="grid size-full place-items-center text-accent">
                  <Check size={11} strokeWidth={3} />
                </RadixRadioGroup.Indicator>
              </span>
              <span>{option.label}</span>
              {option.value === 'current' ? (
                <small className="text-muted tabular-nums">{currentPageNumber}</small>
              ) : null}
            </RadixRadioGroup.Item>
          ))}
        </RadixRadioGroup.Root>
        {mode === 'custom' ? (
          <label className={styles.field}>
            <span>Page range</span>
            <input
              className={styles.input}
              value={pageRange}
              placeholder="1,3,5-7"
              autoFocus
              onChange={(event) => setPageRange(event.currentTarget.value)}
            />
          </label>
        ) : null}
        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        <DialogActions className={styles.flatActions}>
          <Button appearance="flat" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button
            appearance="flat"
            type="submit"
            variant="primary"
            disabled={busy}
          >
            {busy ? 'Preparing...' : 'Print'}
          </Button>
        </DialogActions>
      </form>
    </DocumentDialog>
  );
}
