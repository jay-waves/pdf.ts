import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
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

export const startupLogStore = createStore<StartupLogSnapshot>(() => ({
  session: 0,
  title: 'PDF.ts',
  state: 'ready',
  entries: [],
}));

let startedAt = performance.now();
let nextEntryId = 1;
const onceKeys = new Set<string>();

function appendStartupLog(level: StartupLogLevel, message: string, detail?: string) {
  const entry = { id: nextEntryId++, elapsed: performance.now() - startedAt, level, message, detail };
  const consoleMessage = detail ? `${message} · ${detail}` : message;
  if (level === 'error') console.error('[pdf-ts]', consoleMessage);
  else if (level === 'warn') console.warn('[pdf-ts]', consoleMessage);
  else console.log('[pdf-ts]', consoleMessage);
  startupLogStore.setState((state) => ({
    entries: [...state.entries, entry].slice(-MAX_ENTRIES),
  }));
}

export function beginStartupLog(title = 'PDF.ts') {
  startedAt = performance.now();
  onceKeys.clear();
  startupLogStore.setState((state) => ({
    session: state.session + 1,
    title,
    state: 'running',
    entries: [],
  }));
  console.log(`[pdf-ts] ${title}`);
}

export function writeStartupLog(level: StartupLogLevel, message: string, detail?: string) {
  if (startupLogStore.getState().state !== 'running') return;
  appendStartupLog(level, message, detail);
}

export function writeStartupInfo(message: string, detail?: string) {
  writeStartupLog('info', message, detail);
}

export function writeStartupLogOnce(
  key: string,
  message: string,
  detail?: string,
  level: StartupLogLevel = 'info',
) {
  if (startupLogStore.getState().state !== 'running' || onceKeys.has(key)) return;
  onceKeys.add(key);
  writeStartupLog(level, message, detail);
}

export function failStartupLog(message: string, detail?: string) {
  if (startupLogStore.getState().state !== 'running') return;
  appendStartupLog('error', message, detail);
  startupLogStore.setState({ state: 'error' });
}

export function completeStartupLog(message: string, detail?: string) {
  if (startupLogStore.getState().state !== 'running') return;
  appendStartupLog('info', message, detail);
  startupLogStore.setState({ state: 'ready' });
}

function formatEntry(entry: StartupLogEntry) {
  const prefix = entry.level === 'info' ? '' : `[${entry.level}] `;
  return `${prefix}${entry.message}${entry.detail ? ` · ${entry.detail}` : ''}`;
}

export function StartupLogScreen() {
  const snapshot = useStore(startupLogStore);
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
