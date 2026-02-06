import { makeAutoObservable } from 'mobx';

/**
 * Base class for reusable behaviors that can be used with View.use()
 * Behaviors support the same lifecycle methods as Views.
 */
export class Behavior {
  onCreate?(): void;
  onLayoutMount?(): void | (() => void);
  onMount?(): void | (() => void);
  onUnmount?(): void;
}

/** @internal */
export interface BehaviorInstance {
  instance: any;
  cleanup?: () => void;
  layoutCleanup?: () => void;
}

/** @internal */
export function createBehaviorInstance<T extends object>(
  Thing: new () => T,
  options?: { observable?: boolean }
): { instance: T; entry: BehaviorInstance } {
  const instance = new Thing();

  if (options?.observable !== false) {
    makeAutoObservable(instance);
  }

  // Call onCreate if it exists
  if ('onCreate' in instance && typeof instance.onCreate === 'function') {
    instance.onCreate();
  }

  return {
    instance,
    entry: { instance },
  };
}

/** @internal */
export function layoutMountBehavior(behavior: BehaviorInstance): void {
  const inst = behavior.instance;

  if ('onLayoutMount' in inst && typeof inst.onLayoutMount === 'function') {
    behavior.layoutCleanup = inst.onLayoutMount() ?? undefined;
  }
}

/** @internal */
export function mountBehavior(behavior: BehaviorInstance): void {
  const inst = behavior.instance;

  // Support both onMount() and mount() patterns
  if ('onMount' in inst && typeof inst.onMount === 'function') {
    behavior.cleanup = inst.onMount() ?? undefined;
  } else if ('mount' in inst && typeof inst.mount === 'function') {
    behavior.cleanup = inst.mount() ?? undefined;
  }
}

/** @internal */
export function unmountBehavior(behavior: BehaviorInstance): void {
  // Call layout cleanup if exists
  behavior.layoutCleanup?.();
  
  // Call cleanup if exists
  behavior.cleanup?.();

  // Call onUnmount if exists
  const inst = behavior.instance;
  if ('onUnmount' in inst && typeof inst.onUnmount === 'function') {
    inst.onUnmount();
  }
}
