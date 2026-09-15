import { ServiceContext, captureServiceScope, resolveService, isServiceValue, withServiceScope, withOwnerServiceScope, type ServiceToken } from './services';
import { ModelContext, isModel, setModelIdentity } from './model-scope';
import React, { useRef, useEffect, forwardRef as reactForwardRef, memo, type Ref, type JSX } from 'react';
import { makeObservable, observable, computed, runInAction, reaction, autorun, type AnnotationsMap, createAtom, isObservableProp, type IAtom, _getGlobalState } from 'mobx';
import { useMantleObserver, useIsomorphicLayoutEffect, type RenderReactionHolder } from './observer';
import {
  type BehaviorEntry,
  isBehavior,
  layoutMountBehavior,
  mountBehavior,
  unmountBehavior,
  warnUncollectedBehaviors,
} from './behavior';
import { globalConfig, reportError, applyMobxActionPolicy, type WatchOptions, type EffectOptions } from './config';
import { getAnnotations } from './decorators';
import {
  type ReactiveSpec,
  type ProtoInfo,
  registerReactive,
  activateSpecs,
  collectProtoInfo,
  smartBind,
  toWatchExpression,
} from './internals';
import type { MaybeGetter } from './reactive-args';

// Re-export config utilities
export { configure, type MantleConfig, type MantleErrorContext, type WatchOptions, type EffectOptions } from './config';

// Re-export decorators for single-import convenience
export { observable, action, computed } from './decorators';

/** Tracks refs created by Component.ref() — no footprint on the object itself */
const componentRefs = new WeakSet();

/**
 * A stable, wrapper-owned reference to the currently mounted Mantle instance.
 * The object identity survives an HMR instance replacement so descendants do
 * not retain the discarded model.
 */
interface ComponentHandle {
  current: Component<any> | undefined;
}

/** Carries the nearest logical Mantle ancestor without adding a DOM wrapper. */
const ComponentParentContext = React.createContext<ComponentHandle | undefined>(undefined);

/** Runtime-only ancestry — deliberately absent from observable/serialized state. */
const componentParents = new WeakMap<Component<any>, ComponentHandle | undefined>();

interface ComponentConstructionScope {
  expectedClass: Function;
  parentHandle: ComponentHandle | undefined;
  consumed: boolean;
}

/**
 * React supplies context before the model exists, while derived field
 * initializers run immediately after super(). This short-lived scope bridges
 * those two moments without changing public constructor signatures.
 */
let activeComponentConstruction: ComponentConstructionScope | undefined;

function constructComponent<C extends Component<any>>(
  ComponentClass: new (...args: any[]) => C,
  props: unknown,
  parentHandle: ComponentHandle | undefined
): C {
  const previousScope = activeComponentConstruction;
  const scope: ComponentConstructionScope = {
    expectedClass: ComponentClass,
    parentHandle,
    consumed: false,
  };

  activeComponentConstruction = scope;
  try {
    return new ComponentClass(props);
  } finally {
    activeComponentConstruction = previousScope;
  }
}

function captureConstructingComponentParent(instance: Component<any>): void {
  const scope = activeComponentConstruction;
  if (
    !scope ||
    scope.consumed ||
    instance.constructor !== scope.expectedClass
  ) {
    return;
  }

  scope.consumed = true;
  componentParents.set(instance, scope.parentHandle);
}

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

/**
 * Props holder built on MobX's public atom API. Reads are tracked like any
 * observable. Writes come in two flavors:
 * - setSilently: update the value without notifying observers — safe during
 *   React's render phase (see Component._syncProps)
 * - set: update and notify observers — called from useLayoutEffect after
 *   React finishes the render pass
 */
class PropsBox<P> {
  private _atom: IAtom;
  private _value: P;

  /**
   * @internal The owning component's render reaction. Reads coming from it
   * are not tracked: React already re-renders the component on prop change
   * (via memo), so letting the render reaction observe the props atom would
   * only schedule a redundant second render after every prop change.
   * Computeds, watchers, and other components track normally.
   */
  _renderReaction: RenderReactionHolder | null = null;

  constructor(value: P, name: string) {
    this._value = value;
    this._atom = createAtom(name);
  }

  get(): P {
    const own = this._renderReaction?.current;
    if (!own || _getGlobalState().trackingDerivation !== own) {
      this._atom.reportObserved();
    }
    return this._value;
  }

  setSilently(value: P): void {
    this._value = value;
  }

  set(value: P): void {
    this._value = value;
    this._atom.reportChanged();
  }
}

export type ComponentConstructor<C extends Component<any> = Component<any>> =
  abstract new (...args: any[]) => C;

export class Component<P = {}> {
  /** @internal */
  _propsBox!: PropsBox<P>;

  constructor(props?: P) {
    this._propsBox = new PropsBox(props as P, `${this.constructor.name}.props`);
    captureConstructingComponentParent(this);
    captureServiceScope(this);
  }

  get props(): P {
    return this._propsBox.get();
  }

  /** Resolve through the scope captured during construction; preserve service identity. */
  getService<T extends object>(token: ServiceToken<T>): T { return resolveService(this, token); }

  /** Return the immediate ancestor in the live Mantle view tree. */
  getParent(): Component<any> | undefined {
    return componentParents.get(this)?.current;
  }

  /** Find the nearest parent with the supplied logical model identity. */
  findParent<C extends Component<any>>(
    type: ComponentConstructor<C>
  ): C | undefined {
    for (const parent of this.getParents()) {
      if (isModel(parent, type)) return parent;
    }
    return undefined;
  }

  /** Return all Mantle parents, ordered from the immediate parent to the root. */
  getParents(): readonly Component<any>[] {
    const parents: Component<any>[] = [];
    let current = this.getParent();
    while (current) {
      parents.push(current);
      current = current.getParent();
    }
    return parents;
  }

  /** Return the highest Mantle ancestor, or this instance when already root. */
  getRoot(): Component<any> {
    const parents = this.getParents();
    return parents[parents.length - 1] ?? this;
  }

  /** @internal — called by createComponent to silently update props during render */
  _syncProps(value: P) {
    // Update the value without triggering MobX notifications. React renders
    // the component tree synchronously — if we notified here, MobX would
    // flush reactions and try to update other observer components while
    // React is still rendering, causing:
    //   "Cannot update component A while rendering component B"
    //
    // The value is updated so this._propsBox.get() returns the correct value
    // during render. Observers are notified separately in useLayoutEffect.
    this._propsBox.setSilently(value);
  }

  forwardRef?: Ref<any>;

  /** @internal */
  _behaviors: BehaviorEntry[] = [];

  /** @internal */
  _watchDisposers: (() => void)[] = [];

  /** @internal — pre-mount watch/effect registrations, materialized at mount */
  _reactiveSpecs: ReactiveSpec[] = [];

  /** @internal — true after the first (layout) mount */
  _mounted = false;

  /** @internal — set when effects clean up so StrictMode replay can resurrect watchers */
  _wasUnmounted = false;

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
   *
   * Cleanups are one-shot: they are not re-created during React StrictMode's
   * same-instance effect replay. Call this from onMount (which is replayed),
   * or use effect() for a replay-safe setup/teardown pair.
   */
  addCleanup(cleanup: () => void): () => void {
    if (process.env.NODE_ENV !== 'production' && !this._mounted) {
      console.warn(
        `[mobx-mantle] ${this.constructor.name}.addCleanup() called before mount. ` +
        `Cleanups are one-shot: they run when mount effects clean up and are not ` +
        `re-created during React StrictMode's same-instance effect replay. Acquire ` +
        `resources in onMount(), or use effect() for a replay-safe setup/teardown pair.`
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
        runInAction(cleanup);
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
   * Automatically disposed on unmount. Watchers declared before mount
   * (field initializers, onCreate) are re-created during React StrictMode's
   * same-instance effect replay.
   *
   * @param source - Reactive expression (getter) to watch, or a MaybeGetter
   *   argument passed through as-is. To watch a value that is itself a
   *   function, wrap it: `watch(() => this.callback, …)`
   * @param callback - Called when the expression result changes
   * @param options - Optional configuration (delay, fireImmediately)
   * @returns Dispose function for early teardown
   * 
   * @example
   * ```tsx
   * onMount() {
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
    source: MaybeGetter<T>,
    callback: (value: T, prevValue: T | undefined) => void,
    options?: WatchOptions
  ): () => void {
    // A function is the tracked expression; a plain value is a constant
    // (dev-warns unless fireImmediately — a constant watch can never fire).
    // To watch a value that IS a function, wrap it: watch(() => this.callback, …)
    const expr = toWatchExpression(source, options?.fireImmediately, this.constructor.name);
    return registerReactive(this, () => {
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

      return this._addCleanup(dispose);
    });
  }

  /**
   * Run a side effect that auto-tracks reactive dependencies.
   * Re-runs whenever any accessed observable changes.
   * Automatically disposed on unmount. Effects declared before mount
   * (field initializers, onCreate) are re-created during React StrictMode's
   * same-instance effect replay.
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
   * onMount() {
   *   this.effect(() => {
   *     document.title = `${this.items.length} items`;
   *   });
   * }
   * ```
   *
   * @example With cleanup
   * ```tsx
   * onMount() {
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
    return registerReactive(this, () => {
      let cleanup: (() => void) | undefined;

      const dispose = autorun(
        () => {
          // Run previous cleanup before re-running effect
          runInAction(() => cleanup?.());
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

      return this._addCleanup(() => {
        runInAction(() => cleanup?.());
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

  /** @internal - Scan own properties for behavior instances and register them */
  _collectBehaviors(): void {
    for (const key of Object.keys(this)) {
      if (key.startsWith('_')) continue;
      const value = (this as any)[key];
      if (isBehavior(value) && !isServiceValue(this, value)) {
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
  'getParent',
  'findParent',
  'getParents',
  'getRoot',
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
  '_addCleanup',
  'watch',
  'effect',
  'constructor',
  'getService',
  '_behaviors',
  '_collectBehaviors',
  '_layoutMountBehaviors',
  '_mountBehaviors',
  '_unmountBehaviors',
  '_syncProps',
  '_watchDisposers',
  '_disposeWatchers',
  '_reactiveSpecs',
  '_mounted',
  '_wasUnmounted',
]);

/**
 * Detects if a value is a ref created by Component.ref()
 * These should use observable.ref to preserve object identity for React
 */
function isComponentRef(value: unknown): boolean {
  return value !== null && typeof value === 'object' && componentRefs.has(value as object);
}

/** Per-class cache of prototype-derived info (getters, methods) */
const componentProtoInfo = new WeakMap<Function, ProtoInfo>();

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

    // Skip functions (these are handled via the prototype info)
    if (typeof value === 'function' || isServiceValue(instance, value)) continue;

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

  // Prototype facts (getters → computed, methods to bind) are identical for
  // every instance of a class, so they're collected once and cached per class.
  const protoInfo = collectProtoInfo(instance, Component.prototype, BASE_EXCLUDES, componentProtoInfo);

  for (const key of protoInfo.computedKeys) {
    if (key in annotations) continue;
    (annotations as any)[key] = computed;
  }

  makeObservable(instance, annotations);

  // Methods: don't wrap in action (breaks observable tracking in render helpers).
  // Use smartBind: allows tracking in render context, batches mutations elsewhere.
  if (autoBind) {
    for (const key of protoInfo.methodKeys) {
      if (key in annotations) continue;
      const method = (instance as any)[key];
      if (typeof method === 'function') {
        (instance as any)[key] = smartBind(method, instance);
      }
    }
  }
}

/** The substitute owns normal Component infrastructure, never the real prototype. */
class SubstituteComponent extends Component<any> {}
function installSubstituteState(instance: Component<any>, state: object): void {
  const annotations: Record<string, any> = {};
  for (const key of Reflect.ownKeys(state)) {
    if (typeof key !== 'string' || key.startsWith('_') || key in instance || BASE_EXCLUDES.has(key)) throw new Error('[mobx-mantle] Substitute state cannot replace framework member ' + String(key));
    const descriptor = Object.getOwnPropertyDescriptor(state, key)!;
    if (!('value' in descriptor)) throw new Error('[mobx-mantle] Substitute state must contain data/callbacks, not getters.');
    Object.defineProperty(instance, key, { value: descriptor.value, enumerable: true, writable: true, configurable: true });
    annotations[key] = observable.ref;
  }
  makeObservable(instance, annotations);
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
    const parentHandle = React.useContext(ComponentParentContext);
    const resolver = React.useContext(ServiceContext);
    const substitutions = React.useContext(ModelContext);
    const substitutedTemplate = useRef<typeof template>(undefined);
    const vmRef = useRef<C | null>(null);
    const componentHandleRef = useRef<ComponentHandle | null>(null);
    const classRef = useRef(ComponentClass);
    const prevPropsRef = useRef<P | null>(null);
    const propsNotifyingRef = useRef(false);
    // Identity of this component's render reaction, wired into PropsBox so
    // it can skip tracking self-reads. Stable across HMR instance swaps.
    const renderReactionRef = useRef<RenderReactionHolder>({ current: null });

    if (!componentHandleRef.current) {
      componentHandleRef.current = { current: undefined };
    }
    const componentHandle = componentHandleRef.current;

    // HMR: class identity changes when the module re-executes, but useRef
    // values survive (React Fast Refresh preserves hooks). On detection,
    // we simply discard the old instance and create fresh — clean slate.
    // In production this check is always false (class identity is stable).
    if (vmRef.current && classRef.current !== ComponentClass) {
      classRef.current = ComponentClass;
      vmRef.current = null;
    }

    if (!vmRef.current) {
      applyMobxActionPolicy();

      const substitution = substitutions?.get(ComponentClass);
      if (substitution && !substitution.template && !template) throw new Error('[mobx-mantle] A substituted integrated model requires an explicit test template.');
      const instance = withServiceScope(resolver, () => substitution
        ? constructComponent(SubstituteComponent, props, parentHandle) as C
        : constructComponent(ComponentClass, props as P, parentHandle));
      substitutedTemplate.current = substitution?.template;
      setModelIdentity(instance, ComponentClass);
      if (substitution) installSubstituteState(instance, substitution.state());
      instance.forwardRef = ref;
      instance._propsBox._renderReaction = renderReactionRef.current;

      // Collect behavior instances from properties (must happen before makeObservable)
      if (!substitution) instance._collectBehaviors();

      // Check for Mantle decorator annotations first
      const decoratorAnnotations = getAnnotations(instance);
      
      if (substitution) {
        // State is annotated by reference once; never scan the original class.
      } else if (decoratorAnnotations) {
        // Mantle decorators: use collected annotations
        const annotations = { ...decoratorAnnotations };

        makeObservable(instance, annotations as AnnotationsMap<C, never>);

        // Bind methods not explicitly decorated, to preserve `this` without
        // an action wrapper (actions break observable tracking in render
        // helpers). smartBind allows tracking in render context and batches
        // mutations elsewhere.
        const protoInfo = collectProtoInfo(instance, Component.prototype, BASE_EXCLUDES, componentProtoInfo);
        for (const key of protoInfo.methodKeys) {
          if (key in annotations) continue;
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

      // Note: watch/effect registrations from field initializers and
      // onCreate stay dormant here. They come alive in the mount layout
      // effect (activateSpecs) — the commit phase — so renders React never
      // commits (Suspense, aborted transitions, SSR) leak no reactions.

      // Proxy forwards property access to instance.props, so reads are tracked
      // by MobX when used in reactions/computeds (same behavior as this.props)
      const reactiveProps = new Proxy({} as P, {
        get: (_, key) => (instance.props as any)[key],
        has: (_, key) => key in (instance.props as any),
        ownKeys: () => Reflect.ownKeys(instance.props as object),
        getOwnPropertyDescriptor: (_, key) =>
          Reflect.getOwnPropertyDescriptor(instance.props as object, key),
      });
      withOwnerServiceScope(instance, () => runInAction(() => instance.onCreate?.(reactiveProps)));

      // Dev check: fields first assigned in onCreate() (not declared as class
      // fields) were invisible to the annotation scan and are silently
      // non-reactive. Only meaningful in auto-observable mode — with
      // decorators, undecorated fields are inert by design.
      if (process.env.NODE_ENV !== 'production' && autoObservable && !decoratorAnnotations && !substitution) {
        for (const key of Object.keys(instance)) {
          if (BASE_EXCLUDES.has(key) || key.startsWith('_')) continue;
          const value = (instance as any)[key];
          if (typeof value === 'function' || isServiceValue(instance, value)) continue;
          if (!isObservableProp(instance, key)) {
            console.warn(
              `[mobx-mantle] ${ComponentClass.name}.${key} was first assigned in onCreate() ` +
              `and is not reactive. Declare it as a class field so it can be made observable.`
            );
          }
        }
      }

      vmRef.current = instance;
      prevPropsRef.current = props as P;
    }

    const vm = vmRef.current;
    const renderTemplate = substitutedTemplate.current ?? template;

    // Context can change when a component is genuinely reparented. Refresh
    // the WeakMap every render; descendants resolve through our stable handle.
    componentParents.set(vm, parentHandle);
    componentHandle.current = vm;

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
    useIsomorphicLayoutEffect(() => {
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
    useIsomorphicLayoutEffect(() => {
      // Commit reached: bring pre-mount watch/effect registrations alive
      // (first mount), or re-create the ones disposed when React StrictMode
      // replays mount effects with the same instance in development.
      // onMount/onLayoutMount registrations re-run on their own.
      activateSpecs(vm);

      vm._layoutMountBehaviors();
      let cleanup: (() => void) | undefined;
      try {
        const result = runInAction(() => vm.onLayoutMount?.());
        if (process.env.NODE_ENV !== 'production' && result instanceof Promise) {
          console.error(
            `[mobx-mantle] ${ComponentClass.name}.onLayoutMount() returned a Promise. ` +
            `Lifecycle methods must be synchronous. Use a sync onLayoutMount that ` +
            `calls an async method instead.`
          );
        }
        // Only a returned function is a cleanup; anything else (notably a
        // Promise from an async method) must not be called at unmount.
        cleanup = typeof result === 'function' ? (result as () => void) : undefined;
      } catch (e) {
        reportError(e, { phase: 'onLayoutMount', name: ComponentClass.name, isBehavior: false });
      }
      return () => {
        runInAction(() => cleanup?.());
      };
    }, [vm]);

    useEffect(() => {
      vm._mountBehaviors();
      let cleanup: (() => void) | undefined;
      try {
        const result = runInAction(() => vm.onMount?.());
        if (process.env.NODE_ENV !== 'production' && result instanceof Promise) {
          console.error(
            `[mobx-mantle] ${ComponentClass.name}.onMount() returned a Promise. ` +
            `Lifecycle methods must be synchronous. Use a sync onMount that ` +
            `calls an async method instead.`
          );
        }
        // Only a returned function is a cleanup; anything else (notably a
        // Promise from an async method) must not be called at unmount.
        cleanup = typeof result === 'function' ? (result as () => void) : undefined;
      } catch (e) {
        reportError(e, { phase: 'onMount', name: ComponentClass.name, isBehavior: false });
      }

      // Dev check: behaviors assigned after construction (in onCreate,
      // conditionally, or lazily) were invisible to _collectBehaviors, so
      // their lifecycle would silently never run.
      if (process.env.NODE_ENV !== 'production') {
        warnUncollectedBehaviors(vm, ComponentClass.name, vm._behaviors);
      }

      return () => {
        runInAction(() => cleanup?.());
        try {
          runInAction(() => vm.onUnmount?.());
        } catch (e) {
          reportError(e, { phase: 'onUnmount', name: ComponentClass.name, isBehavior: false });
        }
        vm._disposeWatchers();
        vm._unmountBehaviors();
        vm._wasUnmounted = true;
      };
    }, [vm]);

    // Called after every render (via useEffect)
    useEffect(() => {
      try {
        runInAction(() => vm.onUpdate?.());
      } catch (e) {
        reportError(e, { phase: 'onUpdate', name: ComponentClass.name, isBehavior: false });
      }
    });

    if (!renderTemplate && !vm.render) {
      throw new Error(
        `[mobx-mantle] ${ComponentClass.name}: Missing render() method. Either define render() in your Component class or pass a template function to createComponent().`
      );
    }

    // Only the render call is tracked by MobX. The reaction is owned by
    // Mantle (src/observer.ts) so PropsBox can recognize self-reads.
    const rendered = useMantleObserver(
      () => (renderTemplate ? renderTemplate(vm) : vm.render!()),
      ComponentClass.name,
      renderReactionRef.current
    );

    return (
      <ComponentParentContext.Provider value={componentHandle}>
        {rendered}
      </ComponentParentContext.Provider>
    );
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
