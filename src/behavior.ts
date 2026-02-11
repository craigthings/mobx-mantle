import { makeObservable, observable, computed, action, reaction, type AnnotationsMap } from 'mobx';
import { globalConfig, reportError, type WatchOptions } from './config';

/** Symbol marker to identify behavior instances */
export const BEHAVIOR_MARKER = Symbol('behavior');

// Behavior base class members that should not be made observable
const BEHAVIOR_EXCLUDES = new Set([
  'onCreate',
  'onLayoutMount',
  'onMount',
  'onUnmount',
  'watch',
  'constructor',
  '_watchDisposers',
  '_disposeWatchers',
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

  onCreate?(...args: any[]): void;
  onLayoutMount?(): void | (() => void);
  onMount?(): void | (() => void);
  onUnmount?(): void;

  /**
   * Watch a reactive expression and run a callback when it changes.
   * Automatically disposed on unmount.
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

    this._watchDisposers.push(dispose);

    // Return a dispose function that also removes from the array
    return () => {
      dispose();
      const idx = this._watchDisposers.indexOf(dispose);
      if (idx !== -1) this._watchDisposers.splice(idx, 1);
    };
  }

  /** @internal */
  _disposeWatchers(): void {
    for (const dispose of this._watchDisposers) {
      dispose();
    }
    this._watchDisposers.length = 0;
  }
}

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

    // Use observable.ref for ref-like objects to preserve identity
    if (isRefLike(value)) {
      (annotations as any)[key] = observable.ref;
    } else {
      (annotations as any)[key] = observable;
    }
  }

  // Walk prototype chain up to (but not including) Behavior or Object
  let proto = Object.getPrototypeOf(instance);
  while (proto && proto !== Behavior.prototype && proto !== Object.prototype) {
    const descriptors = Object.getOwnPropertyDescriptors(proto);

    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (BEHAVIOR_EXCLUDES.has(key)) continue;
      if (key in annotations) continue;

      if (descriptor.get) {
        (annotations as any)[key] = computed;
      } else if (typeof descriptor.value === 'function') {
        (annotations as any)[key] = action.bound;
      }
    }

    proto = Object.getPrototypeOf(proto);
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
 * @example Using in a View
 * ```tsx
 * class Editor extends View<Props> {
 *   canvas = this.ref<HTMLCanvasElement>();
 *   
 *   // No `new` keyword — factory function
 *   drag = withDrag(this.canvas);
 *   autosave = withAutosave('/api/save', 5000);
 * }
 * export default createView(Editor);
 * ```
 * 
 * The `with` prefix convention signals that the view manages this behavior's lifecycle.
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
      super(...args);
      
      // Call onCreate with args (if it exists)
      if (typeof this.onCreate === 'function') {
        this.onCreate(...args);
      }
      
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

/** @internal */
export function layoutMountBehavior(behavior: BehaviorEntry): void {
  const inst = behavior.instance;

  if ('onLayoutMount' in inst && typeof inst.onLayoutMount === 'function') {
    try {
      behavior.layoutCleanup = inst.onLayoutMount() ?? undefined;
    } catch (e) {
      reportError(e, { phase: 'onLayoutMount', name: inst.constructor.name, isBehavior: true });
    }
  }
}

/** @internal */
export function mountBehavior(behavior: BehaviorEntry): void {
  const inst = behavior.instance;

  if ('onMount' in inst && typeof inst.onMount === 'function') {
    try {
      behavior.cleanup = inst.onMount() ?? undefined;
    } catch (e) {
      reportError(e, { phase: 'onMount', name: inst.constructor.name, isBehavior: true });
    }
  }
}

/** @internal */
export function unmountBehavior(behavior: BehaviorEntry): void {
  // Call layout cleanup if exists
  behavior.layoutCleanup?.();

  // Call cleanup if exists
  behavior.cleanup?.();

  // Call onUnmount if exists
  const inst = behavior.instance;
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
}
