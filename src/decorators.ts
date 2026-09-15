import * as mobx from 'mobx';
import { isServiceValue } from './services';

export const ANNOTATIONS = Symbol('mantle:annotations');
type Annotations = Record<string | symbol, any>;
type Context = { kind: string; name: string | symbol; metadata?: Record<symbol, unknown>; static?: boolean; private?: boolean };
const legacy = new WeakMap<object, Annotations>();

function annotation(value: any, kind: 'field' | 'method' | 'getter') {
  return function (_target: any, key: string | symbol | Context, descriptor?: PropertyDescriptor): void {
    let map: Annotations;
    let name: string | symbol;
    if (typeof key === 'object') {
      if (key.static || key.private || key.kind !== kind) {
        throw new Error(`[mobx-mantle] This decorator requires a public instance ${kind}. Use an ordinary field, not an auto-accessor, for @observable.`);
      }
      if (!key.metadata) throw new Error('[mobx-mantle] TC39 decorators require Symbol.metadata. Load its polyfill before decorated classes.');
      // Metadata inherits from base metadata. Never mutate its annotation map.
      if (!Object.prototype.hasOwnProperty.call(key.metadata, ANNOTATIONS)) key.metadata[ANNOTATIONS] = Object.create(null);
      map = key.metadata[ANNOTATIONS] as Annotations;
      name = key.name;
    } else {
      if (typeof _target === 'function' || (kind === 'method' && typeof descriptor?.value !== 'function') || (kind === 'getter' && !descriptor?.get) || (kind === 'field' && descriptor)) {
        throw new Error(`[mobx-mantle] This decorator requires a public instance ${kind}.`);
      }
      map = legacy.get(_target) ?? Object.create(null);
      legacy.set(_target, map);
      name = key;
    }
    map[name] = value;
  };
}

/** Plain fields in either TypeScript decorator mode; no accessor keyword needed. */
export const observable = Object.assign(annotation(mobx.observable, 'field'), {
  ref: annotation(mobx.observable.ref, 'field'),
  shallow: annotation(mobx.observable.shallow, 'field'),
  deep: annotation(mobx.observable.deep, 'field'),
  struct: annotation(mobx.observable.struct, 'field'),
});
/** Bound prototype method; synchronous writes are batched. */
export const action = annotation(mobx.action.bound, 'method');
export const computed = annotation(mobx.computed, 'getter');

/** Both Components and Behaviors apply this map once after construction. */
export function getAnnotations(instance: object): Annotations | undefined {
  const chain: object[] = [];
  for (let proto = Object.getPrototypeOf(instance); proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) chain.unshift(proto);
  const result: Annotations = Object.create(null);
  for (const proto of chain) {
    const constructor = (proto as any).constructor;
    const symbol = (Symbol as any).metadata;
    const metadata = symbol && Object.prototype.hasOwnProperty.call(constructor, symbol) ? constructor[symbol] : undefined;
    const modern = metadata && Object.prototype.hasOwnProperty.call(metadata, ANNOTATIONS) ? metadata[ANNOTATIONS] : undefined;
    for (const own of [legacy.get(proto), modern]) {
      if (!own) continue;
      for (const key of Reflect.ownKeys(own)) {
        if (key in result && result[key] !== own[key]) throw new Error(`[mobx-mantle] Cannot change the inherited annotation of ${String(key)}.`);
        result[key] = own[key];
      }
    }
  }
  for (const key of Reflect.ownKeys(result)) {
    // Avoid invoking computed getters while checking service field identity.
    const own = Object.getOwnPropertyDescriptor(instance, key);
    if (own && 'value' in own && isServiceValue(instance, own.value)) throw new Error(`[mobx-mantle] Leave service field ${String(key)} undecorated; its resolver owns observability.`);
  }
  return Reflect.ownKeys(result).length ? result : undefined;
}
