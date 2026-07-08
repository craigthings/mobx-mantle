import { makeObservable, observable, computed, action, reaction, autorun, type AnnotationsMap } from 'mobx';
import { globalConfig, reportError, applyMobxActionPolicy, type WatchOptions, type EffectOptions } from './config';
import {
  type ReactiveSpec,
  type ProtoInfo,
  registerReactive,
  activateSpecs,
  collectProtoInfo,
} from './internals';

/**
 * Symbol marker to identify behavior instances. Registered globally
 * (Symbol.for) so detection works even when the module is duplicated across
 * bundles or entry points (e.g. the main entry and ./primitives in a CJS
 * build each carrying their own copy).
 */
export const BEHAVIOR_MARKER = Symbol.for('mobx-mantle.behavior');

// Behavior base class members that should not be made observable
const BEHAVIOR_EXCLUDES = new Set([
  'onCreate',
  'onLayoutMount',
  'onMount',
  'onUnmount',
  'addCleanup',
  '_addCleanup',
  'watch',
  'effect',
  'constructor',
  '_watchDisposers',
  '_disposeWatchers',
  '_reactiveSpecs',
  '_behaviors',
  '_mounted',
  '_wasUnmounted',
]);

/**
 * Detects if a value looks like a React ref ({ current: ... })
 * These should use observable.ref to preserve object identity
 */
function isRefLike(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  return 'current' in value && Object.keys(value).length === 1;
}

/**
 * Base class for behaviors. Provides lifecycle method signatures for IDE autocomplete.
 * Extend this class and wrap with createBehavior() to create a factory.
 * 
 * @example
 * ```tsx
 * class WindowSizeBehavior extends Behavior {
 *   width = window.innerWidth;
 *   onCreate(breakpoint = 768) { ... }
 *   onMount() { ... }
 * }
 * export const withWindowSize = createBehavior(WindowSizeBehavior);
 * ```
 */
export class Behavior {
  /** @internal */
  _watchDisposers: (() => void)[] = [];

  /** @internal — pre-mount watch/effect registrations, materialized at mount */
  _reactiveSpecs: ReactiveSpec[] = [];

  /** @internal — child behaviors declared as fields, collected at construction */
  _behaviors: BehaviorEntry[] = [];

  /** @internal — true after the parent Component first mounts */
  _mounted = false;

  /** @internal — set on unmount so a remount can resurrect pre-mount watchers */
  _wasUnmounted = false;

  onCreate?(...args: any[]): void;
  onLayoutMount?(): void | (() => void);
  onMount?(): void | (() => void);
  onUnmount?(): void;

  /**
   * Register a cleanup function to run automatically on unmount.
   * Returns a function that can be called for early cleanup.
   *
   * Cleanups are one-shot: they are not re-created if the parent Component
   * remounts. Call this from onMount (which re-runs on remount), or use
   * effect() for a remount-safe setup/teardown pair.
   */
  addCleanup(cleanup: () => void): () => void {
    if (process.env.NODE_ENV !== 'production' && !this._mounted) {
      console.warn(
        `[mobx-mantle] ${this.constructor.name}.addCleanup() called before mount. ` +
        `Cleanups are one-shot: they run at unmount and are not re-created if the ` +
        `parent Component remounts (React StrictMode does this in development). ` +
        `Acquire resources in onMount(), or use effect() for a remount-safe ` +
        `setup/teardown pair.`
      );
    }
    return this._addCleanup(cleanup);
  }

  /** @internal — addCleanup without the pre-mount dev warning (used by watch/effect) */
  _addCleanup(cleanup: () => void): () => void {
    let active = true;

    const dispose = () => {
      if (!active) return;
      active = false;
      try {
        cleanup();
      } finally {
        const idx = this._watchDisposers.indexOf(dispose);
        if (idx !== -1) this._watchDisposers.splice(idx, 1);
      }
    };

    this._watchDisposers.push(dispose);
    return dispose;
  }

  /**
   * Watch a reactive expression and run a callback when it changes.
   * Automatically disposed on unmount and re-created if the parent Component
   * remounts (StrictMode-safe).
   *
   * Safe to call from onCreate: registration is recorded and comes alive
   * when the parent commits (just before first paint), so the watcher
   * tracks observable fields correctly and renders that React discards
   * never leak reactions.
   *
   * @param expr - Reactive expression (getter) to watch
   * @param callback - Called when the expression result changes
   * @param options - Optional configuration (delay, fireImmediately)
   * @returns Dispose function for early teardown
   *
   * @example
   * ```tsx
   * onCreate(url: string) {
   *   this.url = url;
   *   this.watch(() => this.url, () => this.fetchData());
   * }
   * ```
   */
  watch<T>(
    expr: () => T,
    callback: (value: T, prevValue: T | undefined) => void,
    options?: WatchOptions
  ): () => void {
    return registerReactive(this, () => {
      const dispose = reaction(
        expr,
        (value, prevValue) => {
          try {
            callback(value, prevValue);
          } catch (e) {
            reportError(e, { phase: 'watch', name: this.constructor.name, isBehavior: true });
          }
        },
        {
          delay: options?.delay,
          fireImmediately: options?.fireImmediately,
        }
      );

      return this._addCleanup(dispose);
    });
  }

  /**
   * Run a side effect that auto-tracks reactive dependencies.
   * Re-runs whenever any accessed observable changes.
   * Automatically disposed on unmount.
   * 
   * Best for simple synchronization (DOM updates, logging). For complex
   * side effects with explicit triggers, prefer `watch()`.
   * 
   * @param fn - Effect function. May return a cleanup function.
   * @param options - Optional configuration (delay)
   * @returns Dispose function for early teardown
   * 
   * @example
   * ```tsx
   * onCreate() {
   *   this.effect(() => {
   *     console.log('Current value:', this.value);
   *   });
   * }
   * ```
   */
  effect(
    fn: () => void | (() => void),
    options?: EffectOptions
  ): () => void {
    return registerReactive(this, () => {
      let cleanup: (() => void) | undefined;

      const dispose = autorun(
        () => {
          // Run previous cleanup before re-running effect
          cleanup?.();
          cleanup = undefined;

          try {
            const result = fn();
            if (typeof result === 'function') {
              cleanup = result;
            }
          } catch (e) {
            reportError(e, { phase: 'effect', name: this.constructor.name, isBehavior: true });
          }
        },
        { delay: options?.delay }
      );

      return this._addCleanup(() => {
        cleanup?.();
        dispose();
      });
    });
  }

  /** @internal */
  _disposeWatchers(): void {
    const disposers = this._watchDisposers.slice();
    this._watchDisposers.length = 0;

    for (const dispose of disposers) {
      dispose();
    }
  }
}

/** Per-class cache of prototype-derived info (getters, methods) */
const behaviorProtoInfo = new WeakMap<Function, ProtoInfo>();

/**
 * Makes a behavior instance observable, handling inheritance properly.
 * Works with classes that extend Behavior or plain classes.
 */
function makeBehaviorObservable<T extends object>(instance: T): void {
  const annotations: AnnotationsMap<T, never> = {} as AnnotationsMap<T, never>;

  // Collect own properties → observable
  const ownKeys = new Set([
    ...Object.keys(instance),
    ...Object.keys(Object.getPrototypeOf(instance)),
  ]);

  for (const key of ownKeys) {
    if (BEHAVIOR_EXCLUDES.has(key)) continue;
    if (key in annotations) continue;

    const value = (instance as any)[key];
    if (typeof value === 'function') continue;

    // Child behaviors are already observable; keep their identity
    if (isBehavior(value)) {
      (annotations as any)[key] = observable.ref;
      continue;
    }

    // Use observable.ref for ref-like objects to preserve identity
    if (isRefLike(value)) {
      (annotations as any)[key] = observable.ref;
    } else {
      (annotations as any)[key] = observable;
    }
  }

  // Prototype facts (getters → computed, methods → action.bound) are
  // identical for every instance of a class; collected once, cached per class.
  const protoInfo = collectProtoInfo(instance, Behavior.prototype, BEHAVIOR_EXCLUDES, behaviorProtoInfo);

  for (const key of protoInfo.computedKeys) {
    if (key in annotations) continue;
    (annotations as any)[key] = computed;
  }
  for (const key of protoInfo.methodKeys) {
    if (key in annotations) continue;
    (annotations as any)[key] = action.bound;
  }

  makeObservable(instance, annotations);
}

/** @internal */
export interface BehaviorEntry {
  instance: any;
  cleanup?: () => void;
  layoutCleanup?: () => void;
}

/**
 * Extracts parameter types from onCreate method
 */
type OnCreateParams<T> = T extends { onCreate(...args: infer A): any } ? A : [];

/**
 * Extracts constructor parameter types
 */
type ConstructorParams<T> = T extends new (...args: infer A) => any ? A : [];

/**
 * Determines the args for createBehavior:
 * - If constructor has args, use those
 * - Otherwise, if onCreate has args, use those
 */
type BehaviorArgs<T extends new (...args: any[]) => any> = 
  ConstructorParams<T> extends [] 
    ? OnCreateParams<InstanceType<T>> 
    : ConstructorParams<T>;

/**
 * Creates a behavior factory with automatic observable wrapping and lifecycle management.
 * 
 * Returns a factory function (not a class) — use without `new`:
 * 
 * @example Defining a behavior
 * ```tsx
 * class DragTrait extends Behavior {
 *   ref!: RefObject<HTMLElement>;
 *   
 *   onCreate(ref: RefObject<HTMLElement>) {
 *     this.ref = ref;
 *   }
 *   
 *   onMount() {
 *     this.ref.current?.addEventListener('pointerdown', this.onPointerDown);
 *     return () => this.ref.current?.removeEventListener('pointerdown', this.onPointerDown);
 *   }
 * }
 * 
 * export const withDrag = createBehavior(DragTrait);
 * ```
 * 
 * @example Using in a Component
 * ```tsx
 * class Editor extends Component<Props> {
 *   canvas = this.ref<HTMLCanvasElement>();
 *   
 *   // No `new` keyword — factory function
 *   drag = withDrag(this.canvas);
 *   autosave = withAutosave('/api/save', 5000);
 * }
 * export default createComponent(Editor);
 * ```
 * 
 * The `with` prefix convention signals that the component manages this behavior's lifecycle.
 */
/**
 * Type that supports both `new` and direct call syntax
 */
type BehaviorFactory<Args extends any[], Instance> = {
  new (...args: Args): Instance;
  (...args: Args): Instance;
};

export function createBehavior<T extends new (...args: any[]) => any>(
  Def: T,
  options?: { autoObservable?: boolean }
): BehaviorFactory<BehaviorArgs<T>, InstanceType<T>> {
  // Internal class that wraps the user's behavior definition
  const BehaviorClass = class extends (Def as any) {
    static [BEHAVIOR_MARKER] = true;

    constructor(...args: any[]) {
      applyMobxActionPolicy();
      super(...args);

      // Call onCreate with args (if it exists). This runs BEFORE
      // makeObservable so the field scan sees the values onCreate assigns
      // (e.g. ref-like objects get observable.ref, preserving identity).
      // watch/effect calls made here are recorded as dormant specs and come
      // alive when the parent commits (activateSpecs in the mount relay) —
      // renders React never commits therefore leak no reactions.
      if (typeof this.onCreate === 'function') {
        this.onCreate(...args);
      }

      // Collect child behaviors declared as fields or assigned in onCreate,
      // mirroring Component behavior collection. The lifecycle relay
      // recurses into these. Underscore-prefixed keys are skipped,
      // consistent with the Component scan.
      const children: BehaviorEntry[] = [];
      for (const key of Object.keys(this)) {
        if (key.startsWith('_')) continue;
        const value = (this as any)[key];
        if (isBehavior(value)) {
          children.push({ instance: value });
        }
      }
      (this as any)._behaviors = children;

      // Make the instance observable (respects global config and per-behavior options)
      const autoObservable = options?.autoObservable ?? globalConfig.autoObservable;
      if (autoObservable) {
        makeBehaviorObservable(this);
      } else {
        // For decorator users: applies decorator metadata
        makeObservable(this);
      }
    }
  };

  // Preserve the original class name for debugging
  Object.defineProperty(BehaviorClass, 'name', { value: Def.name });

  // Use Proxy to make the class callable without `new`
  // This allows both: withWindowSize(768) and new withWindowSize(768)
  return new Proxy(BehaviorClass, {
    apply(_target, _thisArg, args) {
      return new BehaviorClass(...args);
    },
  }) as unknown as BehaviorFactory<BehaviorArgs<T>, InstanceType<T>>;
}


/**
 * Checks if a value is a behavior instance created by createBehavior()
 */
export function isBehavior(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  return (value.constructor as any)?.[BEHAVIOR_MARKER] === true;
}

/**
 * @internal Child behaviors of a behavior instance, or an empty list for
 * plain (non-Behavior-derived) classes that never ran the collection scan.
 */
function childBehaviors(inst: any): BehaviorEntry[] {
  return Array.isArray(inst._behaviors) ? inst._behaviors : [];
}

/**
 * @internal Relay functions recurse into nested behaviors. The visited set
 * guards against cycles (a parent assigned into a child's field); a cycle is
 * simply not relayed twice.
 */
export function layoutMountBehavior(behavior: BehaviorEntry, visited: WeakSet<object> = new WeakSet()): void {
  const inst = behavior.instance;
  if (visited.has(inst)) return;
  visited.add(inst);

  // Children mount before their parent, so the parent's lifecycle can rely
  // on live children.
  for (const child of childBehaviors(inst)) {
    layoutMountBehavior(child, visited);
  }

  // Bring pre-mount watch/effect registrations alive (first mount), or
  // re-create the ones disposed at unmount (StrictMode remount).
  if (Array.isArray(inst._reactiveSpecs)) {
    activateSpecs(inst);
  } else {
    inst._mounted = true;
  }

  if ('onLayoutMount' in inst && typeof inst.onLayoutMount === 'function') {
    try {
      const result = inst.onLayoutMount();
      // Only a returned function is a cleanup; ignore a Promise from an async
      // method so unmount doesn't try to call it.
      behavior.layoutCleanup = typeof result === 'function' ? result : undefined;
    } catch (e) {
      reportError(e, { phase: 'onLayoutMount', name: inst.constructor.name, isBehavior: true });
    }
  }
}

/** @internal */
export function mountBehavior(behavior: BehaviorEntry, visited: WeakSet<object> = new WeakSet()): void {
  const inst = behavior.instance;
  if (visited.has(inst)) return;
  visited.add(inst);

  // Children before parent — mirror of layoutMountBehavior
  for (const child of childBehaviors(inst)) {
    mountBehavior(child, visited);
  }

  if ('onMount' in inst && typeof inst.onMount === 'function') {
    try {
      const result = inst.onMount();
      // Only a returned function is a cleanup; ignore a Promise from an async
      // method so unmount doesn't try to call it.
      behavior.cleanup = typeof result === 'function' ? result : undefined;
    } catch (e) {
      reportError(e, { phase: 'onMount', name: inst.constructor.name, isBehavior: true });
    }
  }
}

/** @internal */
export function unmountBehavior(behavior: BehaviorEntry, visited: WeakSet<object> = new WeakSet()): void {
  const inst = behavior.instance;
  if (visited.has(inst)) return;
  visited.add(inst);

  // Call layout cleanup if exists
  behavior.layoutCleanup?.();

  // Call cleanup if exists
  behavior.cleanup?.();

  // Call onUnmount if exists
  if ('onUnmount' in inst && typeof inst.onUnmount === 'function') {
    try {
      inst.onUnmount();
    } catch (e) {
      reportError(e, { phase: 'onUnmount', name: inst.constructor.name, isBehavior: true });
    }
  }

  // Dispose all watchers
  if (typeof inst._disposeWatchers === 'function') {
    inst._disposeWatchers();
  }

  // Allow a remount with the same instance to resurrect pre-mount watchers
  inst._wasUnmounted = true;

  // Children tear down after their parent's onUnmount, in reverse of mount order
  const children = childBehaviors(inst);
  for (let i = children.length - 1; i >= 0; i--) {
    unmountBehavior(children[i], visited);
  }
}

/**
 * @internal Dev-only: warn about behavior instances sitting in fields that
 * were never collected into the lifecycle relay (assigned after
 * construction — conditionally, lazily, or in a Component's onCreate).
 * Their onMount/watchers/cleanup would otherwise silently never run.
 * Recurses into collected behaviors to catch late-assigned grandchildren.
 */
export function warnUncollectedBehaviors(
  host: object,
  hostName: string,
  entries: BehaviorEntry[],
  visited: WeakSet<object> = new WeakSet()
): void {
  if (visited.has(host)) return;
  visited.add(host);

  const collected = new Set(entries.map((e) => e.instance));
  for (const key of Object.keys(host)) {
    if (key.startsWith('_')) continue;
    const value = (host as any)[key];
    if (isBehavior(value) && !collected.has(value)) {
      console.warn(
        `[mobx-mantle] ${hostName}.${key} holds a behavior that was assigned after ` +
        `construction, so its lifecycle (onMount, watchers, cleanup) will never run. ` +
        `Create behaviors as class fields so they are collected when the host is constructed.`
      );
    }
  }

  for (const entry of entries) {
    warnUncollectedBehaviors(
      entry.instance,
      entry.instance.constructor.name,
      childBehaviors(entry.instance),
      visited
    );
  }
}
