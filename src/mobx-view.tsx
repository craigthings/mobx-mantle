import { useState, useEffect, forwardRef as reactForwardRef, type Ref, type JSX } from 'react';
import { makeObservable, observable, computed, action, runInAction, AnnotationsMap } from 'mobx';
import { observer } from 'mobx-react-lite';

export class View<P = {}> {
  props!: P;
  forwardRef?: Ref<any>;

  onCreate?(): void;
  onMount?(): void | (() => void);
  onUnmount?(): void;

  ref<T extends HTMLElement = HTMLElement>(): { current: T | null } {
    return { current: null };
  }

  render?(): JSX.Element;
}

// Base class members that should not be made observable
const BASE_EXCLUDES = new Set(['props', 'forwardRef', 'onCreate', 'onMount', 'render', 'ref', 'constructor']);

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
  const annotations: AnnotationsMap<T, never> = {
    props: observable.ref,
  } as AnnotationsMap<T, never>;

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
  const { autoObservable = true } = options;

  const Component = reactForwardRef<unknown, P>((props, ref) => {
    const [vm] = useState(() => {
      const instance = new ViewClass();
      instance.props = props;
      instance.forwardRef = ref;

      if (autoObservable) {
        makeViewObservable(instance, true);
      } else {
        makeObservable(instance, {
          props: observable.ref,
        } as AnnotationsMap<V, never>);
      }

      instance.onCreate?.();
      return instance;
    });

    runInAction(() => {
      vm.props = props;
    });

    vm.forwardRef = ref;

    useEffect(() => {
      const cleanup = vm.onMount?.();
      return () => {
        cleanup?.();
        vm.onUnmount?.();
      };
    }, []);

    if (!template && !vm.render) {
      throw new Error(
        `${ViewClass.name}: Missing render() method. Either define render() in your View class or pass a template function to createView().`
      );
    }

    return template ? template(vm) : vm.render!();
  });

  return observer(Component);
}
