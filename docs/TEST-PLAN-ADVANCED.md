# MobX Mantle — Advanced / Deferred Test Plan

**Objective:** Capture the test cases that the main suite deliberately leaves
uncovered because they are non-deterministic, runtime-dependent, or require a
real browser — with concrete strategies, tooling, and honest priority for each.

**Success Criteria:**
- Each remaining gap has a named strategy and the tool that fits it.
- The "our logic vs. the runtime's guarantee" split is explicit for every case, so we test what we own and trust what we don't.
- Nothing flaky is proposed as a blocking CI gate; probabilistic checks are scoped to nightly/optional runs.
- The source seams needed to make a case deterministic are identified up front.

---

## Overview

The main [TEST-PLAN.md](./TEST-PLAN.md) covers everything observable through the
public API in jsdom. What remains falls into three buckets: **GC-dependent**
cleanup (FinalizationRegistry), **dev-runtime-dependent** behavior (Fast
Refresh / HMR), and **real-browser** fidelity (concurrent scheduling, paint
timing, true multi-tab). For most of these the trick is to separate the slice
that is *our code* (unit-testable with the right seam) from the slice that is a
platform guarantee (not ours to prove).

**Guiding principle:** prefer a deterministic unit test of our wiring over a
faithful-but-flaky E2E of the runtime. Reach for Playwright only when the
browser itself is the thing under test.

---

## 1. Discarded-render reaction cleanup (FinalizationRegistry)

`useMantleObserver` creates the render `Reaction` eagerly, before commit. If
React never commits that render (Suspense throw, aborted transition), only
`uncommittedReactionRegistry` in `src/observer.ts` disposes it, on GC.

**Key insight:** two things are conflated here — *React discarding the fiber*
(React's contract) and *our registry disposing the orphaned reaction* (ours).
Only the second is worth a test.

| Strategy | Tool | Notes |
|----------|------|-------|
| Unit-test the registry wiring | Node `--expose-gc` + vitest | Register a reaction that observes a probe, drop all refs, force GC, assert disposed. Deterministic *enough* if refs are truly dropped. |
| Faithful integration check | Playwright + CDP `HeapProfiler.collectGarbage()` | Real Chromium GC is more reliable than V8 `global.gc()`, and gives real concurrent scheduling. Still probabilistic. |

**Approach (recommended):** export the registry (or a `__test` hook) and assert
via the `observationProbe` helper:

```
adm.reaction.track(() => probe.get());   // reaction now observes the probe
registry.register(target, adm, adm);
target = null; adm = null;               // drop strong refs
await forceGC();                         // gc() ×N with setTimeout(0) between
expect(probe.observed).toBe(false);      // finalizer ran and disposed it
```

### Edge Case: lingering strong references
The finalizer only fires if the registry *target* is collectable. `admRef` (a
`useRef`) and any closure capturing `adm` must be dropped. A single retained
reference silently prevents collection and the test hangs rather than fails —
add a timeout so a leak surfaces as a failure, not a stall.

**Priority:** nightly / non-gating. FinalizationRegistry timing is unspecified;
treat a pass as evidence, never a guarantee.

---

## 2. HMR / Fast Refresh instance swap

The branch in `createComponent` (`classRef.current !== ComponentClass` →
discard instance) only runs when the module re-executes with a new class
identity while React preserves the fiber — i.e. Fast Refresh. `ComponentClass`
is captured in the closure, so the branch is unreachable through the public API.

| Strategy | Tool | Notes |
|----------|------|-------|
| Extract a testable seam | vitest | Move the "should discard" decision to a pure function or a swappable `classRef`; unit-test the swap + `[vm]`-effect disposal deterministically. |
| Faithful E2E | Playwright + `vite dev` | Programmatically edit a component file, await the HMR update, assert clean-slate behavior. Slow, environment-sensitive — one smoke test at most. |

**Approach (recommended):** the seam. The branch guarantees two things:
1. The old instance is dropped and a fresh one created (clean slate — Mantle
   intentionally does *not* preserve state across a class change).
2. The old instance's watchers are disposed (via the `useEffect(..., [vm])`
   dependency firing on `vm` change).

Both are assertable once the class identity is injectable, using the existing
`observationProbe` to prove the old watcher went unobserved.

### Edge Case: distinguish from a normal remount
A key-forced remount (already tested in `leak.test.tsx`) exercises the
`[vm]`-disposal path but *not* the same-fiber class swap. The seam test must
hold the fiber stable while changing the class to cover the real branch.

**Priority:** seam-based unit test — worth doing. E2E — optional.

---

## 3. Concurrent rendering: Suspense discard & aborted transitions

Producing a genuinely un-committed render inside a test.

**Approach:** RTL can suspend — render a child that throws a controllable
promise inside `<Suspense>`; React constructs instances during the attempt and
bails to fallback. Assert that instances built during the discarded pass create
**zero live reactions** (the specs-dormant-until-commit guarantee, exercised
here through React's *real* discard path rather than a manual `activateSpecs`).

For aborted transitions: `startTransition` a low-priority update, then interrupt
it with a higher-priority `act` update before it commits.

### Edge Case: StrictMode × Suspense
StrictMode double-invocation layered on a suspended render can construct an
instance up to three times. Assert the settled state (one live reaction after
the tree finally commits), not intermediate counts.

**Priority:** medium. The zero-reactions-on-discard assertion is cheap and
meaningfully strengthens the leak story; the render-reaction cleanup half still
needs §1's GC.

---

## 4. useSyncExternalStore tearing under concurrent features

Our snapshot is a `symbol` bumped by the reaction. `useSyncExternalStore` is
designed to prevent tearing, but time-sliced renders reading a shared
observable are where tearing would show if the snapshot contract were wrong.

**Approach:** render many components off one shared observable, mutate inside a
`useTransition`, assert every component displays the *same* value after the
transition settles (no split-brain). Hard to force interleaving deterministically
in jsdom; a real browser under Playwright with artificial slowdown is more
convincing.

**Priority:** low unless heavy concurrent usage is a target. Otherwise rely on
the `useSyncExternalStore` contract and the §3 concurrent tests.

---

## 5. Real paint timing — the "wrong blink"

jsdom does not paint, so we assert the *final* DOM value plus render count (the
computed-over-props test), but not that the correction lands before an actual
paint frame.

**Approach:** Playwright; instrument render output with timestamps relative to
`requestAnimationFrame`, asserting the corrected value is committed within the
same frame as the triggering change. Screenshot diffing is overkill and brittle.

**Priority:** low. The render-count + layout-effect-ordering unit test already
pins the *mechanism*; this would only confirm the human-invisible timing.

---

## 6. Cross-context realism (storage, BroadcastChannel, multi-tab)

`withLocalStorage`'s cross-tab sync is tested by synthesizing a `StorageEvent`
in a single jsdom — which covers our handler but not the browser actually
delivering the event across contexts.

**Approach:** Playwright with two same-origin browser contexts; write
`localStorage` in page A, assert page B's `withLocalStorage` value updates.
Genuine multi-tab delivery.

**Priority:** low-medium. Our logic is covered; this validates the platform
plumbing we depend on.

---

## 7. Long-run leak / soak

Single mount/unmount cycles pass, but slow accumulation across many cycles
(e.g. a spec array or disposer list that grows) would slip through.

**Approach:** loop mount→unmount N×100 times in vitest, tracking live reaction
count via the probe (or a reaction counter fixture); assert it stays bounded.
For memory specifically, Playwright + CDP heap snapshots before/after to assert
no monotonic growth.

**Priority:** medium. The in-process N-cycle probe loop is cheap and catches the
most likely regressions; heap-snapshot soak is nightly-only.

---

## 8. Fake-timer fidelity for primitives

`vi.useFakeTimers` mocks timers but not the full microtask/real-timer interplay.
Trailing-edge `withThrottle`, and `withInterval` overlapping an in-flight
`withAsync`, are where fake-vs-real scheduling can diverge.

**Approach:** run a small subset of primitive tests under *real* timers with
short delays; or Playwright for authentic scheduling on the flagship
compositions (`withAutosave`).

**Priority:** low. Fold into §6/§7 if a Playwright harness is stood up anyway.

---

## Testing Checklist

### GC / disposal (nightly, non-gating)
- [ ] Registry disposes a reaction whose target was dropped, after forced GC
- [ ] N-cycle mount/unmount soak keeps live-reaction count bounded
- [ ] Heap snapshot shows no monotonic growth over a soak (Playwright + CDP)

### HMR (unit deterministic; E2E optional)
- [ ] Class-identity swap on a stable fiber discards the old instance
- [ ] Old instance's watchers are disposed on the swap (probe goes unobserved)
- [ ] New instance starts from a clean slate (no state carried over)
- [ ] E2E: real Vite HMR edit preserves the tree and disposes old reactions

### Concurrent (RTL + real browser)
- [ ] Instance constructed during a Suspense-discarded render creates zero live reactions
- [ ] Aborted transition leaves no live reactions once settled
- [ ] Shared observable shows no tearing across components after a transition

### Real-browser fidelity (Playwright)
- [ ] Computed-over-props correction commits within the same paint frame
- [ ] `withLocalStorage` syncs across two real same-origin tabs
- [ ] Flagship primitives behave correctly under real (non-mocked) timers

---

## Files to Create / Modify

| File | Change | Purpose |
|------|--------|---------|
| `src/observer.ts` | modify | Export `uncommittedReactionRegistry` (or a `__test` hook) for the GC test |
| `src/mantle.tsx` | modify | Extract the HMR discard decision into an injectable seam |
| `test/gc.test.ts` | create | Registry disposal + soak, run under `node --expose-gc` |
| `test/hmr.test.tsx` | create | Seam-based class-swap disposal, deterministic |
| `test/concurrent.test.tsx` | create | Suspense/aborted-transition zero-reaction assertions |
| `playwright/` suite | create | Optional: HMR E2E, cross-tab storage, tearing, paint timing |
| `package.json` | modify | Add `test:gc` (expose-gc pool flag) and, if adopted, `@playwright/test` scripts |

---

## Non-Goals

- Proving FinalizationRegistry timing is deterministic — it is not, by spec.
- Testing React's own fiber-discard behavior — that is React's contract, not Mantle's.
- Pixel-perfect screenshot diffing — the mechanism is unit-tested; visual timing confirmation does not need image comparison.
- Supporting runtimes without `FinalizationRegistry` beyond the existing dev warning in `src/observer.ts`.
- Making any probabilistic (GC/soak/E2E) check a blocking CI gate.
