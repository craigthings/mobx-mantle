# Mantle-Web Roadmap

A sequenced path from today's mobx-mantle toward the Mantle-Web vision (see the author's `mantle-web-architecture.md`). Each phase gates the next: the renderer is the last thing built, not the first, and only if earlier phases show pull.

**Key insight:** mantle-react's unique pitch (Svelte-like DX inside the React ecosystem) competes with nobody, while a standalone renderer competes with Lit, Solid, and Preact on taste alone. So investment flows to React first, and the web target earns its way in through a bridge feature rather than a rewrite.

---

## Phase 1: Monorepo Core Split (do immediately, during the repo migration)

**Responsibility:** factor the library into renderer-agnostic core and a React adapter, so the web target becomes an additive package instead of a fork. Cheap now, painful later; correct architecture even if mantle-web never ships.

```
mantle/
├── packages/
│   ├── core      →  Component, Behavior, watch/effect, specs, decorators, config
│   └── react     →  createComponent, hooks wiring, props sync, HMR
```

### Module disposition

| Today | Goes to | Notes |
|-------|---------|-------|
| `internals.ts` (specs, resurrection, proto-info caching) | core | See key insight below |
| `Behavior`, `createBehavior`, deferral logic | core | Plus BEHAVIORS-PLAN items 1 to 3 |
| `decorators.ts`, `config.ts`, dev warnings | core | Renderer-agnostic already |
| `Component` class body (state, watch, effect, addCleanup, lifecycle signatures) | core | |
| `smartBind` | core | MobX-generic, not React-specific |
| `PropsBox` | core (interface), react (silent-sync usage) | Silent sync exists for React's render constraint; other renderers may call `set()` directly |
| Hooks wiring, `useObserver`, memo/forwardRef, HMR handling | react | The only genuinely React-specific code |

**Key insight:** the v0.3.4 remount machinery (spec resurrection, `addCleanup` warning, onMount-first doctrine) is core infrastructure, not React baggage. Custom Elements fire `disconnectedCallback`/`connectedCallback` on DOM *moves*, which is the same "instance survives, mount lifetime cycles" problem StrictMode simulates. Any web renderer needs this on day one.

**Edge case:** TEST-PLAN.md splits along the same line. Sections covering watch/effect mechanics, behaviors, caching, and disposal become core tests; props reactivity and StrictMode mounting stay in the react package.

## Phase 2: Mantle-React to Excellence (the main investment)

**Responsibility:** make the React package trustworthy and compelling before any new target exists. This is where the audience lives (MobX's installed base, tool-app builders, hooks-fatigued teams).

| Work item | Source |
|-----------|--------|
| Test suite | TEST-PLAN.md |
| Nested behaviors, reactive args, late-creation warning | BEHAVIORS-PLAN.md items 1 to 3 |
| `useBehavior()` adapter for plain function components | BEHAVIORS-PLAN.md item 4 |
| Primitives library with composition flagship | BEHAVIORS-PLAN.md item 5 |
| enforceActions story, headless ViewModel test helper | Open items from the v0.3.4 evaluation |

**Exit criteria:** the package is 1.0-able. Tests green, behaviors stable (experimental label removed), docs teach the onMount-first doctrine, claims benchmarked or removed.

## Phase 3: Custom-Element Export (the bridge feature and market probe)

**Responsibility:** let a mantle-react component ship as a Custom Element usable in any host page or framework, without building a renderer.

**Approach:** `createCustomElement(Class, { tag, attributes })` in the react package. The custom element hosts a React root internally (`createRoot` on `connectedCallback`); the component tree inside stays React-rendered. Adopts the architecture doc's attribute map and coercion design as-is.

| Concern | Decision |
|---------|----------|
| Interior rendering | React root inside the element; no new reconciler needed |
| Attribute props | Explicit `attributes` map with String/Number/Boolean coercion, per the architecture doc |
| Rich props | Property setters on the host element, wired to the component's observable props |
| DOM moves | Microtask + `isConnected` check in `disconnectedCallback` so reparenting is not treated as unmount |
| Shadow DOM | Optional flag; default off to keep CSS-in-JS and CSS Modules working unchanged |

**Key insight:** this is the defensible slice of the mantle-web vision. It serves real mantle-react use cases (design systems, embeddable widgets, micro-frontends), and it doubles as the market probe: real usage of the export feature is the evidence that justifies Phase 4. No usage answers the renderer question cheaply.

## Phase 4: Full Mantle-Web Renderer (gated, design-first)

**Gate:** enter only if Phase 3 shows pull, or the studio wants it for its own products (where adoption stops mattering and preference legitimately decides).

**First design task, before any code:** the child component reconciliation layer. When a parent's autorun re-runs `render()`, `h()` re-evaluates child component JSX; without an instance map (position, key, class) children are re-instantiated every parent render, losing state and leaking autoruns. This is the unpriced hard part of the architecture doc and the historical failure point of small frameworks. It must be designed, sized, and prototyped first; if it cannot stay small and correct, that is the signal to stop at Phase 3.

**Known corrections to carry into the design** (from the architecture review):

- `requestAnimationFrame` fires before paint; "after paint" onMount needs rAF-then-rAF or equivalent
- morphdom does not carry `addEventListener` listeners across updates; needs `onBeforeElUpdated` rebinding or property-style handlers
- Keyed reconciliation must move nodes without triggering CE disconnect teardown
- `children` for class components needs a type definition shared through core
- Performance claims versus React should come from js-framework-benchmark runs, not estimates

---

**Sequencing note:** Phases 1 and 2 overlap naturally (the split lands first, excellence work continues inside it). Phase 3 is a minor release of the react package. Phase 4 is a new package and a new commitment; the gate exists so it is entered deliberately, not by drift.
