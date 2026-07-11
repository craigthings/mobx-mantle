/**
 * A value, or a getter producing it. Behavior arguments typed as MaybeGetter
 * let consumers choose between a snapshot and a live connection:
 *
 * ```tsx
 * fetcher = withFetch('/api/items');            // frozen at construction
 * fetcher = withFetch(() => this.props.url);    // tracks prop changes
 * ```
 *
 * Rule of thumb for consumers: not sure which to pass? Pass the arrow — it is
 * never wrong, only occasionally redundant. Reserve plain values for things
 * you intend to freeze.
 *
 * Behavior authors normalize the argument once with `this.sync()` (into a
 * self-updating field), or read it in place with `toValue()` — the same
 * convention as Vue's MaybeRefOrGetter/toValue and Solid's
 * MaybeAccessor/access.
 *
 * Note: an argument that is legitimately a function (a callback rather than
 * a getter) cannot also be a MaybeGetter — the two are indistinguishable at
 * runtime. Choose per parameter.
 */
export type MaybeGetter<T> = T | (() => T);

/**
 * Unwrap a MaybeGetter: call it if it is a getter, return it as-is otherwise.
 * Inside a tracked context (watch expression, effect body) calling the getter
 * also records its observable reads as dependencies — that is what makes a
 * getter argument live.
 */
export function toValue<T>(value: MaybeGetter<T>): T {
  return typeof value === 'function' ? (value as () => T)() : value;
}
