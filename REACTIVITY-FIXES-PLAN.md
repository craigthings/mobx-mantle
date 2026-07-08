# Reactivity Fixes Plan

**Objective:** Fix the three core reactivity issues — MobX action-enforcement warnings on async methods, render-phase reaction leaks under concurrent React/SSR, and the redundant self-notification render on prop changes — without changing the public API or documented DX.

**Success Criteria:**

- Async methods and watch callbacks that mutate state produce no MobX `enforceActions` warnings, with no user configuration required.
- Components whose renders are never committed (Suspense, aborted transitions, server rendering) create no live MobX reactions, so nothing leaks.
- A prop change triggers exactly one render for components that read props directly; the extra correction render occurs only when a computed-over-props is read in render.
- All existing documented behavior (StrictMode resurrection, `fireImmediately` before first paint, lifecycle ordering) still holds.
- `mobx-react-lite` is no longer a dependency.

**Overview:** Three independent fixes, ordered by effort. Fix 1 is a config change at module init. Fix 2 moves reaction creation from the render phase to the commit phase using the existing spec-deferral machinery. Fix 3 replaces `useObserver` with an owned render reaction so `PropsBox` can stop notifying the component about prop changes it already rendered with.

---

## 1. Suppress MobX Action Enforcement

**Responsibilities:** Stop MobX's default `enforceActions: "observed"` from warning on the async-method and watch-callback patterns the README showcases (`this.copied = true` after `await`, assignments in `watch` callbacks).

**Approach:** Call MobX's `configure({ enforceActions: 'never' })` once at Mantle module initialization, guarded by a new Mantle config flag so apps running deliberate strict-mode stores can opt out.

| Change | Where | Notes |
|--------|-------|-------|
| Add `manageMobxActions?: boolean` (default `true`) | `src/config.ts` `MantleConfig` | Opt-out for apps with strict non-Mantle stores |
| Call `mobx.configure({ enforceActions: 'never' })` at init | `src/index.ts` (or `config.ts` module scope) | Runs on import; re-check if user calls Mantle's `configure({ manageMobxActions: false })` — document that they must then restore their own setting |
| README section "MobX Action Enforcement" | `README.md` | Explain that Mantle relaxes this globally, why (async continuations can't be action-wrapped), and how to opt out |

**Edge case — user-configured MobX:** If the host app already called `mobx.configure`, Mantle's call clobbers `enforceActions` only (MobX merges config). Document this; do not attempt detection — MobX exposes no reliable public read of current config.

---

## 2. Defer Reaction Creation to Commit

**Responsibilities:** Ensure `watch`/`effect` registrations from field initializers and `onCreate` do not create live MobX reactions during the render phase. Reactions come alive only in `useLayoutEffect`, which runs solely on committed renders. This eliminates leaks from never-committed renders (Suspense throws, abandoned transitions, StrictMode's discarded pass) and makes SSR leak-free by construction (no commit on the server → no reactions).

**Key insight:** The `ReactiveSpec` infrastructure in `src/internals.ts` was built for exactly this — a spec with `dispose === null` is a recorded-but-dormant registration. The fix is to widen the deferral window from "until observable" to "until mounted."

### Changes

| Function | Current behavior | New behavior |
|----------|-----------------|--------------|
| `registerReactive` (`internals.ts`) | Creates reaction immediately once `_observed` | Creates immediately only once `_mounted`; before that, records a dormant spec |
| Component creation path (`mantle.tsx`, `materializeSpecs` call after `makeObservable`) | Materializes specs during render | Delete the call; keep setting `_observed` (still gates nothing being tracked pre-observability) |
| `Behavior` constructor (`behavior.ts`) | Materializes specs at construction | Delete the call; specs materialize with the parent component |
| Component `useLayoutEffect` mount path (`mantle.tsx`) | Calls `resurrectSpecs` only on remount | Unify: first mount calls `materializeSpecs`, remount calls `resurrectSpecs` (or merge both into one `activateSpecs(host)` helper) |
| `layoutMountBehavior` (`behavior.ts`) | Resurrects only on remount | Same unification as above |

### Edge Case: `fireImmediately` / `effect` initial-pass timing

These currently run at construction (before first render); they move to just-before-paint. The README's documented contract — "can run before the first paint" — is preserved, since `useLayoutEffect` is pre-paint. Code that relied on an effect mutating state *before the first render* now sees that state applied via a synchronous pre-paint re-render instead. Update the one README paragraph on `onCreate` watcher timing to describe the new sequencing.

### Edge Case: early disposal before mount

`stop()` called on a still-dormant spec must prevent later materialization — the existing `stopped` flag already handles this; verify with a test.

---

## 3. Owned Render Reaction + Props Self-Notification Skip

**Responsibilities:** Eliminate the redundant second render on every prop change, by making the component's own render reaction *not* track the props atom (React already delivers prop changes via `memo`), while computeds and user watchers still track it normally.

**Key insight:** `useObserver` hides its `Reaction` instance, so `PropsBox` can't distinguish "my own render is reading me" from "a computed/watcher is reading me." Owning the observer implementation exposes that identity.

### Step 1: Internal observer hook

Create `src/observer.ts` with a `useMantleObserver(renderFn, name)` hook — the standard ~60-line pattern: one MobX `Reaction` per component instance, `useSyncExternalStore` for scheduling, `reaction.track()` around the render function. Reference implementation: `mobx-react-lite`'s `useObserver`. Must include its concurrent-safety machinery (`FinalizationRegistry`-based cleanup of reactions whose renders never committed) — this complements Fix 2: specs are safe by deferral, the render reaction is safe by registry.

### Step 2: Props tracking skip

- The hook exposes its `Reaction` (return it, or accept a ref the component wires into the instance).
- `PropsBox.get()` skips `reportObserved()` when `_getGlobalState().trackingDerivation` is *this component's* render reaction. All other derivations (computeds, watchers, other components) track normally.
- The `useLayoutEffect` `reportChanged` path stays as-is — it now only reaches genuine external observers and computeds.

**Approach — residual behavior:** After this fix, the correction render happens only when render reads a computed-over-props (the computed invalidates at commit and re-triggers render before paint). The one-render staleness window for such computeds is fundamental (MobX cannot change a value without notifying; React forbids notifying mid-render) — document it in a README "How props reactivity works" subsection instead of fixing it.

### Step 3: Drop `mobx-react-lite`

Remove the dependency from `package.json` and the README requirements line. `smartBind` already reaches into `_getGlobalState()`, so this adds no new class of internal dependency; extend the existing dev-time internals check in `mantle.tsx` to cover what `observer.ts` relies on.

---

## Testing Checklist

### Action enforcement (Fix 1)
- [ ] Async method mutating state after `await` → no MobX warning
- [ ] `watch` callback assigning state → no warning
- [ ] `configure({ manageMobxActions: false })` → Mantle leaves MobX config untouched

### Leak safety (Fix 2)
- [ ] Field-initializer `watch` + component whose first render suspends → no live reaction exists (assert via disposer count / `onBecomeObserved` probe)
- [ ] `renderToString` of a component with `onCreate` watchers → no reactions created
- [ ] StrictMode mount → specs materialize once per committed mount; remount resurrects; no double-firing
- [ ] `stop()` called in `onCreate` → spec never materializes at mount
- [ ] `fireImmediately` watcher declared in `onCreate` → fires before first paint, sees post-`onCreate` state

### Render counts & props (Fix 3)
- [ ] Prop change on component reading `this.props.x` directly in render → exactly one render
- [ ] Prop change feeding a computed read in render → corrected value painted; at most one extra pre-paint render
- [ ] External watcher on `this.props.x` in another component → still fires on prop change
- [ ] Sibling observer component reading this component's computed-over-props → updates correctly
- [ ] HMR class swap and StrictMode double-render still work with the owned reaction

### Regression sweep
- [ ] Full existing test suite passes (behaviors, decorators, refs, lifecycle ordering, error routing)

---

## Files to Create/Modify

| File | Change | Purpose |
|------|--------|---------|
| `src/config.ts` | modify | `manageMobxActions` flag; MobX `configure` call at init |
| `src/index.ts` | modify | Ensure config side effect runs on import |
| `src/internals.ts` | modify | `registerReactive` gates on `_mounted`; optional unified `activateSpecs` |
| `src/mantle.tsx` | modify | Remove render-phase `materializeSpecs`; mount-path activation; swap `useObserver` → `useMantleObserver`; wire reaction identity into `PropsBox` |
| `src/behavior.ts` | modify | Remove constructor materialization; mount-path activation in `layoutMountBehavior` |
| `src/observer.ts` | create | Owned render reaction with concurrent-safe disposal |
| `package.json` | modify | Drop `mobx-react-lite` |
| `README.md` | modify | Action-enforcement section; timing paragraph update; props-reactivity subsection |

---

## Non-Goals

- Eliminating the one-render computed-over-props staleness window — fundamental to the React/MobX timing mismatch; documented instead.
- Any public API or DX changes (`watch`/`effect`/lifecycle signatures unchanged).
- Changing `addCleanup` one-shot semantics or the remount-resurrection model.
- SSR *rendering* support work beyond leak-freedom (hydration story stays in `MANTLE-WEB-ROADMAP.md`).
