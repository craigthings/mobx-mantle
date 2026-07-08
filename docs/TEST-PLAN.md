# MobX Mantle — Test Plan

Test suite plan for the standalone mantle repo, organized by area, roughly in priority order.

**Status:** Implemented — 75 tests across 15 files, all green. Run with `npm test`
(vitest + jsdom + `@testing-library/react`); type-level tests with `npm run test:types`.
Shared fixtures live in `test/helpers.tsx` (StrictMode mount, `onError` capture,
`deferred`, and an `onBecomeObserved` reaction probe). The global `afterEach`
(`test/setup.ts`) unmounts and resets Mantle config between tests.

**Bug found & fixed while writing these:** a lifecycle method that returned a
Promise (e.g. an accidental `async onMount()`) was stored as the cleanup
function and then *called* at unmount, crashing with "cleanup is not a
function". Fixed in `src/mantle.tsx` and `src/behavior.ts` — only a returned
function is now treated as cleanup. Pinned by the section 7 Promise test.

---

## 1. StrictMode & remount resurrection

*Pins the newest, subtlest code (spec resurrection, v0.3.4) — write these first.*

- [x] Watcher declared in `onCreate` still fires after a StrictMode double-mount
- [x] `effect` declared in `onCreate` resurrects and re-runs its initial pass on remount; its cleanup ran at simulated unmount
- [x] `fireImmediately` watcher fires again on remount (documented semantics)
- [x] `stop()` called before remount prevents resurrection; `stop()` called *while unmounted* is safe
- [x] Watcher registered in `onMount` does **not** double-fire after remount (no duplicate registration)
- [x] Behavior with an `onCreate` watcher survives StrictMode intact
- [x] `addCleanup` in `onMount` re-registers on remount; the one-shot behavior of pre-mount `addCleanup` is asserted as documented
- [x] Dev warning fires when `addCleanup` is called before mount (Component and Behavior) — and does *not* fire for `watch`/`effect`'s internal registrations or for `addCleanup` in `onMount`

## 2. Behavior construction & deferral

- [x] `watch` in Behavior `onCreate` tracks a field assigned in that same `onCreate` (deferred to commit — comes alive at mount)
- [x] Ref-like object passed into `onCreate` keeps object identity (`observable.ref` detection still sees values)
- [x] Factory callable with and without `new`; `onCreate` receives factory args; TS arg inference (type-level test)
- [x] Lifecycle relay: `onLayoutMount`/`onMount`/`onUnmount` fire with the parent, cleanups run
- [x] Error isolation: a throwing Behavior doesn't prevent sibling Behaviors or the parent from mounting

### 2b. Nested behaviors

- [x] Grandchild lifecycle fires in order: child `onMount` before parent `onMount`, three levels deep
- [x] Unmount runs in reverse: parent `onUnmount` before children tear down
- [x] Child behavior watchers survive StrictMode via the existing resurrection machinery
- [x] Child assigned in a *behavior's* `onCreate` is collected; underscore-prefixed field is not
- [x] Cycle (parent assigned into child) does not infinite-loop the relay

### 2c. Reactive arguments

- [x] Getter argument: prop/observable change flows into the behavior (`watch(() => resolve(arg))` re-fires)
- [x] Plain value stays static across source changes
- [x] `resolve()` returns functions' results and non-functions as-is

### 2d. Late-creation warning

- [x] Behavior assigned in a Component's `onCreate` → dev warning names the field
- [x] Field-declared behaviors → silent
- [x] Late-assigned grandchild on a collected behavior → warned (recursive scan)

### 2e. `useBehavior()` adapter

- [x] Behavior hosted in a plain function component mounts, reacts (with `observer()`), unmounts
- [x] Survives StrictMode double-mount (resurrection through the relay functions)
- [x] Factory runs exactly once per mount lifetime

### 2f. Primitives

- [x] One composition test proving the layering end to end (`withAutosave`: interval ticks → async save runs → `saving`/`error` state observable)
- [x] `withFetch` refetches on getter-URL change; discards out-of-order completions
- [x] `withLocalStorage` hydrates, persists on change, applies cross-tab `storage` events

## 3. Props reactivity (PropsBox atom)

- [x] `this.props` is current during the render where props changed
- [x] `watch(() => this.props.x)` fires after a prop change; exactly once per change
- [x] Two observer components sharing state render without "cannot update while rendering" warnings (the silent-sync guarantee)
- [x] Prop change on a component reading `this.props.x` directly in render → exactly one render (self-notification skip)
- [x] Computed over props settles to the correct value before paint; at most one extra pre-paint render
- [x] `React.memo` behavior: parent re-render with shallow-equal props skips the child
- [x] `this.props` usable in field initializers and via the proxy passed to `onCreate`

## 4. Core auto-observable semantics

- [x] Field mutation re-renders; getter behaves as computed (cache + invalidation)
- [x] Inheritance: two-level Component subclass gets fields/getters/methods from every level
- [x] `this.ref()` objects and Behavior instances annotated `observable.ref` (identity preserved)
- [x] smartBind both ways: event-handler mutation of multiple fields batches into one render; method called inside a render helper still tracks observables
- [x] Method passed as a bare callback keeps `this`
- [x] Dev warning fires for a field first assigned in `onCreate` without a class-field declaration

## 5. Annotation caching

- [x] Second instance of a class behaves identically to the first (cache-hit path)
- [x] `spyOn` a prototype method *before* instantiation → new instances call the spy (names-not-references guarantee)
- [x] `configure({ cacheAnnotations: false })` path produces identical behavior
- [x] Subclass and superclass get independent cache entries

## 6. watch/effect mechanics

- [x] `delay` debounces; `fireImmediately` runs on setup; callback receives `(value, prev)`
- [x] `effect` cleanup runs before each re-run and on unmount
- [x] Early-dispose from *inside* the callback (the "only needed once" pattern)
- [x] Callback errors route to `onError` with correct `phase`/`name`/`isBehavior`, and don't break the component

## 7. Lifecycle contract

- [x] Ordering: `onCreate` → render → `onLayoutMount` → `onMount`; unmount runs cleanup → `onUnmount` → watcher disposal → behavior teardown
- [x] `onUpdate` after every render
- [x] Returning a Promise from a lifecycle method triggers the dev error *and* does not crash at unmount (see bug note above)
- [x] Render errors reach a React error boundary; lifecycle errors reach `onError` instead

## 8. Decorator modes

- [x] Mantle decorators: decorated fields reactive, undecorated inert, methods still auto-bound; `ref`/`shallow`/`struct` variants
- [x] Legacy MobX decorators (`@observable accessor`) with `autoObservable: false`
- [x] Graceful behavior when `Symbol.metadata` is absent

## 9. Leak & disposal hygiene

- [x] After unmount, no live reactions remain (via an `onBecomeObserved`/`onBecomeUnobserved` probe)
- [~] HMR path: class-identity change discards the old instance and disposes its watchers — the disposal guarantee is covered via a key-forced remount (the `[vm]` effect dependency), but the exact same-fiber Fast-Refresh branch requires the React Fast Refresh runtime and is not unit-triggered
- [x] Constructing a component/behavior (render phase) creates **zero** live reactions — asserted via the probe during the render body, before the commit-phase layout effect
- [x] `renderToString` of a component with `onCreate` watchers creates no reactions (server path renders untracked — `test/server.node.test.tsx`, node environment)
- [x] `stop()` called in `onCreate` → the spec never materializes at mount

## 10. Action enforcement (managed MobX config)

- [x] Async method mutating state after `await` → no MobX `enforceActions` warning
- [x] `watch` callback assigning state → no warning
- [x] `configure({ manageMobxActions: false })` before first render → Mantle leaves MobX config untouched (spy on `mobx.configure`), with a positive-control file proving the spy catches the managed-mode call

## 11. Type-level tests (`expect-type`)

- [x] `PropsOf` inference (via `createComponent` return type)
- [x] `MantleComponent` assignability to strict `ComponentType` consumers (react-window-style)
- [x] `createForwardRef` ref typing
- [x] `BehaviorArgs` constructor-vs-`onCreate` resolution

---

**Formerly a known gap, now testable:** concurrent-render discard (an instance created during a render React throws away) no longer leaks by construction — specs are dormant until commit, and the render reaction is guarded by a FinalizationRegistry. The construction-creates-zero-reactions probe in section 9 pins the specs half; the registry half stays documented rather than tested (forcing GC in jsdom is not practical).

Sections 1–3 encode the design decisions behind v0.3.4 (onMount-first doctrine with spec resurrection as the safety net for pre-mount declarations, the atom-based props box, the pre-mount `addCleanup` dev warning), so a future refactor that breaks those semantics fails loudly rather than silently reverting.
