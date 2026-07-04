# Mantle CSS Performance Direction

Mantle-Web can support reactive scoped CSS without a compiler by treating the component tree as the source of truth and regenerating stylesheet text from live component instances.

**Key insight:** Whole-string stylesheet replacement is fast enough for realistic UI scales when styles are grouped well. The expensive case is updating many separate `<style>` tags every frame.

---

## Target Model

Mantle should generate one stylesheet from the live component tree. Each styled component instance contributes a scoped CSS block to that sheet.

```text
Component tree
  Button#m-1
  Button#m-2
  Card#m-3
  Card#m-4

Generated stylesheet
  <style data-mantle-styles>
    .m-1 { ... }
    .m-2 { ... }
    .m-3 { ... }
    .m-4 { ... }
  </style>
```

Each component instance gets a unique scope class. Mantle rebuilds the generated stylesheet from registered live instances.

**Key distinction:** This is "full regeneration" for CSS, not DOM. DOM updates still use component-local MobX invalidation and DOM patching. CSS can be regenerated as text because there is no element identity, focus, selection, or event-handler state to preserve inside a stylesheet.

---

## Responsibilities

| Piece | Responsibility |
|-------|----------------|
| Component instance | Owns state, props, computed values, and `get styles()` output |
| Scope id | Provides per-instance style isolation, such as `m-42` |
| Style registry | Tracks live styled component instances in tree/render order |
| Style flush scheduler | Batches dirty style updates into one flush per frame |
| Stylesheet element | Stores generated CSS for all live styled instances |

---

## Runtime Flow

### Fresh Render

1. Component instance is created.
2. Mantle assigns a scope id.
3. Instance root receives the scope class.
4. Instance registers with the global style registry.
5. Style registry rebuilds the generated stylesheet from registered instances.

### Reactive Update

1. Observable state used by `get styles()` changes.
2. MobX marks that instance's style computation dirty.
3. Mantle schedules a style flush.
4. On flush, the style registry rebuilds the full stylesheet from the live component tree/instance registry.
5. The registry replaces `styleEl.textContent`.

### Unmount

1. Instance unregisters from the style registry.
2. The registry rebuilds without that instance's scoped block.
3. If no styled instances remain, the style tag can be removed.

---

## Key APIs

| API | Purpose |
|-----|---------|
| `get styles()` | Per-instance reactive stylesheet fragment |
| `static styles` | Optional shared/static stylesheet fragment included in the generated sheet |
| `scopeClass` / internal scope id | Unique class used to isolate instance styles |
| `StyleRegistry.register(instance)` | Adds a live styled component instance to the stylesheet registry |
| `StyleRegistry.markDirty(instance)` | Schedules a stylesheet rebuild |
| `StyleRegistry.flush()` | Regenerates and replaces the generated stylesheet |

---

## Implementation Stages

| Stage | Strategy | When |
|-------|----------|------|
| V1 | Rebuild one full generated stylesheet from live instances | Default starting point |
| V2 | Replace only dirty instance blocks using string markers | If full rebuilds are too costly in real apps |
| V3 | CSSOM rule insertion/deletion | Only if benchmarked and worth the added complexity |

**Approach:** Start with full `textContent` replacement of one generated stylesheet. Emotion-style rule management is a proven direction for CSS-in-JS libraries, but Mantle has a simpler source of truth: the live component tree. Do not add CSSOM bookkeeping until Mantle-specific benchmarks show it is needed.

---

## Style Categories

| Category | Recommended Strategy | Why |
|----------|----------------------|-----|
| Per-instance state | `get styles()` blocks in the generated stylesheet | Keeps scoped reactive CSS DX without many style tags |
| Component shared styles | `static styles` or shared style function in the generated stylesheet | Keeps shared CSS in the same generated artifact |
| Global hot theme tokens | Shared stylesheet rule or CSS variables | Avoids rebuilding many instance blocks for one global value |
| Simple one-off dynamic values | Inline style objects | Fast and direct for small property sets |

---

## Hydration Compatibility

This model works with true hydration because the component tree remains the source of truth.

**Flow:**

1. Server renders HTML with scope classes.
2. Server emits the generated stylesheet.
3. Client hydrates existing DOM nodes.
4. Each component adopts or recreates its scope id.
5. Instances register with the style registry.
6. The registry rebuilds the generated stylesheet from live hydrated instances.

The server stylesheet prevents FOUC. After hydration, the client style registry can reuse or replace the existing style element with equivalent generated CSS.

**Important edge case:** Scope ids must be stable between server and client. Early implementations should consider `data-mantle-scope` on root nodes instead of relying only on render-order counters.

---

## Benchmark Takeaways

The local benchmark suggests:

| Strategy | Result |
|----------|--------|
| Per-instance style tags | Good at moderate counts, poor at very high counts with every-frame updates |
| Combined instance stylesheet | Much better high-scale behavior while preserving scoped instance CSS |
| Shared stylesheet rule | Near CSS-variable performance for shared/global values |
| CSS variables | Best for global hot tokens |
| Inline styles | Very fast for simple per-node dynamic values |

**Observed direction:** Combined stylesheet replacement is far better than many per-instance style tags at high counts. A shared stylesheet rule is near CSS-variable performance for global/shared values. Full generated stylesheet replacement appears viable enough to be the simple v1 implementation.

---

## Why This Fits Mantle

- No compiler.
- No CSS-in-JS dependency.
- Styles can read component state directly.
- Styles can be reactive through MobX.
- Component instances remain the source of truth.
- Hydration can rebuild style state from the live component tree.
- Performance scales better than one style tag per instance.

The resulting mental model is simple: **the component tree produces DOM, and the same component tree produces a generated stylesheet.**
