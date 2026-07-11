# MobX Mantle — Architecture & Developer Guide

**Objective:** Everything a new contributor needs to understand how Mantle works
internally, the design decisions behind it, and how to develop and test it.

**Who this is for:** contributors to the library. For *using* Mantle in an app,
see [README.md](../README.md). For product direction see
[VISION.md](./VISION.md); for the browser-framework track see
[MANTLE-WEB-ROADMAP.md](./MANTLE-WEB-ROADMAP.md).

---

## Getting up and running

```
npm install
npm run dev         # vite playground (playground/) for manual testing
npm run build       # tsup → dist (esm + cjs, two entry points)
npm test            # vitest run — full suite (jsdom)
npm run test:watch  # vitest in watch mode
npm run test:types  # tsc --noEmit -p tsconfig.test.json (type-level tests)
```

Peer deps are `react >=18` and `mobx >=6`. The library ships two entry points:
the core (`mobx-mantle`) and the built-in behaviors library (`mobx-mantle/behaviors`).

---

## Module map

```
src/
├── mantle.tsx        Component base class, createComponent, PropsBox, smartBind
├── behavior.ts       Behavior base class, createBehavior, the lifecycle relay
├── observer.ts       useMantleObserver (owned render reaction), observer() HOC
├── internals.ts      ReactiveSpec deferral (registerReactive/activateSpecs), proto cache
├── config.ts         globalConfig, configure(), the MobX action policy
├── decorators.ts     Mantle @observable/@action/@computed (Symbol.metadata based)
├── reactive-args.ts  MaybeGetter<T> + toValue() (value-or-getter convention)
├── useBehavior.ts    Host a behavior inside a plain function component
└── behaviors/        withFetch, withAutosave, withWindowSize, … (separate entry)
```

| File | Responsibility |
|------|----------------|
| `mantle.tsx` | The `Component` class (state, lifecycle, `watch`/`effect`, `ref`), `createComponent` (the render-time wiring), `PropsBox` (props-as-atom), `smartBind` (method binding) |
| `behavior.ts` | `Behavior` class, `createBehavior` factory (callable without `new`), and `layoutMountBehavior`/`mountBehavior`/`unmountBehavior` — the relay that recurses into nested behaviors |
| `observer.ts` | `useMantleObserver` — Mantle's own render-reaction hook (replaces `mobx-react-lite`), plus the `observer()` HOC for plain FCs |
| `internals.ts` | `ReactiveSpec` machinery: `registerReactive` records dormant specs, `activateSpecs` brings them alive at commit; per-class prototype-info cache |
| `config.ts` | Global config + `applyMobxActionPolicy` (the lazy, once-only MobX `enforceActions` setup) |

---

## How a component works, end to end

**Flow (per mounted component instance):**

1. **Render phase — construct once.** `createComponent`'s forwardRef function
   creates the instance (`new ComponentClass(props)`) on the first render, wires
   its render reaction into `PropsBox`, collects child behaviors, applies
   observability (decorator / auto / legacy), and calls `onCreate(props)`.
2. **Render phase — every render.** `_syncProps` silently updates the props
   value; the render call is tracked by the owned reaction (`useMantleObserver`).
3. **Commit phase — layout effect.** `activateSpecs` brings dormant
   `watch`/`effect` registrations alive, then `onLayoutMount` runs (children
   behaviors first).
4. **Commit phase — passive effect.** `onMount` runs; `onUpdate` runs after
   every render; the cleanup disposes watchers, runs `onUnmount`, and tears down
   behaviors on unmount.

The component is wrapped in `React.memo`, so a parent re-render with
shallow-equal props skips it — matching `observer()`'s behavior.

**Lifecycle contract:**

| Hook | When | Cleanup |
|------|------|---------|
| `onCreate(props)` | Once, during construction (render phase) | — |
| `render()` | Every render, tracked | — |
| `onLayoutMount()` | Commit, pre-paint (layout effect) | Return a function |
| `onMount()` | Commit, post-paint (passive effect) | Return a function |
| `onUpdate()` | After every render | — |
| `onUnmount()` | Unmount | — |

**Key insight:** only the `render()` call is tracked by MobX. Everything else
(field mutation, method calls) flows through observables, so re-renders happen
because render *read* something that later *changed*.

> **Gotcha — lifecycle methods must be synchronous.** A method that returns a
> Promise (e.g. `async onMount()`) is *not* a cleanup function. Mantle guards
> this: only a returned function is treated as cleanup (a returned Promise is
> ignored, with a dev warning). Write a sync lifecycle method that calls an
> async one.

---

## The reactivity model

In the default (auto-observable) mode, `makeComponentObservable` annotates the
instance without decorators:

| Member kind | Becomes | Notes |
|-------------|---------|-------|
| Instance field | `observable` (deep) | `this.ref()` objects and behavior instances → `observable.ref` (identity preserved) |
| Getter | `computed` | Cached, invalidates on dependency change |
| Method | `smartBind`-wrapped | *Not* `action.bound` — see below |

**Approach — `smartBind` instead of `action.bound`:** an action wrapper breaks
observable tracking when a method is called inside a render helper. `smartBind`
inspects `_getGlobalState().trackingDerivation`: inside a tracking context
(render/computed/reaction) it calls through untouched (tracking preserved);
outside (event handlers) it wraps in `runInAction` so multi-field mutations
batch into one render.

Prototype facts (getter keys, method keys) are identical for every instance of a
class, so `collectProtoInfo` computes them once and caches per class
(`configure({ cacheAnnotations: false })` to disable). The cache stores *names*,
not bound references, so spying a prototype method before instantiation still
works.

Decorator mode (`autoObservable: false`) reads annotations from
`Symbol.metadata` (Mantle's own `@observable`/`@action`/`@computed`), and falls
back to `makeObservable(instance)` for MobX's own decorators. Absent
`Symbol.metadata`, it degrades gracefully to the auto path.

---

## Props reactivity — the subtle part

*(Rationale consolidated from the reactivity-fixes work.)*

**The problem:** React forbids updating other components mid-render. MobX
notification is atomic with the change — there is no "quiet update." So a prop
that flows into an observable cannot simply `reportChanged()` during render.

**The design — `PropsBox`, an atom with two write modes:**

| Method | Effect | Called from |
|--------|--------|-------------|
| `setSilently(v)` | Update value, do **not** notify | `_syncProps`, during render |
| `set(v)` | Update value **and** `reportChanged()` | `useLayoutEffect`, after render commits |
| `get()` | `reportObserved()` (tracked) — *except* self-reads | `this.props` |

**Fix 1 — silent sync:** during render, props are updated silently so
`this.props` is current, but observers are notified only in the layout effect
(after React finishes rendering) — avoiding "Cannot update component A while
rendering component B."

**Fix 2 — self-notification skip:** `PropsBox.get()` skips `reportObserved()`
when the reading derivation is *this component's own render reaction* (matched
via the `RenderReactionHolder` wired from `observer.ts`). React already
re-renders on prop change through `memo`, so tracking the props atom in the
render reaction would only schedule a redundant second render. Computeds,
watchers, and *other* components still track normally.

**The residual staleness window (documented, not fixed):** a computed that reads
props stays cached at its old value for one render after a prop change (the atom
was synced silently, not changed), then invalidates at the layout-effect
`reportChanged` and re-renders *before paint*. This one-render "wrong blink" is
fundamental — MobX can't change a value without notifying, React can't notify
mid-render — so it's corrected pre-paint rather than eliminated.

> Owning the render reaction (rather than using `mobx-react-lite`'s hidden one)
> is what makes the self-notification skip possible: `PropsBox` needs the
> reaction's *identity* to recognize a self-read. This is why Mantle has its own
> `useMantleObserver` and no longer depends on `mobx-react-lite`.

---

## Deferral & leak safety

*(Rationale consolidated from the reactivity-fixes work, Fix 2.)*

`watch`/`effect` registrations made before mount (field initializers, `onCreate`)
do **not** create live MobX reactions during render. They are recorded as dormant
`ReactiveSpec`s and materialized only in the commit-phase layout effect
(`activateSpecs`).

**Why:** renders React never commits (Suspense throws, aborted transitions,
StrictMode's discarded pass, server rendering) then create **zero** reactions —
leak-free by construction. On the server there is no commit, so `renderToString`
leaks nothing.

| Function | Behavior |
|----------|----------|
| `registerReactive(host, create)` | If `_mounted`, create immediately; else record a dormant spec |
| `activateSpecs(host)` | First mount: materialize dormant specs. Remount (`_wasUnmounted`): re-create specs disposed at unmount |

**StrictMode resurrection:** React 18 dev double-invokes mount as
mount → unmount → remount with the *same instance*. The `_wasUnmounted` flag lets
`activateSpecs` re-create the exact watchers disposed at the simulated unmount —
so a watcher declared in `onCreate` ends up live exactly once, not zero or twice.

**The render reaction's own leak guard:** the reaction created eagerly in
`useMantleObserver` for a render that never commits is disposed by a
`FinalizationRegistry` (GC-based). Specs are safe by deferral; the render
reaction is safe by registry.

**DX consequences a contributor must respect:**
- First render must not depend on any `watch`/`effect` having run — they come
  alive at commit, not construction.
- Pre-mount `addCleanup` is **one-shot**: it runs at unmount and is *not*
  re-created on remount (a dev warning fires). Acquire resources in `onMount`, or
  use `effect()` for a remount-safe setup/teardown pair.

---

## Action policy

*(Rationale consolidated from the reactivity-fixes work, Fix 1.)*

MobX's default `enforceActions: "observed"` warns whenever observed state is
mutated outside an action — which includes every async continuation
(`this.value = x` after `await`) and every `watch` callback, the exact patterns
Mantle encourages. `applyMobxActionPolicy` calls
`configure({ enforceActions: 'never' })` once, lazily, at the first
component/behavior creation.

Lazy (not at import) so an app can opt out via
`configure({ manageMobxActions: false })` during startup regardless of import
order. Apps running deliberate strict-mode MobX stores opt out and own their own
`enforceActions` setting.

---

## Behaviors

*(Rationale consolidated from the behaviors work.)*

**Key insight:** every framework's logic-sharing story (React hooks, Vue
composables, Solid primitives) converged on small units that compose
*recursively*. One-level reuse produces a shelf of widgets; recursive reuse
produces a vocabulary. Nesting is the capability that matters; the rest supports
it.

`createBehavior(Def)` returns a factory callable with or without `new` (a Proxy
handles the no-`new` call). Its wrapper constructor: applies the action policy,
runs the user constructor + `onCreate(args)` *before* `makeObservable` (so the
field scan sees `onCreate`-assigned values), collects child behaviors, and makes
the instance observable.

| Feature | Mechanism |
|---------|-----------|
| **Nested behaviors** | A behavior declared as a field of another is collected and gets the full relay. Children mount before parents; unmount in reverse. Cycles are guarded by a visited set. Underscore-prefixed fields are skipped. |
| **Reactive arguments** | `MaybeGetter<T> = T \| (() => T)`. Consumers opt into liveness with an arrow: `withFetch(() => this.props.url)`; plain values freeze at construction. Authors normalize with `this.sync(arg)` (a one-way mirror into an ordinary observable field, driven by a hidden effect bound via a post-onCreate sentinel scan), pass a `MaybeGetter` straight to `watch(source, cb)` (a constant source dev-warns unless `fireImmediately`), or unwrap in place with `toValue()` inside effect bodies. Same convention as Vue's `toValue`/Solid's `access`. Observable *objects* pass by reference and need none of this. |
| **Late-creation warning** | A behavior assigned after construction (in `onCreate`, conditionally) is never collected, so its lifecycle would silently never run. A dev-only re-scan at mount warns and names the field. |
| **`useBehavior()`** | Hosts a behavior's lifecycle inside a plain function component (`useState` factory + the relay functions). Wrap the component in `observer()` to track its observables. |
| **Built-in behaviors** | `mobx-mantle/behaviors` — ~a dozen behaviors; flagships like `withAutosave` (= `withInterval` + `withAsync`) and `withFetch` (= `withAsync` + `watch`) are themselves compositions, proving nesting pays off. |

**Boundaries (state them before issue reports do):** behaviors cannot call React
hooks (`useContext`, `useQuery`) — hooks are render-scoped. The blessed pattern:
read the hook in `render()`, pass the value in (as a reactive arg for liveness).
Behaviors own vanilla-JS integration, MobX-native logic, and cheaply-testable
state machines; hooks own ecosystem bindings; `render()` is where they meet.

---

## Testing

The suite lives in `test/` (vitest + jsdom + `@testing-library/react`), ~75
tests across ~15 files, organized by the areas above. Shared fixtures in
`test/helpers.tsx`: a StrictMode mount helper, `onError` capture, `deferred`, and
an `onBecomeObserved` reaction probe (the public-API way to assert a reaction was
created and later disposed). The global `afterEach` (`test/setup.ts`) unmounts
and resets Mantle config between tests.

- **Run:** `npm test` (suite), `npm run test:types` (type-level via `tsc`).
- **Server-path tests** run in the node environment (`*.node.test.tsx`) so
  `window` is undefined and the server-untracked render path is exercised.
- **Action-policy tests** are split across files because managed-vs-opt-out
  needs different global module state; vitest isolates modules per file.
- **What's deliberately not covered** (GC timing, Fast-Refresh HMR, real-browser
  concurrency/paint) and how it *could* be tested is in
  [TEST-PLAN-ADVANCED.md](./TEST-PLAN-ADVANCED.md).

---

## Key invariants (contributor cheat sheet)

- Only `render()` is tracked; re-renders come from reads changing later.
- Props are synced silently during render, notified in the layout effect.
- The render reaction does not track the props atom (self-notification skip).
- `watch`/`effect` from field initializers and `onCreate` are dormant until
  commit; never rely on them during first render.
- StrictMode remounts the same instance; `_wasUnmounted` drives resurrection.
- Methods are `smartBind`-wrapped, not actions, so render-helper tracking works.
- Pre-mount `addCleanup` is one-shot; use `onMount` or `effect()` for
  remount-safe teardown.
- Lifecycle methods must be synchronous; a returned Promise is not a cleanup.
- MobX `enforceActions` is set to `'never'` unless `manageMobxActions: false`.
