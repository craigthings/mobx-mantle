import { isObservableProp, reaction, runInAction, toJS } from 'mobx';

export interface SharedOptions {
  /**
   * Persist the shared fields to localStorage under the key and restore
   * them at startup, so a fresh window starts where the last one left off.
   * Default true.
   */
  persist?: boolean;
  /**
   * The fields to share. Defaults to the store's own observable data
   * fields: not getters, not methods, not names starting with `_`.
   */
  fields?: readonly string[];
}

export interface ShareStoresOptions extends SharedOptions {
  /** Key prefix for each store; the key is `${prefix}:${name}`. Default `shared`. */
  prefix?: string;
}

interface SharedEntry {
  dispose(): void;
}

const registry = new WeakMap<object, SharedEntry>();

function ownDataFields(store: object): string[] {
  return Object.keys(store).filter((key) => {
    if (key.startsWith('_')) return false;
    if (typeof (store as Record<string, unknown>)[key] === 'function') return false;
    return isObservableProp(store, key);
  });
}

function serialize(store: Record<string, unknown>, fields: readonly string[]): string {
  const values: Record<string, unknown> = {};
  for (const field of fields) values[field] = toJS(store[field]);
  return JSON.stringify(values);
}

/** Apply a serialized state inside one action; false when it is not usable. */
function apply(store: Record<string, unknown>, fields: readonly string[], json: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const values = parsed as Record<string, unknown>;
  runInAction(() => {
    for (const field of fields) {
      if (field in values) store[field] = values[field];
    }
  });
  return true;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Blocked storage (sandboxed or privacy settings): share without persisting.
    return null;
  }
}

/**
 * Share a MobX store's state across every window of one application:
 * other tabs, the frames a design tool hosts, anything on the same origin
 * that imports the same module. Each window keeps its own store instance;
 * values are mirrored, identity is not shared, and nothing goes through a
 * server or a parent document.
 *
 * Mechanics, the web's own answer for two windows, packaged so it is never
 * written by hand:
 * - restore the store's fields from localStorage at startup (`persist`);
 * - publish changes through a reaction to localStorage and a
 *   BroadcastChannel;
 * - apply incoming changes from the channel or the `storage` event inside
 *   an action.
 * Echo loops are bounded because a window only publishes when its
 * serialized state changed, and only applies what differs from it.
 *
 * The one authoring rule: effects must derive from state — a `reaction`,
 * `autorun`, or a component's `watch`/`effect` — never run inside setters,
 * because a change that arrives from another window sets fields directly.
 *
 * @example
 * export const themeStore = shared(new ThemeStore(), 'theme');
 */
export function shared<T extends object>(store: T, key: string, options: SharedOptions = {}): T {
  if (registry.has(store) || typeof window === 'undefined') return store;
  const target = store as Record<string, unknown>;
  const fields = options.fields ? [...options.fields] : ownDataFields(store);
  const storage = options.persist === false ? null : safeStorage();
  const channel =
    typeof BroadcastChannel === 'function' ? new BroadcastChannel(`mantle-shared:${key}`) : null;
  // Node's BroadcastChannel would keep a process alive; browsers have no unref.
  (channel as { unref?: () => void } | null)?.unref?.();

  let stored: string | null = null;
  try {
    stored = storage?.getItem(key) ?? null;
  } catch {
    stored = null;
  }
  if (stored !== null) apply(target, fields, stored);

  // The last state this window published or applied; the echo bound.
  let current = serialize(target, fields);

  const stopPublish = reaction(
    () => serialize(target, fields),
    (json) => {
      if (json === current) return;
      current = json;
      try {
        storage?.setItem(key, json);
      } catch {
        // quota exceeded or blocked storage — the value still travels the channel
      }
      channel?.postMessage(json);
    },
  );

  const receive = (json: string) => {
    if (json === current) return;
    current = json;
    apply(target, fields, json);
  };
  const onMessage = (event: MessageEvent) => {
    if (typeof event.data === 'string') receive(event.data);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === key && event.newValue !== null) receive(event.newValue);
  };
  channel?.addEventListener('message', onMessage);
  window.addEventListener('storage', onStorage);

  registry.set(store, {
    dispose() {
      stopPublish();
      channel?.removeEventListener('message', onMessage);
      channel?.close();
      window.removeEventListener('storage', onStorage);
      registry.delete(store);
    },
  });
  return store;
}

/** Stop sharing a store (tests, teardown). The store keeps its current state. */
export function unshare(store: object): void {
  registry.get(store)?.dispose();
}

/**
 * Share several stores at once, keyed by name: the one line an application
 * writes at its entry point (a design tool's manifest, an app's main
 * module) so every window that imports it wires the same stores.
 *
 * @example
 * shareStores({ themeStore, navPreferences });
 */
export function shareStores<T extends Record<string, object>>(
  stores: T,
  options: ShareStoresOptions = {},
): T {
  const { prefix = 'shared', ...rest } = options;
  for (const [name, store] of Object.entries(stores)) {
    shared(store, `${prefix}:${name}`, rest);
  }
  return stores;
}
