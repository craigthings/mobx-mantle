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
  _observed: boolean;
  _mounted: boolean;
}

/**
 * Register a watch/effect on a host.
 *
 * - Before the host is observable (a Behavior's onCreate runs before
 *   makeObservable): creation is deferred; materializeSpecs() runs it as soon
 *   as observability is set up, so the reaction tracks observable fields.
 * - Before mount (field initializers, onCreate): created immediately and
 *   recorded for resurrection on remount.
 * - At or after mount (onMount, event handlers): created immediately with no
 *   spec — onMount re-runs on remount, so these re-register naturally.
 *
 * Returns an early-disposal function that also cancels any future
 * materialization or resurrection.
 */
export function registerReactive(host: ReactiveHost, create: () => () => void): () => void {
  const spec: ReactiveSpec = { create, stopped: false, dispose: null };

  if (host._observed) {
    spec.dispose = create();
  }

  if (!host._mounted) {
    host._reactiveSpecs.push(spec);
  }

  return () => {
    spec.stopped = true;
    spec.dispose?.();
  };
}

/** Create reactions for deferred specs that have never been materialized */
export function materializeSpecs(host: ReactiveHost): void {
  for (const spec of host._reactiveSpecs) {
    if (!spec.stopped && spec.dispose === null) {
      spec.dispose = spec.create();
    }
  }
}

/** Re-create all live pre-mount reactions after a remount */
export function resurrectSpecs(host: ReactiveHost): void {
  for (const spec of host._reactiveSpecs) {
    if (!spec.stopped) {
      spec.dispose = spec.create();
    }
  }
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
