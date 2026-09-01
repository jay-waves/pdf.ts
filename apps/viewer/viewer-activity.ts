export type ViewerInputSource = 'Mouse' | 'Touch' | 'Pen' | 'Wheel' | 'Keyboard';
type ViewerActivityPath = readonly string[];
export type ViewerActivityAudience = 'all' | 'toolbar' | 'navigation';

type ViewerActivityEvent = {
  id: number;
  phase: 'start' | 'update' | 'end' | 'toggle-controls' | 'hide-controls';
  source: ViewerInputSource;
  path: ViewerActivityPath;
  audience: ViewerActivityAudience;
};

export type ViewerActivitySession = {
  update(path: ViewerActivityPath): void;
  end(): void;
};

class ViewerActivityStore {
  private readonly eventListeners = new Set<(event: ViewerActivityEvent) => void>();
  private nextId = 1;

  onEvent(listener: (event: ViewerActivityEvent) => void) {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  begin(
    source: ViewerInputSource,
    initialPath: ViewerActivityPath,
    audience: ViewerActivityAudience = 'all',
  ): ViewerActivitySession {
    const id = this.nextId++;
    let path = initialPath;
    let ended = false;
    this.publish({ id, phase: 'start', source, path, audience });

    return {
      update: (nextPath) => {
        if (ended) return;
        if (
          nextPath.length === path.length
          && nextPath.every((part, index) => part === path[index])
        ) return;
        path = nextPath;
        this.publish({ id, phase: 'update', source, path, audience });
      },
      end: () => {
        if (ended) return;
        ended = true;
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

  controls(
    action: 'toggle' | 'hide',
    source: ViewerInputSource,
    path: ViewerActivityPath,
    audience: ViewerActivityAudience = 'all',
  ) {
    this.publish({
      id: this.nextId++,
      phase: action === 'toggle' ? 'toggle-controls' : 'hide-controls',
      source,
      path,
      audience,
    });
  }

  private publish(event: ViewerActivityEvent) {
    this.eventListeners.forEach((listener) => listener(event));
  }
}

export const viewerActivity = new ViewerActivityStore();

export function pointerInputSource(event: PointerEvent): ViewerInputSource {
  if (event.pointerType === 'touch') return 'Touch';
  if (event.pointerType === 'pen') return 'Pen';
  return 'Mouse';
}
