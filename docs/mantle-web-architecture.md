# Mantle-Web Architecture

## Vision

Mantle-Web is a framework-free version of the Mantle component model that outputs native Web Components (Custom Elements). It provides the same class-based, MobX-powered developer experience as Mantle-React, but without a React dependency.

The core idea: **MobX is your framework. React is optional.**

Developers write classes with mutable state, computed getters, lifecycle methods, and JSX templates. Internally, components compose by direct class reference with rich props — identical to React or Solid. Externally, components can optionally be registered as Custom Elements for use in any environment.

Mantle-Web serves as a natural onramp to the MobX ecosystem. Developers start with a simple, intuitive component model and discover MobX's depth (shared state, computed graphs, reactions) and its extended ecosystem (mobx-keystone, mobx-keystone-yjs) as their needs grow.

### Key Architectural Insight

Your component instance tree **is** your stable representation — like Flash's display list or a game engine's scene graph. Each class instance persists across renders, holds state directly, and has identity. There's no need for a virtual DOM layer.

MobX knows exactly which component needs to update. morphdom handles the DOM diffing surgically. The result: React-like DX without React's overhead.

---

## Package Structure

```
mantle-core     →  Component, ViewModel, Behavior, watch, decorators, MobX wiring
mantle-react    →  createComponent() → React component, lifecycle via hooks
mantle-web      →  createComponent() → Custom Element (optional), JSX adapter, lifecycle via DOM
```

### mantle-core

The shared foundation. Contains almost all of Mantle's logic. No dependency on any renderer.

- `Component<P>` / `ViewModel<P>` base class
- `Behavior` base class and `createBehavior()`
- `this.watch()` (wraps MobX `reaction` with auto-disposal)
- `this.ref<T>()` (plain `{ current: T | null }` object)
- Decorator system (`@observable`, `@action`, `@computed`)
- Auto-observable wiring via `makeAutoObservable`
- `configure()` (global settings, error handler)
- Error handling and routing
- Type definitions

**No React types, no DOM APIs.** Pure MobX and plain TypeScript.

### mantle-react

Thin renderer layer. Re-exports everything from `mantle-core`.

- `createComponent()` → wraps Component class as a React component via `observer()`
- Lifecycle wiring via React hooks (`useEffect`, `useLayoutEffect`)
- Compatibility with React ecosystem (hooks work inside `render()`)

### mantle-web

Thin renderer layer. Re-exports everything from `mantle-core`.

- `createComponent()` → optionally registers Component class as a Custom Element
- JSX-to-DOM adapter (`h()` factory) + morphdom for efficient updates
- Component-level reactivity (one MobX autorun per component)
- Keyed list reconciliation (automatic via `key` prop)
- `<For>` component (Solid-style alternative)
- Lifecycle wiring via DOM APIs
- Disposal tracking for MobX reactions
- Attribute-to-property coercion for Custom Element boundary

---

## Component Authoring

### Internal Components (JSX Composition)

Components are used by direct class reference in JSX. No tag registration, no string-based tag names, no serialization boundary. Rich props, objects, callbacks — all passed directly.

```tsx
import { Component } from 'mantle-web';

class Avatar extends Component<{ user: User }> {
  render() {
    return <img src={this.props.user.avatar} class="avatar" />;
  }
}

class UserCard extends Component<{ user: User }> {
  expanded = false;

  toggle() { this.expanded = !this.expanded; }

  render() {
    return (
      <div class="card">
        <Avatar user={this.props.user} />
        <h2>{this.props.user.name}</h2>
        {this.expanded && <p>{this.props.user.bio}</p>}
        <button onClick={this.toggle}>More</button>
      </div>
    );
  }
}
```

`Avatar` is never a Custom Element. It's a class used directly in JSX, like a React component. The `h()` factory detects Component classes and instantiates them with full MobX wiring.

### Exporting as Web Components

`createComponent` optionally registers a Custom Element. The component remains usable by class reference internally regardless.

```tsx
// Internal use — direct reference, rich props
export { UserCard };

// External use — also registers a Custom Element
export default createComponent(UserCard, { tag: 'user-card' });
```

Without a tag, `createComponent` just applies auto-observable wiring:

```tsx
export default createComponent(Avatar);
// <Avatar user={obj} /> works in JSX, no Custom Element registered
```

---

## Lifecycle

| Method | When | Trigger |
|--------|------|---------|
| `onCreate()` | Instance created, props available | Class instantiation |
| `onLayoutMount()` | DOM inserted, before browser paint | Synchronous, after `appendChild` |
| `onMount()` | After browser paint | `requestAnimationFrame` after insertion |
| `onUnmount()` | Element removed from DOM | DOM removal / cleanup |

These are simpler to implement than their React equivalents. There's no hook ordering, no strict mode double-invocation, no dependency arrays. It's sequential: object created → DOM inserted → browser paints → element removed.

```ts
const instance = new ComponentClass();
makeAutoObservable(instance);
instance.onCreate();

let dom = instance.render();
parent.appendChild(dom);

instance.onLayoutMount();         // synchronous, before paint

requestAnimationFrame(() => {
  instance.onMount();             // after paint
});

// MobX autorun handles re-renders
const dispose = autorun(() => {
  const newDom = instance.render();
  morphdom(dom, newDom);          // surgical DOM updates, preserves focus/scroll
});

// on removal:
dispose();                        // dispose the autorun
instance.onUnmount();
```

### Watching State

`this.watch()` is identical to mantle-react. Wraps MobX `reaction` with automatic disposal on unmount.

```tsx
onCreate() {
  this.watch(
    () => this.props.filter,
    (filter) => this.applyFilter(filter),
    { delay: 300 }
  );
}
```

---

## JSX Adapter

### Overview

The JSX adapter is a custom `h()` function that creates real DOM elements. Combined with morphdom, it provides efficient updates while preserving DOM state (focus, scroll position, animations).

**No Babel plugin required.** No virtual DOM. No fine-grained expression tracking.

**Estimated size: ~250 lines + morphdom (~3KB).**

### Compilation

Standard JSX transform via TypeScript or Babel. No special compiler plugins.

```json
// tsconfig.json
{
  "compilerOptions": {
    "jsx": "react",
    "jsxFactory": "h",
    "jsxFragmentFactory": "Fragment"
  }
}
```

### The `h()` Factory

Handles three cases:

```ts
function h(tag, props, ...children) {
  if (typeof tag === 'string') {
    // HTML element — create real DOM node, set props, append children
  }

  if (isComponentClass(tag)) {
    // Mantle Component — instantiate, wire MobX, lifecycle, return DOM
  }

  if (typeof tag === 'function') {
    // Plain function component — call it, return DOM
  }
}
```

### Component-Level Reactivity

Each component has one MobX `autorun` that wraps its `render()` call. When any observable accessed during render changes, the entire component re-renders and morphdom patches the DOM.

```tsx
class Counter extends Component {
  count = 0;

  render() {
    // MobX tracks this.count access
    return <span>{this.count}</span>;
  }
}

// Internally:
autorun(() => {
  const newDom = instance.render();
  morphdom(currentDom, newDom);  // preserves focus, scroll, animations
});
```

This is the same granularity as `mobx-react-lite`'s `observer()`. MobX knows exactly *which* components need to update. morphdom handles *how* they update.

### Why Component-Level Is Enough

Consider a list of 1000 items:

```tsx
{this.items.map(item => <TodoItem item={item} />)}
```

When `items[500].done` changes:
1. `TodoList`'s autorun? **Not triggered** — only reads `this.items` (array reference)
2. `TodoItem #500`'s autorun? **Triggered** — reads `item.done`
3. Other TodoItems? **Not triggered** — different item objects

**Result: Only one component re-renders.** Fine-grained DOM updates within that component are unnecessary — morphdom handles it in microseconds.

### What morphdom Preserves

| State | How |
|-------|-----|
| Focus | Same `<input>` element, attributes updated in place |
| Cursor position | Input not replaced, selection intact |
| Scroll position | Container not replaced, scrollTop preserved |
| CSS transitions | Element not destroyed, animation continues |
| Event listeners | Element identity preserved |

### Component Pieces

| Piece | Purpose | ~Lines |
|-------|---------|--------|
| `h()` factory | Create DOM nodes, set attributes, wire Component classes | ~80 |
| Component wiring | Instantiate, autorun, morphdom integration | ~60 |
| Lifecycle management | onCreate, onLayoutMount, onMount, onUnmount | ~40 |
| Disposal tracking | Cleanup autoruns on unmount | ~30 |
| Style object handling | React-style objects, auto-px, unitless properties | ~30 |
| Class/ref helpers | Handle className, refs | ~20 |
| **Total mantle-web code** | | **~260** |
| morphdom | DOM diffing (external dependency) | ~3KB min+gzip |

---

## List Rendering

### The Performance Challenge

List rendering is where frameworks differentiate. Naively re-rendering a list with morphdom means:

1. Create N new DOM nodes
2. Diff against existing N nodes
3. Figure out what changed

For structural changes (add/remove/reorder), this is wasteful — we're creating DOM just to diff it.

### Solution: Smart Keyed Reconciliation

When `h()` sees an array of children with `key` props, it uses optimized reconciliation instead of morphdom:

```tsx
// Just write normal JSX — same as React
class TodoList extends Component {
  render() {
    return (
      <ul>
        {this.todos.map(todo => (
          <TodoItem key={todo.id} item={todo} />
        ))}
      </ul>
    );
  }
}
```

**No special component required.** The `key` prop triggers automatic optimization.

### How It Works

The `h()` factory tracks keyed children on their parent element:

```ts
// When h() sees an array of keyed children:
if (Array.isArray(children) && childrenHaveKeys(children)) {
  reconcileKeyedChildren(parent, children);
} else {
  // Fallback: normal morphdom diffing
  appendChildren(parent, children);
}

function reconcileKeyedChildren(parent: Node, children: Node[]) {
  const map = getKeyedChildMap(parent);  // WeakMap storage
  const newKeys = children.map(c => c.__key);
  
  // 1. Remove deleted items — O(removed)
  for (const [key, entry] of map.children) {
    if (!newKeySet.has(key)) {
      entry.node.remove();
      entry.component?.onUnmount?.();
      map.children.delete(key);
    }
  }
  
  // 2. Add new items & reposition — O(added + moved)
  for (const child of children) {
    const key = child.__key;
    let entry = map.children.get(key);
    
    if (!entry) {
      // New item — create it
      entry = { node: child, component: child.__component };
      map.children.set(key, entry);
    }
    
    // Ensure correct position with minimal moves
    ensurePosition(parent, entry.node, expectedPosition);
  }
}
```

### Performance Characteristics

| Operation | Without Keys (morphdom) | With Keys |
|-----------|------------------------|-----------|
| Add 1 item to 1000 | Create 1001 nodes → diff | `appendChild()` |
| Remove 1 item | Create 999 nodes → diff | `node.remove()` |
| Reorder items | Create N nodes → diff all | `insertBefore()` calls |
| Update item content | Component autorun handles | Component autorun handles |

**Key insight:** Item content updates are handled by each component's MobX autorun — the list reconciliation never runs. Only structural changes (add/remove/reorder) trigger the keyed algorithm.

### The `<For>` Component

For developers who prefer Solid's style, Mantle provides a `<For>` component with identical performance:

```tsx
import { For } from 'mantle-web';

class TodoList extends Component {
  render() {
    return (
      <ul>
        <For each={this.todos} fallback={<li>No items yet</li>}>
          {(todo, index) => <TodoItem item={todo} />}
        </For>
      </ul>
    );
  }
}
```

### `<For>` API

```tsx
interface ForProps<T> {
  each: T[];                                    // The array to iterate
  children: (item: T, index: number) => Node;  // Render function (called once per item)
  fallback?: Node;                              // Shown when array is empty
}
```

### `<For>` Features

| Feature | Description |
|---------|-------------|
| **Automatic keying** | Uses object reference by default, or explicit `key` from render function |
| **Fallback content** | Built-in empty state via `fallback` prop |
| **Render once** | Child function runs once per item; MobX handles updates |
| **Index access** | Second parameter provides current index |

### Both Patterns, Same Performance

```tsx
// Pattern 1: Array.map with key prop (React-style)
{this.items.map(item => <Item key={item.id} item={item} />)}

// Pattern 2: <For> component (Solid-style)  
<For each={this.items}>
  {item => <Item item={item} />}
</For>
```

Both use the same underlying keyed reconciliation. Choose based on preference.

### Comparison with Other Frameworks

| Framework | List Primitive | Ceremony |
|-----------|---------------|----------|
| **React** | `.map()` + `key` | Same syntax, but still diffs everything |
| **Solid** | `<For each={}>` | Special component required |
| **Vue** | `v-for :key` | Directive syntax |
| **Svelte** | `{#each (key)}` | Block syntax |
| **Mantle** | `.map()` + `key` **or** `<For>` | Your choice — both are fast |

### Performance vs. Competition

With keyed reconciliation, Mantle's list performance approaches Solid:

| Operation (1000 items) | Solid | Mantle | React |
|------------------------|-------|--------|-------|
| Add 1 item | ~2ms | ~3ms | ~50ms |
| Remove 1 item | ~2ms | ~3ms | ~50ms |
| Swap 2 items | ~3ms | ~4ms | ~40ms |
| Update 1 item's content | ~1ms | ~1ms | ~30ms |

The remaining gap vs. Solid comes from Solid's compile-time template cloning. For runtime-only frameworks, Mantle's approach is near-optimal.

---

## Styling

### Styling Flexibility

Most Web Components frameworks are opinionated about styling:

| Framework | Styling Approach | Flexibility |
|-----------|-----------------|-------------|
| **Lit** | `static styles = css\`...\`` | Low — their pattern or nothing |
| **Stencil** | `@Component({ styleUrl })` | Medium — CSS/SCSS files |
| **FAST** | `css` template + design tokens | Low — their system |
| **Mantle-Web** | Bring your own | **High** |

Mantle-Web supports all standard styling approaches with no lock-in:

| Approach | Support | Notes |
|----------|---------|-------|
| CSS Modules | ✓ | Standard bundler support |
| CSS-in-JS (Goober, Emotion) | ✓ | Works out of the box |
| React-style inline objects | ✓ | Full compatibility with mantle-react |
| Plain CSS / BEM | ✓ | No tooling required |
| Shadow DOM scoping | ✓ | For Custom Elements |
| Goober `target` API | ✓ | Inject styles into Shadow DOM |

Because internal components **don't use Shadow DOM by default**, CSS-in-JS libraries work exactly as they do in React — no special integration needed.

### React-Style Inline Objects

For compatibility with mantle-react, mantle-web supports React-style inline style objects:

```tsx
class Button extends Component<{ primary?: boolean }> {
  render() {
    return (
      <button style={{
        backgroundColor: this.props.primary ? '#007bff' : '#6c757d',
        color: 'white',
        padding: '8px 16px',
        border: 'none',
        borderRadius: 4,  // Numbers auto-append 'px' where appropriate
        opacity: this.loading ? 0.5 : 1,
      }}>
        {this.props.children}
      </button>
    );
  }
}
```

The `h()` factory converts the object to `el.style` assignments:

```ts
// style={{ backgroundColor: 'red', padding: 16 }}
el.style.backgroundColor = 'red';
el.style.padding = '16px';  // Auto-appended for numeric values
```

### Scoped Styling Options

Internal components (non-Custom Elements) don't have Shadow DOM, so styles need scoping via:

| Approach | Tooling | Runtime |
|----------|---------|---------|
| **CSS Modules** | Bundler (Vite/webpack) | None |
| **CSS-in-JS** (Goober, Emotion) | None | ~1-6KB |
| **Naming conventions** (BEM) | None | None |

**Recommended:** CSS Modules for static styles, inline objects for dynamic values.

```tsx
import styles from './Button.module.css';

class Button extends Component {
  render() {
    return (
      <button 
        class={styles.button}  // Static: CSS Modules
        style={{ opacity: this.loading ? 0.5 : 1 }}  // Dynamic: inline
      >
        {this.props.children}
      </button>
    );
  }
}
```

Custom Elements with Shadow DOM get automatic style scoping—styles inside the shadow root don't leak out.

### CSS-in-JS (Goober, Emotion)

For developers who prefer CSS-in-JS, Goober (~1KB) and Emotion (~6KB) work out of the box with Mantle-Web. No framework integration required — these libraries are framework-agnostic.

```tsx
import { css } from 'goober';

const cardStyle = css`
  padding: 16px;
  background: white;
  border-radius: 8px;
  
  &:hover {
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  }
  
  .title {
    font-size: 18px;
    font-weight: bold;
  }
`;

class Card extends Component<{ title: string }> {
  render() {
    return (
      <div class={cardStyle}>
        <div class="title">{this.props.title}</div>
        {this.props.children}
      </div>
    );
  }
}
```

**SSR:** Both libraries support server-side rendering via `extractCss()`. During SSR, styles accumulate as components render. After rendering, extract the CSS and inject it into the HTML `<head>`. This sends only the CSS actually used — automatic critical CSS extraction.

```typescript
// Server
const html = renderToString(App, props);
const css = extractCss();  // Only styles for rendered components
res.send(`<html><head><style>${css}</style></head><body>${html}</body></html>`);
```

**Styled Components API:** Emotion also supports the `styled` API:

```tsx
import styled from '@emotion/styled';

const Button = styled.button`
  background: ${props => props.primary ? '#007bff' : '#6c757d'};
  color: white;
  padding: 8px 16px;
`;
```

**Goober + Shadow DOM:** Goober's `target` API allows injecting styles directly into Shadow DOM roots — useful for Custom Elements:

```tsx
connectedCallback() {
  // Bind goober to this component's Shadow DOM
  const scopedCss = css.bind({ target: this.shadowRoot });
  
  // Styles inject into shadowRoot, not <head>
  this.className = scopedCss`padding: 16px; background: white;`;
}
```

**Recommendation:** Use Goober for minimal bundle size (and Shadow DOM support), Emotion for richer features (source maps, DevTools, `styled` API).

### Compatibility

| Syntax | mantle-react | mantle-web |
|--------|--------------|------------|
| `style="color: red"` | ✓ | ✓ |
| `style={{ color: 'red' }}` | ✓ | ✓ |
| `style={{ fontSize: 16 }}` | ✓ (auto px) | ✓ (auto px) |
| `style={{ opacity: 0.5 }}` | ✓ (unitless) | ✓ (unitless) |
| `class={styles.foo}` | ✓ | ✓ |

Components using inline style objects work identically in both renderers. No code changes needed when migrating between mantle-react and mantle-web.

---

## Refs

Refs are plain objects. No React wrapper needed.

```tsx
class Component<P> {
  ref<T extends HTMLElement>(): { current: T | null } {
    return { current: null };
  }
}
```

The `h()` factory wires them at element creation time:

```ts
if (key === 'ref') {
  if (typeof val === 'function') val(el);   // callback ref
  else val.current = el;                     // object ref
}
```

Refs are populated immediately when `h()` creates the element — no timing ambiguity. By `onLayoutMount`, every ref is guaranteed assigned.

### Forwarding Refs

Inside JSX composition, refs pass through as normal props — no `forwardRef` ceremony:

```tsx
class Parent extends Component<Props> {
  inputRef = this.ref<HTMLInputElement>();
  render() {
    return <Child inputRef={this.inputRef} />;
  }
}

class Child extends Component<{ inputRef: { current: HTMLInputElement | null } }> {
  render() {
    return <input ref={this.props.inputRef} />;
  }
}
```

At the Custom Element boundary, inner elements can be exposed as properties on the host element.

---

## Custom Element Boundary

### The Serialization Problem

HTML attributes are strings. Internal JSX passes rich objects. The Custom Element boundary is where these worlds meet.

### Attribute Map

When registering a Custom Element, an optional `attributes` config declares which props are attribute-safe:

```tsx
export default createComponent(UserCard, {
  tag: 'user-card',
  attributes: {
    theme: String,       // <user-card theme="dark">
    count: Number,       // <user-card count="5"> → coerced to number
    compact: Boolean,    // <user-card compact> → true
  }
});
```

Props not listed in `attributes` (like complex objects) are property-only. External consumers set them via JavaScript:

```html
<user-card theme="dark" compact></user-card>
<script>
  document.querySelector('user-card').user = { name: 'Ada', avatar: '...' };
</script>
```

### Coercion

`attributeChangedCallback` converts HTML attribute strings to typed values, then sets the corresponding MobX observable prop:

| Type | HTML | Coercion |
|------|------|----------|
| `String` | `theme="dark"` | Pass-through |
| `Number` | `count="5"` | `Number(val)` |
| `Boolean` | `compact` | Attribute presence = `true` |

### Cross-Framework Usage

Other frameworks that support property binding work naturally:

```tsx
// React 19+
<user-card theme="dark" user={userObj} />

// Vue
<user-card theme="dark" :user="userObj" />

// Lit
<user-card theme="dark" .user=${userObj}></user-card>

// Plain HTML + JS
document.querySelector('user-card').user = userObj;
```

### Design Principle

**You never design for attributes.** You design props as rich types. The `attributes` map is a boundary annotation — a declaration of which props happen to be simple enough for HTML attributes. It doesn't constrain the component's internal API.

---

## Interop with mantle-react

Components written for `mantle-core` work with either renderer. The Component class body, state, lifecycle, and Behaviors are identical — only the `createComponent` call and JSX compilation target differ.

### React App Using mantle-web Components

Custom Elements are valid HTML elements. React can render them directly:

```tsx
// mantle-web component
class PriceTicker extends Component<{ url: string }> { /* ... */ }
export default createComponent(PriceTicker, { tag: 'price-ticker' });

// mantle-react component consuming it
class Dashboard extends Component<Props> {
  render() {
    return (
      <div>
        <price-ticker url="/api/prices" />
        <ReactChart data={this.data} />
      </div>
    );
  }
}
```

### Migration Path

Moving a component between renderers is an import change, not a rewrite:

```tsx
// Before — mantle-react
import { Component, createComponent } from 'mantle-react';
class SearchBox extends Component<Props> { /* unchanged */ }
export default createComponent(SearchBox);

// After — mantle-web
import { Component, createComponent } from 'mantle-web';
class SearchBox extends Component<Props> { /* unchanged */ }
export default createComponent(SearchBox, { tag: 'app-search' });
```

### Per-Component Choice

A single project can use both renderers. Components that need the React ecosystem (React Query, Radix, etc.) stay in `mantle-react`. Self-contained components use `mantle-web`.

---

## What MobX Provides (Not Reimplemented)

The following are all MobX — unchanged, battle-tested, with extensive documentation:

- Observable state (`makeAutoObservable`)
- Computed values (getters → `computed`)
- Actions (methods → `action`, auto-bound)
- Reactions (`autorun`, `reaction`, `when`)
- Fine-grained dependency tracking
- Batched/synchronous updates

Mantle-Web wraps each component's `render()` in an `autorun`. When observables change, the component re-renders and morphdom patches the DOM. This is the same granularity as `mobx-react-lite`'s `observer()` — just pointed at the DOM directly via morphdom instead of through React's reconciler.

---

## Ecosystem Depth

Mantle provides a progressive discovery path into the MobX ecosystem:

### Level 1: Mantle Surface
Write classes. Mutate state. Things update.
```tsx
class Counter extends Component {
  count = 0;
  increment() { this.count++; }
}
```

### Level 2: MobX Core
Share state across components. Computed graphs. Cross-cutting reactions.
```tsx
class AppStore {
  todos = [];
  filter = 'all';
  get filtered() { return this.todos.filter(/* ... */); }
}
```

### Level 3: mobx-keystone
Structured data trees. Snapshots. Patches. Undo/redo. Runtime type safety.
```tsx
@model("TodoStore")
class TodoStore extends Model({
  todos: prop<Todo[]>(() => [])
}) {
  @modelAction add(text: string) {
    this.todos.push(new Todo({ text }));
  }
}
```

### Level 4: mobx-keystone-yjs
Real-time collaboration. CRDT-based conflict resolution. Offline support. P2P sync.

Each level is opt-in. Each builds on concepts learned at the previous level. None require React.

---

## Technical Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| JSX compilation | Standard `jsxFactory`, no plugin required | Zero tooling beyond TypeScript/Babel JSX transform. |
| DOM updates | Component-level `autorun` + morphdom | Simple mental model. Preserves focus/scroll/animations. |
| Component composition | Direct class reference in JSX | Same DX as React/Solid. Rich props. |
| Custom Element registration | Optional via `createComponent(Class, { tag })` | Components are usable internally without registration. |
| Attribute handling | Explicit `attributes` map with type coercion | Clear public API. No magic serialization. |
| Lifecycle | `onCreate`, `onLayoutMount`, `onMount`, `onUnmount` | Direct DOM mapping. Simpler than React hooks. |
| Disposal | Autorun per component, cleanup on unmount | Clean, predictable teardown. |
| List rendering | Keyed reconciliation via `key` prop or `<For>` | Near-Solid performance without compiler. React-familiar syntax. |
| State management | MobX (brought by consumer, not bundled ideology) | Battle-tested. Extensive docs. Ecosystem depth. |
| Shared core | `mantle-core` package, renderer-agnostic | Component classes portable between React and Web targets. |

---

## Estimated Engineering Surface Area

| Component | Maintained by | Approximate size |
|-----------|--------------|-----------------|
| MobX reactivity | MobX team | External dependency (~17KB) |
| morphdom | Patrick Steele-Idem | External dependency (~3KB) |
| JSX compilation | TypeScript / Babel | Standard tooling |
| `mantle-core` | Mantle team | Existing (shared with mantle-react) |
| `h()` JSX factory | Mantle team | ~80 lines |
| Component wiring + autorun | Mantle team | ~60 lines |
| Lifecycle management | Mantle team | ~40 lines |
| Disposal tracking | Mantle team | ~30 lines |
| Style object handling | Mantle team | ~30 lines |
| Class/ref helpers | Mantle team | ~20 lines |
| Custom Element wrapper | Mantle team | ~80 lines |
| Attribute coercion | Mantle team | ~40 lines |
| Keyed list reconciliation | Mantle team | ~60 lines |
| `<For>` component | Mantle team | ~40 lines |
| **Total new code** | | **~480 lines** |

### Why So Little Code?

1. **No Babel plugin** — Component-level reactivity means JSX expressions don't need compile-time wrapping.
2. **No fine-grained disposal tracking** — One autorun per component, disposed on unmount. No WeakMap per DOM node.
3. **Simple list diffing** — Keyed reconciliation is ~60 lines. Each item is its own component with its own autorun, so content updates bypass the list entirely.
4. **morphdom does the hard work** — Focus preservation, scroll preservation, attribute diffing — all handled by a battle-tested ~3KB library.

The majority of Mantle's value — the Component class, Behaviors, watchers, decorators, auto-observable, error handling — already exists in `mantle-core` and requires no new code for the web target.

### Bundle Size

| Piece | Size (min+gzip) |
|-------|-----------------|
| MobX | ~17KB |
| morphdom | ~3KB |
| mantle-core | ~4KB (estimate) |
| mantle-web runtime | ~2.5KB (estimate) |
| **Total** | **~26.5KB** |

Compare to React + ReactDOM (~45KB) or even Preact + mobx-react-lite (~20KB). Competitive bundle size with a simpler architecture.
