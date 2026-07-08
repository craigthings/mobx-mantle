import { useEffect, useState } from 'react';
import { useIsomorphicLayoutEffect } from './observer';
import {
  type BehaviorEntry,
  isBehavior,
  layoutMountBehavior,
  mountBehavior,
  unmountBehavior,
} from './behavior';

/**
 * Host a behavior inside a plain React function component. The behavior gets
 * the same lifecycle relay a Mantle Component would give it: onLayoutMount in
 * the layout phase, onMount after paint, watchers alive from commit, full
 * teardown at unmount, and StrictMode remount resurrection.
 *
 * The instance is created once per mount lifetime, from a factory so nothing
 * is constructed on re-renders. It is returned as-is — wrap the component in
 * observer() (from mobx-mantle) so renders track the behavior's observables:
 *
 * @example
 * ```tsx
 * const Toolbar = observer(() => {
 *   const size = useBehavior(() => withWindowSize());
 *   return <div>{size.width} × {size.height}</div>;
 * });
 * ```
 *
 * Note: the factory runs once, so getter arguments close over the first
 * render's scope. Getters reading observables (a store, another behavior)
 * stay live; getters reading a function component's props capture the first
 * render's props object and go stale — pass observable sources instead.
 */
export function useBehavior<T extends object>(create: () => T): T {
  const [entry] = useState<BehaviorEntry>(() => {
    const instance = create();
    if (process.env.NODE_ENV !== 'production' && !isBehavior(instance)) {
      console.warn(
        '[mobx-mantle] useBehavior() expected the factory to return a behavior ' +
        'instance (created with a factory from createBehavior). Lifecycle relay ' +
        'will be skipped for this value.'
      );
    }
    return { instance };
  });

  useIsomorphicLayoutEffect(() => {
    if (!isBehavior(entry.instance)) return;
    layoutMountBehavior(entry);
  }, [entry]);

  useEffect(() => {
    if (!isBehavior(entry.instance)) return;
    mountBehavior(entry);
    return () => unmountBehavior(entry);
  }, [entry]);

  return entry.instance as T;
}
