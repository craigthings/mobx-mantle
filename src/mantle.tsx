import { useRef, useEffect, useLayoutEffect, forwardRef as reactForwardRef, memo, type Ref, type JSX } from 'react';
import { makeObservable, observable, computed, action, runInAction, reaction, AnnotationsMap, type IObservableValue } from 'mobx';
import { useObserver } from 'mobx-react-lite';
import {
  type BehaviorEntry,
  isBehavior,
  layoutMountBehavior,
  mountBehavior,
  unmountBehavior,
} from './behavior';
import { globalConfig, reportError, type WatchOptions } from './config';
import { getAnnotations } from './decorators';

// Re-export config utilities
export { configure, type MantleConfig, type MantleErrorContext, type WatchOptions } from './config';

// Re-export decorators for single-import convenience
export { observable, action, computed } from './decorators';

/** Tracks refs created by View.ref() — no footprint on the object itself */
const viewRefs = new WeakSet();

/** Shallow-compare two objects by own enumerable keys */
function shallowEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

export class View<P = {}> {
  /** @internal */
  _propsBox!: IObservableValue<P>;

  get props(): P {
    return this._propsBox.get();
  }

  /** @internal — called by createView to silently update props during render */
  _syncProps(value: P) {
    // Directly set the internal value without triggering MobX notifications.
    // React renders the component tree synchronously — if we used runInAction
    // here, endBatch() would flush reactions and try to update other observer
    // components while React is still rendering, causing:
    //   "Cannot update component A while rendering component B"
    //
    // The value is updated so this._propsBox.get() returns the correct value
    // during render. Reactions are notified separately in useLayoutEffect.
    (this._propsBox as any).value_ = value;
  }

  forwardRef?: Ref<any>;

  /** @internal */
  _behaviors: BehaviorEntry[] = [];

  /** @internal */
  _watchDisposers: (() => void)[] = [];

  onCreate?(props: P): void;
  onLayoutMount?(): void | (() => void);
  onMount?(): void | (() => void);
  onUpdated?(): void;
  onUnmount?(): void;

  ref<T extends HTMLElement = HTMLElement>(): { current: T | null } {
    const r = { current: null } as { current: T | null };
    viewRefs.add(r);
    return r;
  }

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
   * onCreate() {
   *   this.watch(
   *     () => this.query,
   *     async (query) => {
   *       if (query.length > 2) {
   *         this.results = await searchApi(query);
   *       }
   *     },
   *     { delay: 300 }
   *   );
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
          reportError(e, { phase: 'watch', name: this.constructor.name, isBehavior: false });
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

  /** @internal - Scan own properties for behavior instances and register them */
  _collectBehaviors(): void {
    for (const key of Object.keys(this)) {
      if (key.startsWith('_')) continue;
      const value = (this as any)[key];
      if (isBehavior(value)) {
        this._behaviors.push({ instance: value });
      }
    }
  }

  /** @internal */
  _layoutMountBehaviors(): void {
    for (const behavior of this._behaviors) {
      layoutMountBehavior(behavior);
    }
  }

  /** @internal */
  _mountBehaviors(): void {
    for (const behavior of this._behaviors) {
      mountBehavior(behavior);
    }
  }

  /** @internal */
  _unmountBehaviors(): void {
    for (const behavior of this._behaviors) {
      unmountBehavior(behavior);
    }
  }

  render?(): JSX.Element | null;
}

/** Alias for View - use when separating ViewModel from template */
export { View as ViewModel };

// Re-export from behavior module
export { createBehavior, Behavior } from './behavior';

// Base class members that should not be made observable
const BASE_EXCLUDES = new Set([
  'props',
  '_propsBox',
  'forwardRef', 
  'onCreate',
  'onLayoutMount',
  'onMount', 
  'onUpdated',
  'onUnmount',
  'render', 
  'ref',
  'watch',
  'constructor',
  '_behaviors',
  '_collectBehaviors',
  '_layoutMountBehaviors',
  '_mountBehaviors',
  '_unmountBehaviors',
  '_syncProps',
  '_watchDisposers',
  '_disposeWatchers',
]);

/**
 * Detects if a value is a ref created by View.ref()
 * These should use observable.ref to preserve object identity for React
 */
function isViewRef(value: unknown): boolean {
  return value !== null && typeof value === 'object' && viewRefs.has(value as object);
}

/**
 * Creates observable annotations for a View subclass instance.
 * This is needed because makeAutoObservable doesn't work with inheritance.
 */
function makeViewObservable<T extends View>(instance: T, autoBind: boolean) {
  const annotations: AnnotationsMap<T, never> = {} as AnnotationsMap<T, never>;

  // Collect own properties (instance state) → observable
  // Also check prototype for class field declarations (handles uninitialized fields)
  const ownKeys = new Set([
    ...Object.keys(instance),
    ...Object.keys(Object.getPrototypeOf(instance)),
  ]);

  for (const key of ownKeys) {
    if (BASE_EXCLUDES.has(key)) continue;
    if (key in annotations) continue;

    const value = (instance as any)[key];

    // Skip functions (these are handled in the prototype walk)
    if (typeof value === 'function') continue;

    // Skip behavior instances (they're already observable)
    if (isBehavior(value)) {
      (annotations as any)[key] = observable.ref;
      continue;
    }

    // Use observable.ref for View.ref() objects to preserve identity
    if (isViewRef(value)) {
      (annotations as any)[key] = observable.ref;
    } else {
      (annotations as any)[key] = observable;
    }
  }

  // Walk prototype chain up to (but not including) View
  let proto = Object.getPrototypeOf(instance);
  while (proto && proto !== View.prototype) {
    const descriptors = Object.getOwnPropertyDescriptors(proto);

    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (BASE_EXCLUDES.has(key)) continue;
      if (key in annotations) continue;

      if (descriptor.get) {
        // Getter → computed
        (annotations as any)[key] = computed;
      } else if (typeof descriptor.value === 'function') {
        // Method → action (optionally bound)
        (annotations as any)[key] = autoBind ? action.bound : action;
      }
    }

    proto = Object.getPrototypeOf(proto);
  }

  makeObservable(instance, annotations);
}

type PropsOf<V> = V extends View<infer P> ? P : object;

export function createView<V extends View<any>>(
  ViewClass: new () => V,
  templateOrOptions?: ((vm: V) => JSX.Element) | { autoObservable?: boolean }
) {
  type P = PropsOf<V>;

  const template = typeof templateOrOptions === 'function' ? templateOrOptions : undefined;
  const options = typeof templateOrOptions === 'object' ? templateOrOptions : {};
  const { autoObservable = globalConfig.autoObservable } = options;

  const Component = reactForwardRef<unknown, P>((props, ref) => {
    const vmRef = useRef<V | null>(null);
    const classRef = useRef(ViewClass);
    const prevPropsRef = useRef<P | null>(null);
    const propsNotifyingRef = useRef(false);

    // HMR: class identity changes when the module re-executes, but useRef
    // values survive (React Fast Refresh preserves hooks). On detection,
    // we simply discard the old instance and create fresh — clean slate.
    // In production this check is always false (class identity is stable).
    if (vmRef.current && classRef.current !== ViewClass) {
      classRef.current = ViewClass;
      vmRef.current = null;
    }

    if (!vmRef.current) {
      const instance = new ViewClass();

      // Props is always reactive via observable.box (works with all decorator modes)
      instance._propsBox = observable.box(props, { deep: false });
      instance.forwardRef = ref;

      // Collect behavior instances from properties (must happen before makeObservable)
      instance._collectBehaviors();

      // Check for Mantle decorator annotations first
      const decoratorAnnotations = getAnnotations(instance);
      
      if (decoratorAnnotations) {
        // Mantle decorators: use collected annotations
        // Auto-bind all methods for stable `this` references
        const annotations = { ...decoratorAnnotations };
        
        // Walk prototype chain to auto-bind methods not explicitly decorated
        let proto = Object.getPrototypeOf(instance);
        while (proto && proto !== View.prototype) {
          const descriptors = Object.getOwnPropertyDescriptors(proto);
          for (const [key, descriptor] of Object.entries(descriptors)) {
            if (BASE_EXCLUDES.has(key)) continue;
            if (key in annotations) continue;
            if (typeof descriptor.value === 'function') {
              annotations[key] = action.bound;
            }
          }
          proto = Object.getPrototypeOf(proto);
        }
        
        makeObservable(instance, annotations as AnnotationsMap<V, never>);
      } else if (autoObservable) {
        makeViewObservable(instance, true);
      } else {
        // For legacy decorator users: applies decorator metadata
        makeObservable(instance);
      }

      // Proxy forwards property access to instance.props, so reads are tracked
      // by MobX when used in reactions/computeds (same behavior as this.props)
      const reactiveProps = new Proxy({} as P, {
        get: (_, key) => (instance.props as any)[key],
        has: (_, key) => key in (instance.props as any),
        ownKeys: () => Reflect.ownKeys(instance.props as object),
        getOwnPropertyDescriptor: (_, key) =>
          Reflect.getOwnPropertyDescriptor(instance.props as object, key),
      });
      instance.onCreate?.(reactiveProps);
      vmRef.current = instance;
      prevPropsRef.current = props as P;
    }

    const vm = vmRef.current;

    // Dev warning: detect when a prop-triggered reaction causes a re-render.
    // This means a reaction is being used for derived state — a computed getter
    // would avoid the double render.
    if (process.env.NODE_ENV !== 'production' && propsNotifyingRef.current) {
      console.warn(
        `[mobx-mantle] ${ViewClass.name}: A reaction to a prop change modified ` +
        `observable state, which caused an extra re-render. Consider using a ` +
        `computed getter instead.`
      );
      propsNotifyingRef.current = false;
    }

    // Silently update _propsBox.value_ so this.props returns the correct value
    // during render, without triggering MobX reactions (which would cause
    // "Cannot update component A while rendering component B").
    vm._syncProps(props as P);
    vm.forwardRef = ref;

    // After render completes, properly notify MobX observers of prop changes.
    // This enables reaction(() => this.props.x, ...) in lifecycle methods.
    // useLayoutEffect runs after React finishes the render pass, so it's safe
    // to flush reactions here.
    useLayoutEffect(() => {
      if (!shallowEqual(prevPropsRef.current, props)) {
        prevPropsRef.current = props as P;
        propsNotifyingRef.current = true;
        runInAction(() => {
          vm._propsBox.set(props);
        });
        // If a reaction triggered a synchronous re-render, the warning
        // already fired above. Clear the flag for the normal case.
        propsNotifyingRef.current = false;
      }
    });

    // [vm] dep ensures effects re-run when instance changes (HMR).
    // On normal renders vm is stable, so effects run once — same as [].
    useLayoutEffect(() => {
      vm._layoutMountBehaviors();
      let cleanup: (() => void) | undefined;
      try {
        const result = vm.onLayoutMount?.();
        if (process.env.NODE_ENV !== 'production' && result instanceof Promise) {
          console.error(
            `[mobx-mantle] ${ViewClass.name}.onLayoutMount() returned a Promise. ` +
            `Lifecycle methods must be synchronous. Use a sync onLayoutMount that ` +
            `calls an async method instead.`
          );
        }
        cleanup = result as (() => void) | undefined;
      } catch (e) {
        reportError(e, { phase: 'onLayoutMount', name: ViewClass.name, isBehavior: false });
      }
      return () => {
        cleanup?.();
      };
    }, [vm]);

    useEffect(() => {
      vm._mountBehaviors();
      let cleanup: (() => void) | undefined;
      try {
        const result = vm.onMount?.();
        if (process.env.NODE_ENV !== 'production' && result instanceof Promise) {
          console.error(
            `[mobx-mantle] ${ViewClass.name}.onMount() returned a Promise. ` +
            `Lifecycle methods must be synchronous. Use a sync onMount that ` +
            `calls an async method instead.`
          );
        }
        cleanup = result as (() => void) | undefined;
      } catch (e) {
        reportError(e, { phase: 'onMount', name: ViewClass.name, isBehavior: false });
      }
      return () => {
        cleanup?.();
        try {
          vm.onUnmount?.();
        } catch (e) {
          reportError(e, { phase: 'onUnmount', name: ViewClass.name, isBehavior: false });
        }
        vm._disposeWatchers();
        vm._unmountBehaviors();
      };
    }, [vm]);

    // Called after every render (via useEffect)
    useEffect(() => {
      try {
        vm.onUpdated?.();
      } catch (e) {
        reportError(e, { phase: 'onUpdated', name: ViewClass.name, isBehavior: false });
      }
    });

    if (!template && !vm.render) {
      throw new Error(
        `[mobx-mantle] ${ViewClass.name}: Missing render() method. Either define render() in your View class or pass a template function to createView().`
      );
    }

    // Only the render call is tracked by MobX (useObserver).
    return useObserver(() => {
      return template ? template(vm) : vm.render!();
    });
  });

  // Wrap in React.memo to match observer()'s behavior — skip re-renders
  // when parent re-renders but props haven't changed (shallow comparison).
  return memo(Component) as typeof Component;
}

