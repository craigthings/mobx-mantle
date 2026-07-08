/**
 * Standard library of behavior primitives. Every argument documented as
 * MaybeGetter accepts either a plain value (frozen at construction) or a
 * getter (a live connection — re-resolved whenever its observable sources
 * change):
 *
 * ```tsx
 * media = withMediaQuery('(max-width: 768px)');        // static
 * media = withMediaQuery(() => this.props.breakpoint); // live
 * ```
 *
 * Several primitives are themselves compositions of other primitives
 * (withFetch = withAsync + watch, withWindowSize = withEventListener + state,
 * withAutosave = withInterval + withAsync) — the same nesting available to
 * user-defined behaviors.
 */
import { Behavior, createBehavior } from '../behavior';
import { resolve, type MaybeGetter } from '../reactive-args';

// ---------------------------------------------------------------------------
// withEventListener
// ---------------------------------------------------------------------------

export class EventListenerBehavior extends Behavior {
  onCreate(
    target: MaybeGetter<EventTarget | null | undefined>,
    type: MaybeGetter<string>,
    handler: (event: Event) => void,
    options?: AddEventListenerOptions
  ) {
    this.effect(() => {
      const el = resolve(target);
      const eventType = resolve(type);
      if (!el) return;
      const listener = (event: Event) => handler(event);
      el.addEventListener(eventType, listener, options);
      return () => el.removeEventListener(eventType, listener, options);
    });
  }
}

/**
 * Attach an event listener for the mounted lifetime of the host. Re-attaches
 * when a getter target or type changes.
 */
export const withEventListener = createBehavior(EventListenerBehavior);

// ---------------------------------------------------------------------------
// withInterval
// ---------------------------------------------------------------------------

export class IntervalBehavior extends Behavior {
  onCreate(callback: () => void, delay: MaybeGetter<number | null> = 1000) {
    this.effect(() => {
      const ms = resolve(delay);
      if (ms == null || ms < 0) return; // null pauses the interval
      const id = setInterval(() => callback(), ms);
      return () => clearInterval(id);
    });
  }
}

/**
 * Run a callback on an interval for the mounted lifetime of the host.
 * A getter delay reschedules on change; resolving to null pauses.
 */
export const withInterval = createBehavior(IntervalBehavior);

// ---------------------------------------------------------------------------
// withTimeout
// ---------------------------------------------------------------------------

export class TimeoutBehavior extends Behavior {
  /** True while the timeout is scheduled and hasn't fired */
  pending = false;

  onCreate(callback: () => void, delay: MaybeGetter<number | null>) {
    this.effect(() => {
      const ms = resolve(delay);
      if (ms == null || ms < 0) return; // null cancels/pauses
      this.pending = true;
      const id = setTimeout(() => {
        this.pending = false;
        callback();
      }, ms);
      return () => {
        this.pending = false;
        clearTimeout(id);
      };
    });
  }
}

/**
 * Run a callback once after a delay (measured from mount). A getter delay
 * reschedules on change; resolving to null cancels.
 */
export const withTimeout = createBehavior(TimeoutBehavior);

// ---------------------------------------------------------------------------
// withAsync
// ---------------------------------------------------------------------------

export class AsyncBehavior<T = unknown> extends Behavior {
  value: T | undefined = undefined;
  error: unknown = undefined;
  loading = false;

  private _fn!: (...args: any[]) => Promise<T>;
  private _runId = 0;

  onCreate(fn: (...args: any[]) => Promise<T>) {
    this._fn = fn;
  }

  /**
   * Run the async function. Out-of-order completions are discarded: only the
   * most recent run may write value/error/loading.
   */
  async run(...args: any[]): Promise<T | undefined> {
    const id = ++this._runId;
    this.loading = true;
    this.error = undefined;
    try {
      const result = await this._fn(...args);
      if (id === this._runId) {
        this.value = result;
        this.loading = false;
      }
      return result;
    } catch (e) {
      if (id === this._runId) {
        this.error = e;
        this.loading = false;
      }
      return undefined;
    }
  }

  /** Discard any in-flight run's result */
  cancel(): void {
    this._runId++;
    this.loading = false;
  }
}

/** Track an async function's latest run as observable value/error/loading state. */
export const withAsync = createBehavior(AsyncBehavior) as unknown as {
  <T>(fn: (...args: any[]) => Promise<T>): AsyncBehavior<T>;
  new <T>(fn: (...args: any[]) => Promise<T>): AsyncBehavior<T>;
};

// ---------------------------------------------------------------------------
// withFetch — composition: withAsync + watch
// ---------------------------------------------------------------------------

export class FetchBehavior<T = unknown> extends Behavior {
  /** The request state machine is a nested withAsync behavior */
  request = withAsync<T>(async (url: string, init?: RequestInit) => {
    const response = await fetch(url, init);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return (await response.json()) as T;
  });

  onCreate(url: MaybeGetter<string | null | undefined>, init?: RequestInit) {
    this.watch(
      () => resolve(url),
      (next) => {
        if (next) this.request.run(next, init);
      },
      { fireImmediately: true }
    );
  }

  get data(): T | undefined {
    return this.request.value;
  }
  get loading(): boolean {
    return this.request.loading;
  }
  get error(): unknown {
    return this.request.error;
  }
}

/**
 * Fetch JSON from a URL. A getter URL refetches on change (the first fetch
 * fires at mount); a URL resolving to null/undefined skips fetching.
 * Out-of-order responses are discarded by the underlying withAsync.
 */
export const withFetch = createBehavior(FetchBehavior) as unknown as {
  <T = unknown>(url: MaybeGetter<string | null | undefined>, init?: RequestInit): FetchBehavior<T>;
  new <T = unknown>(url: MaybeGetter<string | null | undefined>, init?: RequestInit): FetchBehavior<T>;
};

// ---------------------------------------------------------------------------
// withLocalStorage — composition: withEventListener for cross-tab sync
// ---------------------------------------------------------------------------

export class LocalStorageBehavior<T = unknown> extends Behavior {
  value!: T;

  /** Cross-tab sync rides on a nested withEventListener */
  storageSync!: EventListenerBehavior;

  onCreate(key: string, initialValue: T) {
    let stored: T | undefined;
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(key);
        if (raw !== null) stored = JSON.parse(raw) as T;
      } catch {
        // corrupted entry or blocked storage — fall back to initialValue
      }
    }
    this.value = stored !== undefined ? stored : initialValue;

    // Persist on change (tracking starts at mount)
    this.watch(
      () => JSON.stringify(this.value),
      (json) => {
        try {
          localStorage.setItem(key, json);
        } catch {
          // quota exceeded or blocked storage — value stays in memory
        }
      }
    );

    this.storageSync = withEventListener(
      () => (typeof window === 'undefined' ? null : window),
      'storage',
      (event) => {
        const e = event as StorageEvent;
        if (e.key !== key || e.newValue === null) return;
        try {
          this.value = JSON.parse(e.newValue) as T;
        } catch {
          // malformed external write — ignore
        }
      }
    );
  }
}

/**
 * An observable value persisted to localStorage under `key`, hydrated from
 * storage at construction and kept in sync across tabs. Values must be
 * JSON-serializable.
 */
export const withLocalStorage = createBehavior(LocalStorageBehavior) as unknown as {
  <T>(key: string, initialValue: T): LocalStorageBehavior<T>;
  new <T>(key: string, initialValue: T): LocalStorageBehavior<T>;
};

// ---------------------------------------------------------------------------
// withWindowSize — composition: withEventListener
// ---------------------------------------------------------------------------

export class WindowSizeBehavior extends Behavior {
  width = typeof window !== 'undefined' ? window.innerWidth : 0;
  height = typeof window !== 'undefined' ? window.innerHeight : 0;

  resize = withEventListener(
    () => (typeof window === 'undefined' ? null : window),
    'resize',
    () => this.measure()
  );

  measure() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
  }
}

/** Observable window inner width/height (0×0 during SSR). */
export const withWindowSize = createBehavior(WindowSizeBehavior);

// ---------------------------------------------------------------------------
// withMediaQuery
// ---------------------------------------------------------------------------

export class MediaQueryBehavior extends Behavior {
  matches = false;

  onCreate(query: MaybeGetter<string>) {
    this.effect(() => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
      const mql = window.matchMedia(resolve(query));
      this.matches = mql.matches;
      const onChange = (event: MediaQueryListEvent) => {
        this.matches = event.matches;
      };
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    });
  }
}

/** Observable match state for a media query (false during SSR). */
export const withMediaQuery = createBehavior(MediaQueryBehavior);

// ---------------------------------------------------------------------------
// withDebounce
// ---------------------------------------------------------------------------

export class DebounceBehavior<T = unknown> extends Behavior {
  value!: T;

  onCreate(source: MaybeGetter<T>, delay: number = 300) {
    this.value = resolve(source);
    this.watch(
      () => resolve(source),
      (next) => {
        this.value = next;
      },
      { delay }
    );
  }
}

/** A debounced mirror of a reactive source: updates settle after `delay` ms of quiet. */
export const withDebounce = createBehavior(DebounceBehavior) as unknown as {
  <T>(source: MaybeGetter<T>, delay?: number): DebounceBehavior<T>;
  new <T>(source: MaybeGetter<T>, delay?: number): DebounceBehavior<T>;
};

// ---------------------------------------------------------------------------
// withThrottle
// ---------------------------------------------------------------------------

export class ThrottleBehavior<T = unknown> extends Behavior {
  value!: T;

  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _lastEmit = 0;

  onCreate(source: MaybeGetter<T>, delay: number = 300) {
    this.value = resolve(source);
    this.watch(
      () => resolve(source),
      (next) => {
        const now = Date.now();
        const remaining = delay - (now - this._lastEmit);
        if (remaining <= 0) {
          this._lastEmit = now;
          this.value = next;
        } else if (this._timer === null) {
          // Trailing edge: emit the latest value when the window closes
          this._timer = setTimeout(() => {
            this._timer = null;
            this._lastEmit = Date.now();
            this.value = resolve(source);
          }, remaining);
        }
      }
    );
  }

  onUnmount() {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }
}

/** A throttled mirror of a reactive source: at most one update per `delay` ms, trailing edge included. */
export const withThrottle = createBehavior(ThrottleBehavior) as unknown as {
  <T>(source: MaybeGetter<T>, delay?: number): ThrottleBehavior<T>;
  new <T>(source: MaybeGetter<T>, delay?: number): ThrottleBehavior<T>;
};

// ---------------------------------------------------------------------------
// withDocumentTitle
// ---------------------------------------------------------------------------

export class DocumentTitleBehavior extends Behavior {
  onCreate(title: MaybeGetter<string>) {
    this.effect(() => {
      if (typeof document === 'undefined') return;
      const previous = document.title;
      document.title = resolve(title);
      return () => {
        document.title = previous;
      };
    });
  }
}

/** Set document.title for the mounted lifetime; restores the previous title on unmount. */
export const withDocumentTitle = createBehavior(DocumentTitleBehavior);

// ---------------------------------------------------------------------------
// withPageVisibility — composition: withEventListener
// ---------------------------------------------------------------------------

export class PageVisibilityBehavior extends Behavior {
  visible = typeof document !== 'undefined' ? document.visibilityState !== 'hidden' : true;

  visibilityListener = withEventListener(
    () => (typeof document === 'undefined' ? null : document),
    'visibilitychange',
    () => {
      this.visible = document.visibilityState !== 'hidden';
    }
  );
}

/** Observable page visibility (true during SSR). */
export const withPageVisibility = createBehavior(PageVisibilityBehavior);

// ---------------------------------------------------------------------------
// withAutosave — flagship composition: withInterval + withAsync
// ---------------------------------------------------------------------------

export class AutosaveBehavior extends Behavior {
  /** Posting rides on withAsync (out-of-order completions discarded) */
  saver = withAsync(async (url: string, data: unknown) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return response;
  });

  /** Scheduling rides on withInterval (assigned in onCreate, still collected) */
  timer!: IntervalBehavior;

  private _url!: MaybeGetter<string>;
  private _data!: () => unknown;
  private _lastSaved: string | undefined = undefined;

  onCreate(url: MaybeGetter<string>, data: () => unknown, interval: MaybeGetter<number | null> = 5000) {
    this._url = url;
    this._data = data;
    this.timer = withInterval(() => this.save(), interval);
  }

  /** Save now. Skipped when the payload hasn't changed since the last save. */
  save(): void {
    const payload = this._data();
    const serialized = JSON.stringify(payload);
    if (serialized === this._lastSaved) return;
    this._lastSaved = serialized;
    this.saver.run(resolve(this._url), payload);
  }

  get saving(): boolean {
    return this.saver.loading;
  }
  get error(): unknown {
    return this.saver.error;
  }
}

/**
 * Periodically POST a data snapshot as JSON while mounted, skipping saves
 * when nothing changed. A getter interval reschedules on change; resolving
 * to null pauses autosaving. Call save() for an immediate flush.
 */
export const withAutosave = createBehavior(AutosaveBehavior);

export { resolve, type MaybeGetter } from '../reactive-args';
