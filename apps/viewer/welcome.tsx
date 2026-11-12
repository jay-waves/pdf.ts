import { useState } from 'react';
import styles from './viewer.module.css';

export function Welcome({
  onOpen,
}: {
  onOpen(file?: File): Promise<void>;
}) {
  const [dragging, setDragging] = useState(false);
  const [selectionError, setSelectionError] = useState('');

  const openDocument = async (file?: File) => {
    try {
      await onOpen(file);
      setSelectionError('');
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setSelectionError(error instanceof Error ? error.message : 'Unable to open PDF.');
      }
    }
  };

  return (
    <main className={styles.welcome}>
      <section
        aria-label="Choose or drop a PDF file"
        className={`ui-glass ${styles.welcomeCard}`}
        data-dragging={dragging ? 'true' : undefined}
        onClick={() => void openDocument()}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          const nextTarget = event.relatedTarget;
          if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
            setDragging(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragging(false);
          void openDocument(event.dataTransfer.files[0]);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          void openDocument();
        }}
        role="button"
        tabIndex={0}
      >
        <img className="size-13.5" src="./logo.png" alt="" />
        <h1 className="mt-4.5 mb-0 text-[25px]">PDF.ts</h1>
        <p className="mt-3 mb-0 text-[13px] font-semibold text-muted">
          Click to choose or drop a PDF
        </p>
        {selectionError ? (
          <p className="mt-3 mb-0 text-xs text-danger" role="alert">
            {selectionError}
          </p>
        ) : null}
      </section>
    </main>
  );
}
