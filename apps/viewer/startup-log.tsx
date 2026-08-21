import { createStore } from 'zustand/vanilla';

export type StartupLogLevel = 'info' | 'warn' | 'error';

export type StartupLogEntry = {
  id: number;
  elapsed: number;
  level: StartupLogLevel;
  message: string;
  detail?: string;
};

export type StartupLogSnapshot = {
  session: number;
  title: string;
  state: 'running' | 'ready' | 'error';
  entries: StartupLogEntry[];
};

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

function formatConsoleMessage(message: string) {
  return /[.!?]$/u.test(message) ? message : `${message}.`;
}

function writeConsole(level: StartupLogLevel, elapsed: number, message: string, detail?: string) {
  const text = `[pdf-ts +${elapsed.toFixed(1)}ms] ${formatConsoleMessage(message)}`;
  const output = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
  if (detail) output(text, detail);
  else output(text);
}

function appendStartupLog(level: StartupLogLevel, message: string, detail?: string) {
  const entry = { id: nextEntryId++, elapsed: performance.now() - startedAt, level, message, detail };
  writeConsole(level, entry.elapsed, message, detail);
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
  writeConsole('info', 0, `Starting ${title}`);
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

function formatDuration(duration: number) {
  return duration < 1000 ? `${duration.toFixed(0)} ms` : `${(duration / 1000).toFixed(2)} s`;
}

export function formatStartupDiagnostics(snapshot: StartupLogSnapshot) {
  const completed = snapshot.entries.at(-1);
  const state = snapshot.state === 'running' ? 'in progress' : snapshot.state;
  const total = completed ? ` in ${formatDuration(completed.elapsed)}` : '';
  const milestones = [
    ['Viewer resources ready', 'Resources'],
    ['PDF engine ready', 'PDF engine'],
    ['Document opened', 'Document opened'],
    ['Page raster generated', 'First raster'],
    ['First page ready', 'First page'],
  ].flatMap(([message, label]) => {
    const entry = snapshot.entries.find((candidate) => candidate.message === message);
    return entry ? [`- ${label}: ${formatDuration(entry.elapsed)}`] : [];
  });

  return [
    `Startup: ${state}${total}.`,
    ...(milestones.length ? ['Startup milestones:', ...milestones] : []),
  ].join('\n');
}
