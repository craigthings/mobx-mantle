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

- [ ] `watch` in Behavior `onCreate` tracks a field assigned in that same `onCreate` (deferred to commit — comes alive at mount)
- [ ] Ref-like object passed into `onCreate` keeps object identity (`observable.ref` detection still sees values)
- [ ] Factory callable with and without `new`; `onCreate` receives factory args; TS arg inference (type-level test)
- [ ] Lifecycle relay: `onLayoutMount`/`onMount`/`onUnmount` fire with the parent, cleanups run
- [ ] Error isolation: a throwing Behavior doesn't prevent sibling Behaviors or the parent from mounting

### 2b. Nested behaviors

- [ ] Grandchild lifecycle fires in order: child `onMount` before parent `onMount`, three levels deep
- [ ] Unmount runs in reverse: parent `onUnmount` before children tear down
- [ ] Child behavior watchers survive StrictMode via the existing resurrection machinery
- [ ] Child assigned in a *behavior's* `onCreate` is collected; underscore-prefixed field is not
- [ ] Cycle (parent assigned into child) does not infinite-loop the relay

### 2c. Reactive arguments

- [ ] Getter argument: prop/observable change flows into the behavior (`watch(() => resolve(arg))` re-fires)
- [ ] Plain value stays static across source changes
- [ ] `resolve()` returns functions' results and non-functions as-is

### 2d. Late-creation warning

- [ ] Behavior assigned in a Component's `onCreate` → dev warning names the field
- [ ] Field-declared behaviors → silent
- [ ] Late-assigned grandchild on a collected behavior → warned (recursive scan)

### 2e. `useBehavior()` adapter

- [ ] Behavior hosted in a plain function component mounts, reacts (with `observer()`), unmounts
- [ ] Survives StrictMode double-mount (resurrection through the relay functions)
- [ ] Factory runs exactly once per mount lifetime

### 2f. Primitives

- [ ] One composition test proving the layering end to end (`withAutosave`: interval ticks → async save runs → `saving`/`error` state observable)
- [ ] `withFetch` refetches on getter-URL change; discards out-of-order completions
- [ ] `withLocalStorage` hydrates, persists on change, applies cross-tab `storage` events

## 3. Props reactivity (PropsBox atom)

- [ ] `this.props` is current during the render where props changed
- [ ] `watch(() => this.props.x)` fires after a prop change; exactly once per change
- [ ] Two observer components sharing state render without "cannot update while rendering" warnings (the silent-sync guarantee)
- [ ] Prop change on a component reading `this.props.x` directly in render → exactly one render (self-notification skip)
- [ ] Computed over props settles to the correct value before paint; at most one extra pre-paint render
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
- [ ] Constructing a component/behavior (render phase) creates **zero** live reactions — assert via `onBecomeObserved` probe before commit
- [ ] `renderToString` of a component with `onCreate` watchers creates no reactions (server path renders untracked)
- [ ] `stop()` called in `onCreate` → the spec never materializes at mount

## 10. Action enforcement (managed MobX config)

- [ ] Async method mutating state after `await` → no MobX `enforceActions` warning
- [ ] `watch` callback assigning state → no warning
- [ ] `configure({ manageMobxActions: false })` before first render → Mantle leaves MobX config untouched (spy on `mobx.configure` or assert strict-mode warning still fires)

## 11. Type-level tests (`expect-type` or `tsd`)

- [ ] `PropsOf` inference
- [ ] `MantleComponent` assignability to strict `ComponentType` consumers (react-window-style)
- [ ] `createForwardRef` ref typing
- [ ] `BehaviorArgs` constructor-vs-`onCreate` resolution

---

**Formerly a known gap, now testable:** concurrent-render discard (an instance created during a render React throws away) no longer leaks by construction — specs are dormant until commit, and the render reaction is guarded by a FinalizationRegistry. The construction-creates-zero-reactions probe in section 9 pins the specs half; the registry half stays documented rather than tested (forcing GC in jsdom is not practical).

Sections 1–3 encode the design decisions behind v0.3.4 (onMount-first doctrine with spec resurrection as the safety net for pre-mount declarations, the atom-based props box, the pre-mount `addCleanup` dev warning), so a future refactor that breaks those semantics fails loudly rather than silently reverting.
