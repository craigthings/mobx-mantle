import { useRef, useEffect, useLayoutEffect, forwardRef as reactForwardRef, type Ref, type JSX } from 'react';
import { makeObservable, observable, computed, action, AnnotationsMap, type IObservableValue } from 'mobx';
import { observer } from 'mobx-react-lite';
import {
  type BehaviorInstance,
  createBehaviorInstance,
  layoutMountBehavior,
  mountBehavior,
  unmountBehavior,
} from './behavior';

/**
 * Global configuration options for mobx-mantle
 */
export interface MantleConfig {
  /** Whether to automatically make View instances observable (default: true) */
  autoObservable?: boolean;
}

const globalConfig: MantleConfig = {
  autoObservable: true,
};

/**
 * Configure global defaults for mobx-mantle.
 * Settings can still be overridden per-view in createView options.
 */
export function configure(config: MantleConfig): void {
  Object.assign(globalConfig, config);
}

export class View<P = {}> {
  /** @internal */
  _propsBox!: IObservableValue<P>;
  
  get props(): P {
    return this._propsBox.get();
  }
  
  set props(value: P) {
    this._propsBox.set(value);
  }

  forwardRef?: Ref<any>;

  /** @internal */
  _behaviors: BehaviorInstance[] = [];

  onCreate?(): void;
  onLayoutMount?(): void | (() => void);
  onMount?(): void | (() => void);
  onUnmount?(): void;

  ref<T extends HTMLElement = HTMLElement>(): { current: T | null } {
    return { current: null };
  }

  /**
   * Creates and manages a behavior instance with automatic lifecycle handling.
   * The behavior will be made observable by default and its lifecycle methods
   * will be called in sync with the parent View.
   */
  protected use<T extends object>(Thing: new () => T, options?: { observable?: boolean }): T {
    const { instance, entry } = createBehaviorInstance(Thing, options);
    this._behaviors.push(entry);
    return instance;
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

  render?(): JSX.Element;
}

/** Alias for View - use when separating ViewModel from template */
export { View as ViewModel };

// Re-export Behavior from behavior module
export { Behavior } from './behavior';

// Base class members that should not be made observable
const BASE_EXCLUDES = new Set([
  'props',
  '_propsBox',
  'forwardRef', 
  'onCreate',
  'onLayoutMount',
  'onMount', 
  'onUnmount',
  'render', 
  'ref', 
  'use',
  'constructor',
  '_behaviors',
  '_layoutMountBehaviors',
  '_mountBehaviors',
  '_unmountBehaviors',
]);

/**
 * Detects if a value is a ref-like object ({ current: ... })
 * These should use observable.ref to preserve object identity for React
 */
function isRefLike(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    'current' in value &&
    Object.keys(value).length === 1
  );
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

    // Use observable.ref for ref-like objects to preserve identity
    if (isRefLike(value)) {
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

      if (autoObservable) {
        makeViewObservable(instance, true);
      } else {
        // For decorator users: applies legacy decorator metadata
        // For TC39 decorators: no-op (they're self-registering)
        makeObservable(instance);
      }

      instance.onCreate?.();
      vmRef.current = instance;
    }

    const vm = vmRef.current;

    // Props setter handles reactivity via observable.box
    vm.props = props;
    vm.forwardRef = ref;

    // [vm] dep ensures effects re-run when instance changes (HMR).
    // On normal renders vm is stable, so effects run once — same as [].
    useLayoutEffect(() => {
      vm._layoutMountBehaviors();
      const cleanup = vm.onLayoutMount?.();
      return () => {
        cleanup?.();
      };
    }, [vm]);

    useEffect(() => {
      vm._mountBehaviors();
      const cleanup = vm.onMount?.();
      return () => {
        cleanup?.();
        vm.onUnmount?.();
        vm._unmountBehaviors();
      };
    }, [vm]);

    if (!template && !vm.render) {
      throw new Error(
        `${ViewClass.name}: Missing render() method. Either define render() in your View class or pass a template function to createView().`
      );
    }

    return template ? template(vm) : vm.render!();
  });

  return observer(Component);
}
