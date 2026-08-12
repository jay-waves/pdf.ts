export type ViewerInputSource = 'Mouse' | 'Touch' | 'Pen' | 'Wheel' | 'Keyboard';
type ViewerActivityPath = readonly string[];
export type ViewerActivityAudience = 'all' | 'toolbar' | 'navigation';

type ViewerActivityEvent = {
  id: number;
  phase: 'start' | 'update' | 'end';
  source: ViewerInputSource;
  path: ViewerActivityPath;
  audience: ViewerActivityAudience;
};

export type ViewerActivitySnapshot = {
  source: ViewerInputSource | null;
  path: ViewerActivityPath;
  active: boolean;
};

export type ViewerActivitySession = {
  update(path: ViewerActivityPath): void;
  end(): void;
};

class ViewerActivityStore {
  private snapshot: ViewerActivitySnapshot = { source: null, path: [], active: false };
  private readonly snapshotListeners = new Set<() => void>();
  private readonly eventListeners = new Set<(event: ViewerActivityEvent) => void>();
  private readonly activeSessions = new Map<number, {
    source: ViewerInputSource;
    path: ViewerActivityPath;
  }>();
  private nextId = 1;

  subscribe = (listener: () => void) => {
    this.snapshotListeners.add(listener);
    return () => {
      this.snapshotListeners.delete(listener);
    };
  };

  onEvent(listener: (event: ViewerActivityEvent) => void) {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  getSnapshot = () => this.snapshot;

  begin(
    source: ViewerInputSource,
    initialPath: ViewerActivityPath,
    audience: ViewerActivityAudience = 'all',
  ): ViewerActivitySession {
    const id = this.nextId++;
    let path = initialPath;
    let ended = false;
    this.activeSessions.set(id, { source, path });
    this.publish({ id, phase: 'start', source, path, audience });

    return {
      update: (nextPath) => {
        if (ended) return;
        if (
          nextPath.length === path.length
          && nextPath.every((part, index) => part === path[index])
        ) return;
        path = nextPath;
        this.activeSessions.set(id, { source, path });
        this.publish({ id, phase: 'update', source, path, audience });
      },
      end: () => {
        if (ended) return;
        ended = true;
        this.activeSessions.delete(id);
        this.publish({ id, phase: 'end', source, path, audience });
      },
    };
  }

  pulse(
    source: ViewerInputSource,
    path: ViewerActivityPath,
    audience: ViewerActivityAudience = 'all',
  ) {
    const session = this.begin(source, path, audience);
    session.end();
  }

  private publish(event: ViewerActivityEvent) {
    const latestActive = Array.from(this.activeSessions.values()).at(-1);
    const displayed = latestActive ?? event;
    this.snapshot = {
      source: displayed.source,
      path: displayed.path,
      active: Boolean(latestActive),
    };
    this.snapshotListeners.forEach((listener) => listener());
    this.eventListeners.forEach((listener) => listener(event));
  }
}

export const viewerActivity = new ViewerActivityStore();

export function pointerInputSource(event: PointerEvent): ViewerInputSource {
  if (event.pointerType === 'touch') return 'Touch';
  if (event.pointerType === 'pen') return 'Pen';
  return 'Mouse';
}
