import { makeObservable, observable, computed, action, type AnnotationsMap } from 'mobx';
import { globalConfig, reportError } from './config';

/** Symbol marker to identify behavior instances */
export const BEHAVIOR_MARKER = Symbol('behavior');

// Behavior base class members that should not be made observable
const BEHAVIOR_EXCLUDES = new Set([
  'onCreate',
  'onLayoutMount',
  'onMount',
  'onUnmount',
  'constructor',
]);

/**
 * Base class for behaviors. Provides lifecycle method signatures and IDE autocomplete.
 * Extend this class and wrap with createBehavior().
 * 
 * You can pass arguments either via constructor or onCreate:
 * 
 * @example Constructor args
 * ```tsx
 * class FetchBehavior extends Behavior {
 *   constructor(public url: string, public interval = 5000) {
 *     super();
 *   }
 * }
 * ```
 * 
 * @example onCreate args (no constructor boilerplate)
 * ```tsx
 * class FetchBehavior extends Behavior {
 *   url!: string;
 *   interval = 5000;
 * 
 *   onCreate(url: string, interval = 5000) {
 *     this.url = url;
 *     this.interval = interval;
 *   }
 * }
 * ```
 */
export class Behavior {
  onCreate?(...args: any[]): void;
  onLayoutMount?(): void | (() => void);
  onMount?(): void | (() => void);
  onUnmount?(): void;
}

/**
 * Makes a behavior instance observable, handling inheritance properly.
 * Similar to makeViewObservable but for behaviors.
 */
function makeBehaviorObservable<T extends Behavior>(instance: T): void {
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

    (annotations as any)[key] = observable;
  }

  // Walk prototype chain up to (but not including) Behavior
  let proto = Object.getPrototypeOf(instance);
  while (proto && proto !== Behavior.prototype) {
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
 * Creates a behavior class with automatic observable wrapping and lifecycle management.
 * 
 * Arguments can be passed via constructor OR onCreate - your choice:
 * 
 * @example Constructor args
 * ```tsx
 * class FetchBehavior extends Behavior {
 *   constructor(public url: string, public interval = 5000) {
 *     super();
 *   }
 *   onMount() { ... }
 * }
 * export default createBehavior(FetchBehavior);
 * ```
 * 
 * @example onCreate args (no constructor needed)
 * ```tsx
 * class FetchBehavior extends Behavior {
 *   url!: string;
 *   onCreate(url: string, interval = 5000) {
 *     this.url = url;
 *   }
 *   onMount() { ... }
 * }
 * export default createBehavior(FetchBehavior);
 * ```
 * 
 * Usage in a View - just instantiate:
 * ```tsx
 * class MyView extends View<Props> {
 *   fetcher = new FetchBehavior('/api/items', 3000);
 * }
 * ```
 */
export function createBehavior<T extends new (...args: any[]) => any>(
  Def: T,
  options?: { autoObservable?: boolean }
): new (...args: BehaviorArgs<T>) => InstanceType<T> {
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

  return BehaviorClass as any;
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
}
