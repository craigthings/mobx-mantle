/**
 * A value, or a getter producing it. Behavior arguments typed as MaybeGetter
 * let consumers choose between a snapshot and a live connection:
 *
 * ```tsx
 * fetcher = withFetch('/api/items');            // frozen at construction
 * fetcher = withFetch(() => this.props.url);    // tracks prop changes
 * ```
 *
 * Behavior authors read the argument inside a reactive context with
 * `resolve()` — the same convention as Vue's MaybeRefOrGetter/toValue and
 * Solid's MaybeAccessor/access.
 *
 * Note: an argument that is legitimately a function (a callback rather than
 * a getter) cannot also be a MaybeGetter — the two are indistinguishable at
 * runtime. Choose per parameter.
 */
export type MaybeGetter<T> = T | (() => T);

/** Unwrap a MaybeGetter: call it if it is a getter, return it otherwise. */
export function resolve<T>(value: MaybeGetter<T>): T {
  return typeof value === 'function' ? (value as () => T)() : value;
}
