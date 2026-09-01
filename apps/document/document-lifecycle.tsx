import { useState, type ReactNode } from 'react';
import {
  DocumentGate,
  DocumentScope,
  useDocumentId,
  useDocumentStatus,
  useDocuments,
} from '@embedpdf/react';

export const VIEWER_STATUS_CLASS = 'grid size-full place-items-center bg-app text-xs text-secondary';

export function LoadingStatus({ label }: { label: string }) {
  return (
    <div className={VIEWER_STATUS_CLASS} role="status" aria-live="polite">
      {label}
    </div>
  );
}

function PasswordPrompt() {
  const documentId = useDocumentId();
  const { unlock } = useDocuments();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!documentId) return <LoadingStatus label="No PDF document." />;

  return (
    <form
      className="pdf-v3-password"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        void unlock(documentId, { password })
          .catch(() => setError('Incorrect password.'))
          .finally(() => setBusy(false));
      }}
    >
      <strong>Password required</strong>
      <input
        autoFocus
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <button type="submit" disabled={busy || !password}>
        {busy ? 'Opening…' : 'Open PDF'}
      </button>
      {error ? <span className="text-danger">{error}</span> : null}
    </form>
  );
}

function DocumentFallback() {
  const status = useDocumentStatus();
  if (status === 'locked') return <PasswordPrompt />;
  if (status === 'error') {
    return <div className={`${VIEWER_STATUS_CLASS} text-danger`}>Unable to open PDF.</div>;
  }
  return <LoadingStatus label="Opening PDF document…" />;
}

export function DocumentLifecycle({ children }: { children: ReactNode }) {
  const { docs, activeId } = useDocuments();
  if (!activeId) return <LoadingStatus label="Opening PDF document…" />;

  const active = docs.find((document) => document.id === activeId);
  return (
    <DocumentScope id={activeId}>
      <DocumentGate fallback={<DocumentFallback />}>{children}</DocumentGate>
      {active?.name ? <span className="sr-only">{active.name}</span> : null}
    </DocumentScope>
  );
}
