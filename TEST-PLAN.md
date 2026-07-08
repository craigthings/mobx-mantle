# MobX Mantle — Test Plan

Test suite plan for the standalone mantle repo, organized by area, roughly in priority order.

**Infrastructure assumptions:** vitest + jsdom + `@testing-library/react`, with a helper that mounts a component both bare and wrapped in `<StrictMode>`, and a `configure({ onError })` spy fixture.

---

## 1. StrictMode & remount resurrection

*Pins the newest, subtlest code (spec resurrection, v0.3.4) — write these first.*

- [ ] Watcher declared in `onCreate` still fires after a StrictMode double-mount
- [ ] `effect` declared in `onCreate` resurrects and re-runs its initial pass on remount; its cleanup ran at simulated unmount
- [ ] `fireImmediately` watcher fires again on remount (documented semantics)
- [ ] `stop()` called before remount prevents resurrection; `stop()` called *while unmounted* is safe
- [ ] Watcher registered in `onMount` does **not** double-fire after remount (no duplicate registration)
- [ ] Behavior with an `onCreate` watcher survives StrictMode intact
- [ ] `addCleanup` in `onMount` re-registers on remount; the one-shot behavior of pre-mount `addCleanup` is asserted as documented
- [ ] Dev warning fires when `addCleanup` is called before mount (Component and Behavior) — and does *not* fire for `watch`/`effect`'s internal registrations or for `addCleanup` in `onMount`

## 2. Behavior construction & deferral

- [ ] `watch` in Behavior `onCreate` tracks a field assigned in that same `onCreate` (the deferral fix)
- [ ] Ref-like object passed into `onCreate` keeps object identity (`observable.ref` detection still sees values)
- [ ] Factory callable with and without `new`; `onCreate` receives factory args; TS arg inference (type-level test)
- [ ] Lifecycle relay: `onLayoutMount`/`onMount`/`onUnmount` fire with the parent, cleanups run
- [ ] Error isolation: a throwing Behavior doesn't prevent sibling Behaviors or the parent from mounting

## 3. Props reactivity (PropsBox atom)

- [ ] `this.props` is current during the render where props changed
- [ ] `watch(() => this.props.x)` fires after a prop change; exactly once per change
- [ ] Two observer components sharing state render without "cannot update while rendering" warnings (the silent-sync guarantee)
- [ ] Computed over props settles to the correct value before paint (asserts the known double-render, so a regression is visible)
- [ ] `React.memo` behavior: parent re-render with shallow-equal props skips the child
- [ ] `this.props` usable in field initializers and via the proxy passed to `onCreate`

## 4. Core auto-observable semantics

- [ ] Field mutation re-renders; getter behaves as computed (cache + invalidation)
- [ ] Inheritance: two-level Component subclass gets fields/getters/methods from every level
- [ ] `this.ref()` objects and Behavior instances annotated `observable.ref` (identity preserved)
- [ ] smartBind both ways: event-handler mutation of multiple fields batches into one render; method called inside a render helper still tracks observables
- [ ] Method passed as a bare callback keeps `this`
- [ ] Dev warning fires for a field first assigned in `onCreate` without a class-field declaration

## 5. Annotation caching

- [ ] Second instance of a class behaves identically to the first (cache-hit path)
- [ ] `spyOn` a prototype method *before* instantiation → new instances call the spy (names-not-references guarantee)
- [ ] `configure({ cacheAnnotations: false })` path produces identical behavior
- [ ] Subclass and superclass get independent cache entries

## 6. watch/effect mechanics

- [ ] `delay` debounces; `fireImmediately` runs on setup; callback receives `(value, prev)`
- [ ] `effect` cleanup runs before each re-run and on unmount
- [ ] Early-dispose from *inside* the callback (the "only needed once" pattern)
- [ ] Callback errors route to `onError` with correct `phase`/`name`/`isBehavior`, and don't break the component

## 7. Lifecycle contract

- [ ] Ordering: `onCreate` → render → `onLayoutMount` → `onMount`; unmount runs cleanup → `onUnmount` → watcher disposal → behavior teardown
- [ ] `onUpdate` after every render
- [ ] Returning a Promise from a lifecycle method triggers the dev error
- [ ] Render errors reach a React error boundary; lifecycle errors reach `onError` instead

## 8. Decorator modes

- [ ] Mantle decorators: decorated fields reactive, undecorated inert, methods still auto-bound; `ref`/`shallow`/`struct` variants
- [ ] Legacy MobX decorators with `autoObservable: false`
- [ ] Graceful behavior when `Symbol.metadata` is absent

## 9. Leak & disposal hygiene

- [ ] After unmount, no live reactions remain (count via a MobX `spy` or reaction counter fixture)
- [ ] HMR path: class-identity change discards the old instance and disposes its watchers

## 10. Type-level tests (`expect-type` or `tsd`)

- [ ] `PropsOf` inference
- [ ] `MantleComponent` assignability to strict `ComponentType` consumers (react-window-style)
- [ ] `createForwardRef` ref typing
- [ ] `BehaviorArgs` constructor-vs-`onCreate` resolution

---

**Known gap to document rather than test:** concurrent-render discard (an instance created during a render React throws away) — not practically testable with public APIs; note it in the README instead.

Sections 1–3 encode the design decisions behind v0.3.4 (onMount-first doctrine with spec resurrection as the safety net for pre-mount declarations, the atom-based props box, the pre-mount `addCleanup` dev warning), so a future refactor that breaks those semantics fails loudly rather than silently reverting.
