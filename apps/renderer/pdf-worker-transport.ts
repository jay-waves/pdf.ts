/** Worker-shaped transport for EmbedPDF's RemoteExecutor. */
class PdfWorkerTransport extends EventTarget {
  private endpoint: Worker | MessagePort | null = null;
  private sharedWorker: SharedWorker | null = null;
  private initialMessage: unknown;
  private ready = false;
  private closed = false;
  private releaseLease: (() => void) | null = null;
  private readonly leaseAbort = new AbortController();
  private startupTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super();
    window.addEventListener('pagehide', this.onPageHide);
  }

  private readonly onPageHide = (event: PageTransitionEvent) => {
    // Keep a suspended page's document and edits intact when it enters BFCache.
    if (!event.persisted) this.terminate();
  };

  private readonly onMessage = (rawEvent: Event) => {
    const event = rawEvent as MessageEvent;
    if (this.closed) return;
    if (this.sharedWorker && !this.ready && event.data?.type === 'error') {
      this.startDedicated();
      return;
    }
    if (event.data?.type === 'ready') {
      this.ready = true;
      clearTimeout(this.startupTimer);
    }
    this.dispatchEvent(new MessageEvent('message', { data: event.data }));
  };

  private readonly onError = (event: Event) => {
    if (this.closed) return;
    if (this.sharedWorker && !this.ready) {
      this.startDedicated();
      return;
    }
    this.dispatchEvent(new ErrorEvent('error', {
      message: event instanceof ErrorEvent ? event.message : 'PDF worker failed',
    }));
  };

  private readonly onMessageError = () => {
    this.dispatchEvent(new MessageEvent('messageerror'));
  };

  private attach(endpoint: Worker | MessagePort) {
    this.endpoint = endpoint;
    endpoint.addEventListener('message', this.onMessage);
    endpoint.addEventListener('messageerror', this.onMessageError);
    if ('start' in endpoint) endpoint.start();
    else endpoint.addEventListener('error', this.onError);
  }

  private detach() {
    clearTimeout(this.startupTimer);
    const endpoint = this.endpoint;
    this.endpoint = null;
    if (endpoint) {
      endpoint.removeEventListener('message', this.onMessage);
      endpoint.removeEventListener('messageerror', this.onMessageError);
      if ('close' in endpoint) {
        endpoint.postMessage({ type: 'disconnect' });
        endpoint.close();
      } else {
        endpoint.removeEventListener('error', this.onError);
        endpoint.terminate();
      }
    }
    this.sharedWorker?.removeEventListener('error', this.onError);
    this.sharedWorker = null;
    this.releaseLease?.();
    this.releaseLease = null;
  }

  private startDedicated() {
    this.detach();
    if (this.closed) return;
    try {
      this.attach(new Worker(new URL('./pdfium-worker', import.meta.url), { type: 'module' }));
      this.endpoint!.postMessage(this.initialMessage);
    } catch (error) {
      // RemoteExecutor attaches its readiness task after posting initialization.
      queueMicrotask(() => this.onError(new ErrorEvent('error', { message: String(error) })));
    }
  }

  postMessage(message: unknown, transfer: Transferable[] = []) {
    if (this.closed) throw new Error('PDF worker connection is closed.');
    if (this.endpoint) {
      this.endpoint.postMessage(message, transfer);
      return;
    }
    this.initialMessage = message;
    // A Web Lock keeps the session alive without background-tab heartbeat
    // deadlines. The browser releases it even when a tab crashes or is discarded.
    if (typeof SharedWorker === 'undefined' || !navigator.locks) {
      this.startDedicated();
      return;
    }
    const lease = `pdf-ts-session:${crypto.randomUUID()}`;
    void navigator.locks.request(lease, { signal: this.leaseAbort.signal }, async () => {
      if (this.closed) return;
      const lifetime = new Promise<void>((resolve) => { this.releaseLease = resolve; });
      try {
        this.sharedWorker = new SharedWorker(new URL('./pdfium-worker', import.meta.url), {
          type: 'module',
          // The script URL (hashed in production) isolates different app versions.
        });
        this.sharedWorker.addEventListener('error', this.onError);
        this.attach(this.sharedWorker.port);
        this.endpoint!.postMessage({ ...(message as object), lease });
        // No document has been opened yet, so falling back here cannot lose edits.
        this.startupTimer = setTimeout(() => this.startDedicated(), 30_000);
      } catch {
        this.startDedicated();
      }
      await lifetime;
    }).catch(() => {
      if (!this.closed) this.startDedicated();
    });
  }

  terminate() {
    if (this.closed) return;
    this.closed = true;
    window.removeEventListener('pagehide', this.onPageHide);
    this.leaseAbort.abort();
    this.detach();
  }
}

export function createPdfWorker(): Worker {
  // RemoteExecutor uses only EventTarget, postMessage and terminate, including
  // terminate() when it is destroyed. It never accesses Worker-only properties.
  return new PdfWorkerTransport() as unknown as Worker;
}
