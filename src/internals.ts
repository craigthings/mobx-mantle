import { globalConfig } from './config';

/**
 * A watch/effect registration. `create` builds the underlying MobX reaction
 * and returns its disposer. Specs registered before mount are kept so the
 * reaction can be re-created if the host unmounts and remounts with the same
 * instance — React StrictMode does exactly this in development.
 */
export interface ReactiveSpec {
  create: () => () => void;
  stopped: boolean;
  dispose: (() => void) | null;
}

/** Common reactive bookkeeping shape shared by Component and Behavior */
export interface ReactiveHost {
  _reactiveSpecs: ReactiveSpec[];
  _mounted: boolean;
  _wasUnmounted: boolean;
}

/**
 * Register a watch/effect on a host.
 *
 * - Before mount (field initializers, onCreate): recorded as a dormant spec.
 *   activateSpecs() brings it alive in the commit phase (useLayoutEffect),
 *   so renders React never commits (Suspense throws, aborted transitions,
 *   server rendering) create no live MobX reactions.
 * - At or after mount (onLayoutMount, onMount, event handlers): created
 *   immediately with no spec — those callsites re-run on remount, so they
 *   re-register naturally.
 *
 * Returns an early-disposal function that also cancels any future
 * materialization or resurrection.
 */
export function registerReactive(host: ReactiveHost, create: () => () => void): () => void {
  if (host._mounted) {
    return create();
  }

  const spec: ReactiveSpec = { create, stopped: false, dispose: null };
  host._reactiveSpecs.push(spec);

  return () => {
    spec.stopped = true;
    spec.dispose?.();
  };
}

/**
 * Bring a host's pre-mount registrations alive at commit time and mark it
 * mounted. First mount materializes dormant specs; a remount with a
 * surviving instance (React StrictMode simulates this in development)
 * re-creates the reactions that were disposed at unmount.
 */
export function activateSpecs(host: ReactiveHost): void {
  if (host._wasUnmounted) {
    host._wasUnmounted = false;
    for (const spec of host._reactiveSpecs) {
      if (!spec.stopped) {
        spec.dispose = spec.create();
      }
    }
  } else if (!host._mounted) {
    for (const spec of host._reactiveSpecs) {
      if (!spec.stopped && spec.dispose === null) {
        spec.dispose = spec.create();
      }
    }
  }
  host._mounted = true;
}

/** Per-class prototype facts: getter keys and plain method keys */
export interface ProtoInfo {
  computedKeys: string[];
  methodKeys: string[];
}

/**
 * Walk a class's prototype chain (stopping before the framework base class
 * and Object.prototype), collecting getter keys and method keys. The result
 * depends only on the prototype, so it is identical for every instance of a
 * class and cached per class. Disable with configure({ cacheAnnotations: false }).
 */
export function collectProtoInfo(
  instance: object,
  stopProto: object,
  excludes: Set<string>,
  cache: WeakMap<Function, ProtoInfo>
): ProtoInfo {
  const ctor = instance.constructor as Function;
  const useCache = globalConfig.cacheAnnotations !== false;

  if (useCache) {
    const cached = cache.get(ctor);
    if (cached) return cached;
  }

  const info: ProtoInfo = { computedKeys: [], methodKeys: [] };
  const seen = new Set<string>();

  let proto = Object.getPrototypeOf(instance);
  while (proto && proto !== stopProto && proto !== Object.prototype) {
    const descriptors = Object.getOwnPropertyDescriptors(proto);

    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (excludes.has(key) || seen.has(key)) continue;
      seen.add(key);

      if (descriptor.get) {
        info.computedKeys.push(key);
      } else if (typeof descriptor.value === 'function') {
        info.methodKeys.push(key);
      }
    }

    proto = Object.getPrototypeOf(proto);
  }

  if (useCache) cache.set(ctor, info);
  return info;
}
