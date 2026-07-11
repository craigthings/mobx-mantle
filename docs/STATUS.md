# Project Status & Open Threads

**Objective:** a living snapshot of where the project stands, what recently
landed, and the design questions currently open — so ideas have a home between
"conversation" and "plan." Update freely; delete entries when they ship or die.

*Last updated: 2026-07-09*

Doc map: [README](../README.md) (usage) · [ARCHITECTURE](./ARCHITECTURE.md)
(internals & rationale) · [VISION](./VISION.md) (why) ·
[MANTLE-WEB-ROADMAP](./MANTLE-WEB-ROADMAP.md) (web track) ·
[TEST-PLAN-ADVANCED](./TEST-PLAN-ADVANCED.md) (deferred test gaps)

---

## Design principles (decided)

- **Runtime-only surface.** The entire mechanism — reactivity, behaviors,
  props, sync — is runtime; the only build-time assumption is the standard
  JSX transform (ubiquitous, semantics-free). No custom Babel/Vite/TS
  transforms, ever, as part of the core contract. Rationale: every mechanic
  stays debugger-inspectable and bundler-portable; the reactivity boundary
  stays visible (an arrow means something you can see); Vue's Reactivity
  Transform retreat is the ecosystem's evidence that compile-time erasure of
  that boundary confuses more than it saves; and it matches MobX's own
  transparent-runtime ethos. Consequence: runtime conventions (one-arrow bag,
  reactive-object passing) are the permanent ceiling, not stopgaps — see
  question 1.

## Where we are

**v0.4.0 working tree, not yet released.** Core is in the strongest shape it
has been: owned observer (no `mobx-react-lite`), commit-deferred reactions
(leak-free discarded renders and SSR), props self-notification skip (one
render per prop change), managed MobX action policy, nested behaviors,
reactive arguments, `useBehavior()`, and a built-in behaviors library
(`mobx-mantle/behaviors`, 13 behaviors).

**Test suite:** 85 tests across 16 files + type-level tests, all green.
Vitest + jsdom + Testing Library; node-environment file covers the true
server path. Known gaps are catalogued in TEST-PLAN-ADVANCED (GC-dependent
registry cleanup, same-fiber HMR, real-browser concurrency/paint).

**Stability tiers:**

| Tier | Surface |
|------|---------|
| Stable | Component/ViewModel, createComponent, lifecycle, watch/effect, props reactivity, decorators |
| Settling | Behaviors (nesting, reactive args, `sync()`), useBehavior, observer(), built-ins |
| Experimental | `this.sync()` sentinel mechanics (shipped with tests, but young — watch for edge reports) |

## Recently landed (this cycle)

- `primitives` → `behaviors` rename (entry point, folder, docs) — one name for one concept
- `resolve` → `toValue` (Promise false-cognate removed)
- `watch(source)` accepts a `MaybeGetter` directly; constant-source watches dev-warn (the missing-arrow bug made loud)
- `this.sync(arg)` — one-way mirror of a MaybeGetter argument into an ordinary observable field (sentinel scan post-onCreate; hidden effect; dev write-guard). `withFetch`/`withAutosave` converted as showcases
- Bug fix: async lifecycle methods no longer crash at unmount (Promise mistaken for cleanup)
- Docs: ARCHITECTURE.md created (plan content promoted, plans deleted); README "Take it for a spin" playground section

## Near-term candidates

- [ ] Release v0.4.0 (changelog covering the above; the reactive-args work may argue for calling it 0.5.0)
- [x] README: config-object pattern for arg-heavy behaviors documented (Reactive Arguments → "Config-Object Behaviors"), pinned by a sync test
- [ ] `toValue` box support (`IObservableValue`) — two lines, Vue-`toValue` parity; deferred until someone actually wants it
- [ ] HMR seam + GC registry test from TEST-PLAN-ADVANCED (the two deterministic items)

---

## Open design questions

### 1. Props-style behaviors

**The idea:** behaviors take a props object instead of positional args —
consistency with components, named arguments, single liveness decision.

**The physics (settled):** component props are live because `this.props` is a
*reactive proxy passed by reference* — freshness comes from the object, plus
the parent's re-executing render re-evaluating JSX attributes. A behavior
field initializer executes once, so a plain object literal
(`{ query: this.query }`) is a bag of snapshots and nothing can revive it at
runtime. Three consequences:

| Consumer passes | Result | Status |
|-----------------|--------|--------|
| A reactive object (`this.props`, a store, another behavior) | Exactly component-props semantics, no arrow | **Works today** |
| A getter of an object (`() => ({ query: this.query })`) | Whole bag live with one arrow; callbacks safe (read, not called) | **Works today** via `this.sync(props)`; TanStack Solid Query precedent |
| A plain object literal of primitives | Snapshots — cannot be made live without a compiler | Physics says no |

**Decided (runtime-only principle):** don't replace positional args, and the
compiler escape hatch is permanently off the table — the table above is the
ceiling, and it's a good one. Size rule — positional for 1–2-arg behaviors
(the stdlib stays as-is), the `MaybeGetter<Props>` object pattern as the
blessed shape for arg-heavy behaviors. Do NOT bless per-key getters
(`{ url: () => x }`) — three ways to say "live" is convention proliferation.
A runtime-flavored version of first-class behavior props (e.g. `Behavior`
formally documenting "pass a reactive object and it behaves exactly like
component props") could still be worth a README section; revisit if behavior
signatures start hurting in practice.

### 2. `sync()` maturation

Shipped Behavior-only (Components construct in a different order and have
props instead of factory args). Open items: does the sentinel window (reading
a synced field inside onCreate before the scan) bite anyone in practice? Is a
Component-side equivalent ever warranted? Does the write-guard need an escape
hatch (`sync(arg, { writable: true })`) for two-way cases, or is one-way the
permanent contract? Default stance: one-way forever; two-way requests should
become owned state + watch.

### 3. Adapter strategy ("Phase 2.5")

Behaviors are renderer-agnostic in principle; the relay functions are the
shape of a Lit ReactiveController. A `mantle/lit` adapter (~50 lines) plus a
documented vanilla pattern would let behaviors compete for Lit's logic layer
without a framework-switch ask — and double as a market probe for the web
track, cheaper than Phase 3's custom-element export. Gated on: core split
(ROADMAP Phase 1) making `Behavior` importable without React.

### 4. Versioning & release posture

Pre-1.0: conventions may still move (this cycle renamed two public names).
The bar for 1.0 per ROADMAP Phase 2: tests green (done), behaviors
de-experimentalized, docs teach the doctrine, claims benchmarked or removed.
Benchmarks (js-framework-benchmark or honest micro-benchmarks for the
props-skip claim) remain the visibly unstarted item.

---

## Long arc (pointers, not plans)

- **Custom-element export** (ROADMAP Phase 3) — the defensible slice of
  mantle-web; serves design-system/widget teams; market probe for Phase 4.
- **Mantle-web renderer** (Phase 4, gated) — child-component reconciliation is
  the unpriced hard part; design-first if entered at all. Per the runtime-only
  principle, it would be runtime JSX (standard transform, re-run render, DOM
  diff) — no Solid-style compiled templates, which the roadmap's architecture
  already assumed.
- **Monorepo core split** (Phase 1) — prerequisite for adapters and the web
  target; cheap during a repo migration, painful later.
