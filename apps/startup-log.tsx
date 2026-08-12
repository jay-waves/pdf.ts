import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Dialog } from './components';

export type StartupLogLevel = 'info' | 'warn' | 'error';

type StartupLogEntry = {
  id: number;
  elapsed: number;
  level: StartupLogLevel;
  message: string;
  detail?: string;
};

type StartupLogSnapshot = {
  session: number;
  title: string;
  state: 'running' | 'ready' | 'error';
  entries: StartupLogEntry[];
};

const REVEAL_DELAY_MS = 1000;
const STARTUP_LOG_DEFAULT_OPEN = false;
const MAX_ENTRIES = 24;

class StartupLogger {
  private listeners = new Set<() => void>();
  private startedAt = performance.now();
  private nextEntryId = 1;
  private onceKeys = new Set<string>();
  private snapshot: StartupLogSnapshot = {
    session: 0,
    title: 'PDF.ts',
    state: 'ready',
    entries: [],
  };

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  begin(title = 'PDF.ts') {
    this.startedAt = performance.now();
    this.onceKeys.clear();
    this.snapshot = {
      session: this.snapshot.session + 1,
      title,
      state: 'running',
      entries: [],
    };
    console.log(`[pdf-ts] ${title}`);
    this.emit();
  }

  info(message: string, detail?: string) {
    this.write('info', message, detail);
  }

  warn(message: string, detail?: string) {
    this.write('warn', message, detail);
  }

  error(message: string, detail?: string) {
    if (this.snapshot.state !== 'running') return;
    this.append('error', message, detail);
    this.snapshot = { ...this.snapshot, state: 'error' };
    this.emit();
  }

  once(key: string, message: string, detail?: string, level: StartupLogLevel = 'info') {
    if (this.snapshot.state !== 'running' || this.onceKeys.has(key)) return;
    this.onceKeys.add(key);
    this.write(level, message, detail);
  }

  complete(message: string, detail?: string) {
    if (this.snapshot.state !== 'running') return;
    this.append('info', message, detail);
    this.snapshot = { ...this.snapshot, state: 'ready' };
    this.emit();
  }

  write(level: StartupLogLevel, message: string, detail?: string) {
    if (this.snapshot.state !== 'running') return;
    this.append(level, message, detail);
    this.emit();
  }

  private append(level: StartupLogLevel, message: string, detail?: string) {
    const entry = {
      id: this.nextEntryId++,
      elapsed: performance.now() - this.startedAt,
      level,
      message,
      detail,
    };
    const consoleMessage = detail ? `${message} · ${detail}` : message;
    if (level === 'error') console.error('[pdf-ts]', consoleMessage);
    else if (level === 'warn') console.warn('[pdf-ts]', consoleMessage);
    else console.log('[pdf-ts]', consoleMessage);
    this.snapshot = {
      ...this.snapshot,
      entries: [...this.snapshot.entries, entry].slice(-MAX_ENTRIES),
    };
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }
}

export const startupLog = new StartupLogger();

function formatEntry(entry: StartupLogEntry) {
  const prefix = entry.level === 'info' ? '' : `[${entry.level}] `;
  return `${prefix}${entry.message}${entry.detail ? ` · ${entry.detail}` : ''}`;
}

export function StartupLogScreen() {
  const snapshot = useSyncExternalStore(startupLog.subscribe, startupLog.getSnapshot);
  const [visible, setVisible] = useState(STARTUP_LOG_DEFAULT_OPEN);
  const [dismissed, setDismissed] = useState(false);
  const detailsRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    setVisible(STARTUP_LOG_DEFAULT_OPEN);
    setDismissed(false);
  }, [snapshot.session]);

  useEffect(() => {
    if (STARTUP_LOG_DEFAULT_OPEN || snapshot.state !== 'running' || visible || dismissed) return;
    const timer = window.setTimeout(() => setVisible(true), REVEAL_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [dismissed, snapshot.session, snapshot.state, visible]);

  useEffect(() => {
    const details = detailsRef.current;
    if (details) details.scrollTop = details.scrollHeight;
  }, [snapshot.entries]);

  if (!visible || dismissed) return null;

  const status = snapshot.state === 'error'
    ? 'PDF startup did not complete successfully. Tap outside to dismiss.'
    : 'Some work is still in progress. Tap outside to dismiss.';
  const details = [
    snapshot.title,
    '',
    ...snapshot.entries.map(formatEntry),
  ].join('\n');

  return (
    <Dialog
      open
      onClose={() => setDismissed(true)}
      title="Startup details"
      titleVariant="popup"
      variant="popupWide"
      contentClassName="flex h-[min(620px,calc(100vh-32px))] flex-col font-mono"
    >
      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(180px,1fr)] gap-3 p-3.5 text-[11px]">
        <p className={`m-0 ${snapshot.state === 'error' ? 'text-danger' : 'text-secondary'}`} role="status">
          {status}
        </p>
        <textarea
          ref={detailsRef}
          className="h-full min-h-45 resize-none rounded-md border border-border bg-input p-2.5 font-mono text-[10.5px] leading-4 text-foreground outline-none focus:border-accent"
          value={details}
          aria-label="Startup log"
          readOnly
        />
      </div>
    </Dialog>
  );
}
