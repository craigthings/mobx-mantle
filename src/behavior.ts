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
 * Extend this class and wrap with createBehavior() to create a factory.
 * 
 * @example Defining a behavior
 * ```tsx
 * class FetchTrait extends Behavior {
 *   url!: string;
 *   interval = 5000;
 *   data: Item[] = [];
 *   loading = false;
 * 
 *   onCreate(url: string, interval = 5000) {
 *     this.url = url;
 *     this.interval = interval;
 *   }
 * 
 *   onMount() {
 *     this.fetchData();
 *     const id = setInterval(() => this.fetchData(), this.interval);
 *     return () => clearInterval(id);
 *   }
 * }
 * 
 * export const withFetch = createBehavior(FetchTrait);
 * ```
 * 
 * @example Using in a View
 * ```tsx
 * @view
 * class Dashboard extends View<Props> {
 *   users = withFetch('/api/users', 10000);
 *   posts = withFetch('/api/posts');
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
 * @view
 * class Editor extends View<Props> {
 *   canvas = this.ref<HTMLCanvasElement>();
 *   
 *   // No `new` keyword — factory function
 *   drag = withDrag(this.canvas);
 *   autosave = withAutosave('/api/save', 5000);
 * }
 * ```
 * 
 * The `with` prefix convention signals that the view manages this behavior's lifecycle.
 */
export function createBehavior<T extends new (...args: any[]) => any>(
  Def: T,
  options?: { autoObservable?: boolean }
): (...args: BehaviorArgs<T>) => InstanceType<T> {
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

  // Return a factory function instead of the class
  const factory = (...args: any[]) => new BehaviorClass(...args);
  
  // Preserve name on the factory for debugging
  Object.defineProperty(factory, 'name', { value: Def.name });
  
  return factory as (...args: BehaviorArgs<T>) => InstanceType<T>;
}

/**
 * Class decorator that creates a behavior factory. Alternative to createBehavior().
 * 
 * @example
 * ```tsx
 * import { Behavior, behavior } from 'mobx-mantle';
 * 
 * @behavior
 * export default class withWindowSize extends Behavior {
 *   width = window.innerWidth;
 *   height = window.innerHeight;
 *   
 *   onCreate(breakpoint = 768) {
 *     this.breakpoint = breakpoint;
 *   }
 *   
 *   onMount() {
 *     window.addEventListener('resize', this.handleResize);
 *     return () => window.removeEventListener('resize', this.handleResize);
 *   }
 * }
 * 
 * // Usage: withWindowSize(768)
 * ```
 */
export function behavior<T extends new (...args: any[]) => any>(
  Def: T,
  _context: ClassDecoratorContext
): (...args: BehaviorArgs<T>) => InstanceType<T> {
  return createBehavior(Def);
}

/**
 * Checks if a value is a behavior instance created by createBehavior()/@behavior
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
