import React, { useRef, useEffect, useLayoutEffect, forwardRef as reactForwardRef, memo, type Ref, type JSX } from 'react';
import { makeObservable, observable, computed, runInAction, reaction, autorun, AnnotationsMap, type IObservableValue, _getGlobalState } from 'mobx';
import { useObserver } from 'mobx-react-lite';
import {
  type BehaviorEntry,
  isBehavior,
  layoutMountBehavior,
  mountBehavior,
  unmountBehavior,
} from './behavior';
import { globalConfig, reportError, type WatchOptions, type EffectOptions } from './config';
import { getAnnotations } from './decorators';

/**
 * Creates a bound method that:
 * - Allows observable tracking when called inside a tracking context (render, computed, reaction)
 * - Wraps in runInAction when called outside tracking context (event handlers) for batching
 * 
 * This solves the problem where action-wrapped methods break observable tracking in render helpers.
 */
function smartBind<T extends (...args: any[]) => any>(fn: T, context: any): T {
  return function(this: any, ...args: any[]) {
    const globalState = _getGlobalState();
    const isInTrackingContext = globalState.trackingDerivation !== null;
    
    if (isInTrackingContext) {
      // Inside observer/computed/reaction - allow tracking
      return fn.apply(context, args);
    } else {
      // Outside tracking context (event handler, etc.) - batch mutations
      return runInAction(() => fn.apply(context, args));
    }
  } as T;
}

// Re-export config utilities
export { configure, type MantleConfig, type MantleErrorContext, type WatchOptions, type EffectOptions } from './config';

// Re-export decorators for single-import convenience
export { observable, action, computed } from './decorators';

/** Tracks refs created by Component.ref() — no footprint on the object itself */
const componentRefs = new WeakSet();

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

export class Component<P = {}> {
  /** @internal */
  _propsBox!: IObservableValue<P>;

  constructor(props?: P) {
    this._propsBox = observable.box(props as P, { deep: false });
  }

  get props(): P {
    return this._propsBox.get();
  }

  /** @internal — called by createComponent to silently update props during render */
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
  onUpdate?(): void;
  onUnmount?(): void;

  ref<T extends HTMLElement = HTMLElement>(): { current: T | null } {
    const r = { current: null } as { current: T | null };
    componentRefs.add(r);
    return r;
  }

  /**
   * Register a cleanup function to run automatically on unmount.
   * Returns a function that can be called for early cleanup.
   */
  addCleanup(cleanup: () => void): () => void {
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

    return this.addCleanup(dispose);
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
   *     document.title = `${this.items.length} items`;
   *   });
   * }
   * ```
   * 
   * @example With cleanup
   * ```tsx
   * onCreate() {
   *   this.effect(() => {
   *     const handler = () => console.log(this.count);
   *     window.addEventListener('click', handler);
   *     return () => window.removeEventListener('click', handler);
   *   });
   * }
   * ```
   */
  effect(
    fn: () => void | (() => void),
    options?: EffectOptions
  ): () => void {
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
          reportError(e, { phase: 'effect', name: this.constructor.name, isBehavior: false });
        }
      },
      { delay: options?.delay }
    );

    return this.addCleanup(() => {
      cleanup?.();
      dispose();
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

/** Alias for Component - use when separating ViewModel from template */
export { Component as ViewModel };

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
  'onUpdate',
  'onUnmount',
  'render', 
  'ref',
  'addCleanup',
  'watch',
  'effect',
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
 * Detects if a value is a ref created by Component.ref()
 * These should use observable.ref to preserve object identity for React
 */
function isComponentRef(value: unknown): boolean {
  return value !== null && typeof value === 'object' && componentRefs.has(value as object);
}

/**
 * Creates observable annotations for a Component subclass instance.
 * This is needed because makeAutoObservable doesn't work with inheritance.
 */
function makeComponentObservable<T extends Component>(instance: T, autoBind: boolean) {
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

    // Use observable.ref for Component.ref() objects to preserve identity
    if (isComponentRef(value)) {
      (annotations as any)[key] = observable.ref;
    } else {
      (annotations as any)[key] = observable;
    }
  }

  // Collect methods to bind (but not wrap in action - actions break observable tracking)
  const methodsToBind: string[] = [];

  // Walk prototype chain up to (but not including) Component
  let proto = Object.getPrototypeOf(instance);
  while (proto && proto !== Component.prototype) {
    const descriptors = Object.getOwnPropertyDescriptors(proto);

    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (BASE_EXCLUDES.has(key)) continue;
      if (key in annotations) continue;

      if (descriptor.get) {
        // Getter → computed
        (annotations as any)[key] = computed;
      } else if (typeof descriptor.value === 'function') {
        // Methods: don't wrap in action (breaks observable tracking in render helpers)
        // Just collect for manual binding after makeObservable
        if (autoBind) {
          methodsToBind.push(key);
        }
        // Skip annotation - leave as plain function
      }
    }

    proto = Object.getPrototypeOf(proto);
  }

  makeObservable(instance, annotations);

  // Use smartBind: allows tracking in render context, batches mutations elsewhere
  for (const key of methodsToBind) {
    const method = (instance as any)[key];
    if (typeof method === 'function') {
      (instance as any)[key] = smartBind(method, instance);
    }
  }
}

type PropsOf<C> = C extends Component<infer P> ? P : object;

/**
 * Return type for createComponent.
 * 
 * Simple callable signature that works with libraries expecting ComponentType<P>
 * or strict function components (react-window, react-virtualized, etc.).
 * 
 * Uses ReactElement | null rather than React.FC's looser ReactNode return type.
 */
export type MantleComponent<P> = (props: P) => React.ReactElement | null;

/**
 * Return type for createForwardRef when you need typed ref forwarding.
 * 
 * Use this when you need to forward refs to DOM elements or child components
 * and want TypeScript to know the ref type.
 */
export type ForwardRefMantleComponent<P, RefType> = 
  ((props: P) => React.ReactElement | null) &
  React.ForwardRefExoticComponent<
    React.PropsWithoutRef<P> & React.RefAttributes<RefType>
  >;

export function createComponent<C extends Component<any>>(
  ComponentClass: new (...args: any[]) => C,
  templateOrOptions?: ((vm: C) => JSX.Element) | { autoObservable?: boolean }
) {
  type P = PropsOf<C>;

  const template = typeof templateOrOptions === 'function' ? templateOrOptions : undefined;
  const options = typeof templateOrOptions === 'object' ? templateOrOptions : {};
  const { autoObservable = globalConfig.autoObservable } = options;

  const ReactComponent = reactForwardRef<unknown, P>((props, ref) => {
    const vmRef = useRef<C | null>(null);
    const classRef = useRef(ComponentClass);
    const prevPropsRef = useRef<P | null>(null);
    const propsNotifyingRef = useRef(false);

    // HMR: class identity changes when the module re-executes, but useRef
    // values survive (React Fast Refresh preserves hooks). On detection,
    // we simply discard the old instance and create fresh — clean slate.
    // In production this check is always false (class identity is stable).
    if (vmRef.current && classRef.current !== ComponentClass) {
      classRef.current = ComponentClass;
      vmRef.current = null;
    }

    if (!vmRef.current) {
      const instance = new ComponentClass(props as P);
      instance.forwardRef = ref;

      // Collect behavior instances from properties (must happen before makeObservable)
      instance._collectBehaviors();

      // Check for Mantle decorator annotations first
      const decoratorAnnotations = getAnnotations(instance);
      
      if (decoratorAnnotations) {
        // Mantle decorators: use collected annotations
        const annotations = { ...decoratorAnnotations };
        const methodsToBind: string[] = [];
        
        // Walk prototype chain to find methods not explicitly decorated
        let proto = Object.getPrototypeOf(instance);
        while (proto && proto !== Component.prototype) {
          const descriptors = Object.getOwnPropertyDescriptors(proto);
          for (const [key, descriptor] of Object.entries(descriptors)) {
            if (BASE_EXCLUDES.has(key)) continue;
            if (key in annotations) continue;
            if (typeof descriptor.value === 'function') {
              // Don't wrap in action (breaks observable tracking in render helpers)
              // Just collect for manual binding
              methodsToBind.push(key);
            }
          }
          proto = Object.getPrototypeOf(proto);
        }
        
        makeObservable(instance, annotations as AnnotationsMap<C, never>);

        // Manually bind methods to preserve `this` without action wrapper
        // Use smartBind: allows tracking in render context, batches mutations elsewhere
        for (const key of methodsToBind) {
          const method = (instance as any)[key];
          if (typeof method === 'function') {
            (instance as any)[key] = smartBind(method, instance);
          }
        }
      } else if (autoObservable) {
        makeComponentObservable(instance, true);
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
        `[mobx-mantle] ${ComponentClass.name}: A reaction to a prop change modified ` +
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
            `[mobx-mantle] ${ComponentClass.name}.onLayoutMount() returned a Promise. ` +
            `Lifecycle methods must be synchronous. Use a sync onLayoutMount that ` +
            `calls an async method instead.`
          );
        }
        cleanup = result as (() => void) | undefined;
      } catch (e) {
        reportError(e, { phase: 'onLayoutMount', name: ComponentClass.name, isBehavior: false });
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
            `[mobx-mantle] ${ComponentClass.name}.onMount() returned a Promise. ` +
            `Lifecycle methods must be synchronous. Use a sync onMount that ` +
            `calls an async method instead.`
          );
        }
        cleanup = result as (() => void) | undefined;
      } catch (e) {
        reportError(e, { phase: 'onMount', name: ComponentClass.name, isBehavior: false });
      }
      return () => {
        cleanup?.();
        try {
          vm.onUnmount?.();
        } catch (e) {
          reportError(e, { phase: 'onUnmount', name: ComponentClass.name, isBehavior: false });
        }
        vm._disposeWatchers();
        vm._unmountBehaviors();
      };
    }, [vm]);

    // Called after every render (via useEffect)
    useEffect(() => {
      try {
        vm.onUpdate?.();
      } catch (e) {
        reportError(e, { phase: 'onUpdate', name: ComponentClass.name, isBehavior: false });
      }
    });

    if (!template && !vm.render) {
      throw new Error(
        `[mobx-mantle] ${ComponentClass.name}: Missing render() method. Either define render() in your Component class or pass a template function to createComponent().`
      );
    }

    // Only the render call is tracked by MobX (useObserver).
    return useObserver(() => {
      return template ? template(vm) : vm.render!();
    });
  });

  // Wrap in React.memo to match observer()'s behavior — skip re-renders
  // when parent re-renders but props haven't changed (shallow comparison).
  return memo(ReactComponent) as MantleComponent<P>;
}

/**
 * Creates a React component with typed ref forwarding.
 * 
 * Use this instead of createComponent when you need to forward refs to DOM elements
 * or child components and want proper TypeScript support for the ref type.
 * 
 * @example
 * ```tsx
 * class FancyInput extends Component<Props> {
 *   render() {
 *     return <input ref={this.forwardRef} className="fancy" />;
 *   }
 * }
 * 
 * const FancyInputComponent = createForwardRef<HTMLInputElement>(FancyInput);
 * 
 * // Parent gets typed ref:
 * const inputRef = useRef<HTMLInputElement>(null);
 * <FancyInputComponent ref={inputRef} />
 * ```
 */
export function createForwardRef<RefType, C extends Component<any> = Component<any>>(
  ComponentClass: new (...args: any[]) => C,
  templateOrOptions?: ((vm: C) => JSX.Element) | { autoObservable?: boolean }
): ForwardRefMantleComponent<PropsOf<C>, RefType> {
  // Same implementation as createComponent - the runtime behavior is identical.
  // Only the return type differs to provide proper ref typing.
  return createComponent(ComponentClass, templateOrOptions) as ForwardRefMantleComponent<PropsOf<C>, RefType>;
}
