type Task = {
  key?: string;
  priority?: () => number;
  execute(): Promise<unknown>;
  resolve(value: unknown): void;
  reject(error: unknown): void;
};

export const cancelledRenderTask = () => Object.assign(new Error('PDF operation cancelled.'), { code: 'Aborted' });

/** One native lane. Only explicitly identified reads may pass other reads;
 * unknown calls and mutations are FIFO barriers. Priorities are read at dequeue. */
export class RenderTaskQueue {
  private pending: Task[] = [];
  private scheduled = false;
  private busy = false;
  private postTurn: (callback: () => void) => void;

  constructor(postTurn: (callback: () => void) => void = callback => { setTimeout(callback, 0); }) {
    this.postTurn = postTurn;
  }

  enqueue<T>(execute: () => Promise<T>, options: { key?: string; priority?: () => number } = {}): Promise<T> {
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.push({ ...options, execute, resolve, reject });
    });
    this.schedule();
    return promise as Promise<T>;
  }

  cancel(key: string) {
    const index = this.pending.findIndex(task => task.key === key);
    if (index < 0) return false;
    this.pending.splice(index, 1)[0].reject(cancelledRenderTask());
    return true;
  }

  private schedule() {
    if (this.busy || this.scheduled || !this.pending.length) return;
    this.scheduled = true;
    // Let queued viewport/abort messages arrive between native operations.
    // No debounce: an idle lane starts on the next event-loop turn.
    this.postTurn(() => { this.scheduled = false; void this.pump(); });
  }

  private async pump() {
    if (this.busy || !this.pending.length) return;
    let next = 0;
    if (this.pending[0].priority) {
      let best = this.pending[0].priority();
      for (let i = 1; i < this.pending.length && this.pending[i].priority; i++) {
        const rank = this.pending[i].priority!();
        if (rank > best) { next = i; best = rank; }
      }
    }
    const task = this.pending.splice(next, 1)[0];
    this.busy = true;
    try { task.resolve(await task.execute()); }
    catch (error) { task.reject(error); }
    finally { this.busy = false; this.schedule(); }
  }
}

export type DisplayRequest = {
  type: string;
  method?: string;
  path?: Array<string | { page: unknown } | { with: unknown }>;
  args?: unknown[];
};

/** A deliberately narrow allowlist: never infer safety from a method name alone. */
export function displayRead(request: DisplayRequest) {
  if (request.type !== 'call') return null;
  const path = request.path ?? [];
  const services = path.filter(part => typeof part === 'string');
  const pages = path.filter(part => typeof part === 'object' && 'page' in part);
  if (services.length !== 1 || pages.length !== 1) return null;
  const page = (pages[0] as { page: { objectNumber?: number } }).page?.objectNumber;
  if (typeof page !== 'number') return null;
  const operation = `${services[0]}.${request.method}`;
  if (!['render.raw', 'render.image', 'text.layout', 'annotations.list', 'forms.renderAppearances'].includes(operation)) return null;
  let view: string | undefined;
  for (const part of path) {
    if (typeof part === 'object' && 'with' in part) {
      const facts = part.with as { view?: string };
      if (typeof facts?.view === 'string') view = facts.view;
    }
  }
  const options = request.args?.[0] as { target?: unknown } | undefined;
  const pixels = operation === 'render.raw' || operation === 'render.image';
  return { page, view, detail: pixels ? (options?.target ? 2 : 3) : 1 };
}
