import type { WorkerHost } from '@embedpdf/engine-services';

export const PARSED_PAGE_BASE_BUDGET = 64 * 1024 * 1024;
const REBUILD_WINDOW_MS = 10_000;
const QUIET_MS = 60_000;
const MAX_SHRINK_DELAY_MS = QUIET_MS * 8;
const TRACKED_PAGES_PER_DOCUMENT = 256;
type Cache = Pick<WorkerHost['parsedPageCache'], 'observe' | 'setBudget' | 'bytes' | 'budgetBytes'>;
type Event = Parameters<NonNullable<Parameters<Cache['observe']>[0]>>[0];
type History = { evictedAt: number | null; rebuilds: number[] };

/** Two budgets, driven only by rapid reloading of budget-evicted parsed pages. */
export class AdaptivePageCache {
  private histories = new WeakMap<object, Map<number, History>>();
  private lastRebuild = -Infinity;
  private budgetEvictions = 0;
  private rapidRebuilds = 0;
  private promotions = 0;
  private demotions = 0;
  private rollbacks = 0;
  private shrinkDelayMs = QUIET_MS;
  private shrinkProbe: { until: number; previousBudget: number } | null = null;
  private readonly cache: Cache;
  private readonly now: () => number;
  private readonly baseBytes: number;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(cache: Cache, now = () => performance.now(), baseBytes = PARSED_PAGE_BASE_BUDGET) {
    this.cache = cache;
    this.now = now;
    this.baseBytes = baseBytes;
    cache.setBudget(baseBytes);
    cache.observe(event => this.observe(event));
    this.timer = setInterval(() => this.check(), 5_000);
  }

  private observe(event: Event) {
    if (event.type === 'reset') {
      if (event.owner) this.histories.delete(event.owner);
      else this.histories = new WeakMap();
      return;
    }
    let pages = this.histories.get(event.owner);
    if (event.type === 'forget') { pages?.delete(event.page); return; }
    const now = this.now();
    if (event.type === 'evict') {
      this.budgetEvictions++;
      if (!pages) this.histories.set(event.owner, pages = new Map());
      const history = pages.get(event.page) ?? { evictedAt: null, rebuilds: [] };
      history.evictedAt = now;
      pages.delete(event.page);
      pages.set(event.page, history);
      // Bound metadata even during a scan through thousands of pages.
      if (pages.size > TRACKED_PAGES_PER_DOCUMENT) pages.delete(pages.keys().next().value!);
      return;
    }
    const history = pages?.get(event.page);
    if (!history || history.evictedAt === null) return;
    const elapsed = now - history.evictedAt;
    history.evictedAt = null;
    if (elapsed > REBUILD_WINDOW_MS) { pages!.delete(event.page); return; }
    this.rapidRebuilds++;
    this.lastRebuild = now;
    this.settleShrinkProbe(now);
    if (this.shrinkProbe) {
      // One new eviction/reload is enough to undo a recent shrink. Do not make
      // the reader pay for three repeats again to rediscover the old budget.
      this.cache.setBudget(this.shrinkProbe.previousBudget);
      this.shrinkProbe = null;
      this.shrinkDelayMs = Math.min(this.shrinkDelayMs * 2, MAX_SHRINK_DELAY_MS);
      this.rollbacks++;
      this.promotions++;
      return;
    }
    history.rebuilds = history.rebuilds.filter(time => now - time <= REBUILD_WINDOW_MS).slice(-2);
    history.rebuilds.push(now);
    if (history.rebuilds.length === 3 && this.cache.budgetBytes === this.baseBytes) {
      // Increasing the budget is bookkeeping only, safe inside the load callback.
      this.cache.setBudget(this.baseBytes * 2);
      this.promotions++;
    }
  }

  private settleShrinkProbe(now: number) {
    if (this.shrinkProbe && now > this.shrinkProbe.until) {
      this.shrinkProbe = null;
      // A successful shrink ends the backoff; old workloads must not keep a
      // later document's cache inflated indefinitely.
      this.shrinkDelayMs = QUIET_MS;
    }
  }

  check() {
    const now = this.now();
    this.settleShrinkProbe(now);
    if (this.cache.budgetBytes === this.baseBytes || now - this.lastRebuild < this.shrinkDelayMs
      || this.cache.bytes >= this.baseBytes / 2) return;
    this.shrinkProbe = { until: now + REBUILD_WINDOW_MS, previousBudget: this.cache.budgetBytes };
    this.histories = new WeakMap();
    this.cache.setBudget(this.baseBytes);
    this.demotions++;
  }

  stats() {
    return { budgetBytes: this.cache.budgetBytes, usedBytes: this.cache.bytes,
      budgetEvictions: this.budgetEvictions, rapidRebuilds: this.rapidRebuilds,
      promotions: this.promotions, demotions: this.demotions,
      rollbacks: this.rollbacks, shrinkDelayMs: this.shrinkDelayMs };
  }

  dispose() {
    clearInterval(this.timer);
    this.cache.observe(undefined);
    this.histories = new WeakMap();
    this.shrinkProbe = null;
  }
}
