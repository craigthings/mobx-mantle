# Mantle Behaviors Improvement Plan

Goal: bring Behaviors to composition parity with custom hooks and Vue composables while preserving the current call-site DX. Every change below keeps `field = withThing(args)` looking exactly as it does today; the changes affect what that code does, not what it looks like.

**Key insight:** every framework's logic-sharing story (Vue composables, React custom hooks, Solid primitives) converged on small units that compose recursively. One-level reuse produces a shelf of widgets; recursive reuse produces a vocabulary. Nesting is therefore the capability change, and the rest of this plan supports it.

Priority order: 1 → 2 → 3 are the core milestone. 4 → 5 are the adoption wedge. 6 → 7 are documentation and verification.

---

## 1. Nested Behavior Collection

**Responsibility:** a Behavior declared as a field of another Behavior receives the full lifecycle relay, recursively.

**Approach:** mirror the Component's scan. `createBehavior`'s wrapper constructor scans own keys after `onCreate` (fields are populated by then) and registers child behaviors on the instance, same shape as `Component._collectBehaviors`. The three relay functions in `behavior.ts` (`layoutMountBehavior`, `mountBehavior`, `unmountBehavior`) recurse into children.

| Concern | Decision |
|---------|----------|
| Mount order | Children before their parent's `onMount` (parent may depend on live children) |
| Unmount order | Reverse of mount (parent's `onUnmount` before children tear down) |
| Detection | Existing `isBehavior()` marker check during own-key scan |
| Depth limit | None; recursion bounded by object graph |

**Edge cases:**
- A child behavior stored under an underscore-prefixed key is skipped by the scan (consistent with Component behavior collection). Document this.
- Cycles are theoretically possible if someone assigns a parent into a child. Guard with a visited set or document as unsupported.

**Why scan-based rather than a Vue-style implicit construction stack:** the scan keeps ownership visible as declared fields and matches how Components already collect behaviors. A construction-stack approach (register whatever is constructed while a host is constructing) would additionally catch behaviors created inside helper functions, but adds hidden coupling. Revisit only if real demand appears.

## 2. Reactive Arguments

**Responsibility:** let behaviors accept either a plain value or a getter, so prop changes flow into a behavior instead of being frozen at construction.

**Approach:** copy the convention Solid (`MaybeAccessor` + `access()`) and Vue (`MaybeRefOrGetter` + `toValue()`) both landed on independently.

| Addition | Purpose |
|----------|---------|
| `MaybeGetter<T> = T \| (() => T)` | Exported type for behavior argument signatures |
| `resolve(v)` | Returns `v()` if function, else `v`. One-line exported helper |

Behavior authors write `this.watch(() => resolve(this.source), ...)`. Consumers opt into liveness with an arrow: `withFetch(() => this.props.url)`. Static values keep working unchanged.

**Key insight:** any system where setup runs once must distinguish "the value now" from "the value over time"; a getter is the cheapest representation of the latter. React devs never faced this because hooks re-run every render. This convention is the explicit opt-in, using arrow syntax they already know from `watch(expr)`.

**Edge case:** a behavior argument that is legitimately a function (a callback, not a getter) is ambiguous with `MaybeGetter`. Behavior authors must choose per-argument which parameters are `MaybeGetter`; the library cannot infer it. Document with an example.

## 3. Late-Creation Dev Warning

**Responsibility:** a behavior assigned after construction (in `onCreate`, conditionally, or lazily) never gets collected, so its lifecycle silently never runs. Warn instead of failing silently.

**Approach:** during the Component's mount effect, re-scan own fields; any `isBehavior()` instance not present in `_behaviors` triggers a dev-only `console.warn` naming the field and the fix ("create behaviors as class fields"). Same spirit and mechanics as the pre-mount `addCleanup` warning. No production cost (guarded by `NODE_ENV`), no API change.

## 4. `useBehavior()` Adapter for Function Components

**Responsibility:** let plain React function components consume any behavior, removing the "adopt the whole component model first" wall.

**Approach:** a hook that hosts a behavior's lifecycle inside ordinary React primitives:

| Step | Mechanism |
|------|-----------|
| Instance creation | `useState(() => withThing(args))` initializer (once per mount lifetime) |
| Lifecycle relay | `useLayoutEffect`/`useEffect` calling the existing relay functions from `behavior.ts` |
| Reactivity | Consumer wraps rendering in `observer`, or the hook returns via `useObserver` subscription |
| StrictMode | Relay functions already handle remount resurrection (v0.3.4 machinery) |

**Integration point:** this inverts the adoption story. Logic written as a behavior runs in both worlds; mantle Components become the nicer host rather than the required one.

**Open question:** whether the hook forces a re-render on any observed change (heavier, simpler) or returns the observable instance and leaves observation to the consumer (lighter, requires `observer`). Decide during implementation; lean toward the simple version first.

## 5. Standard Library of Primitives

**Responsibility:** prove the composition claim and seed the ecosystem, VueUse-style.

Initial set (roughly a dozen): `withEventListener`, `withInterval`, `withTimeout`, `withAsync`, `withFetch`, `withLocalStorage`, `withWindowSize`, `withMediaQuery`, `withDebounce`, `withThrottle`, `withDocumentTitle`, `withPageVisibility`.

**Approach:** each primitive is small, uses `MaybeGetter` arguments, and at least two flagship behaviors are built by composing others (e.g. `withAutosave` = `withInterval` + `withFetch`) to demonstrate nesting paying off. These become the README's strongest side-by-side: the composed behavior next to its custom-hooks equivalent.

Ship as a separate entry point or package (`mobx-mantle/primitives`) so the core stays dependency-free.

## 6. Documentation Boundaries

**Responsibility:** state plainly what behaviors are not for, before issue reports do.

- Behaviors cannot call hooks (`useContext`, `useQuery`); hooks are render-scoped. The blessed pattern: read the hook in `render()`, pass the value where needed.
- Division of labor: behaviors own vanilla-JS integration, MobX-native logic, and cheaply-testable state machines; hooks own ecosystem bindings; `render()` is where they meet.
- Underscore-prefixed fields are invisible to behavior collection.

## 7. Test Coverage

Extends TEST-PLAN.md section 2. New cases per feature:

- Nested: grandchild lifecycle fires in order; reverse-order unmount; child behavior watchers survive StrictMode via existing resurrection.
- Reactive args: getter argument updates flow through; plain value stays static; `resolve()` handles both.
- Warning: fires for late-assigned behavior, silent for field-declared ones.
- Adapter: behavior hosted by `useBehavior()` mounts, reacts, unmounts, and survives StrictMode in a plain function component.
- Primitives: one composition test proving `withAutosave`-style layering works end to end.

---

**Sequencing note:** items 1 to 3 are self-contained library changes suitable for one release. Item 4 is its own release (new public API surface). Item 5 grows independently afterward and doubles as the documentation payload for the standalone repo launch.
