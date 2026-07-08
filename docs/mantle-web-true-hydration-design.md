# Mantle-Web Hydration Design

This document describes how Mantle-Web handles Server-Side Rendering (SSR) and hydration.

---

## 1. The Problem

When using Server-Side Rendering, the browser receives pre-rendered HTML. Without proper hydration, the client JavaScript would replace this HTML entirely, causing:

- **Visual blink (FOUC)** — Content disappears briefly while JS re-renders
- **Lost user state** — Focus, scroll position, text selection reset
- **Wasted work** — Server already rendered; why render again?

## 2. Two Hydration Modes

Mantle-Web supports two component composition models, each with its own hydration strategy:

| Mode | Description | Hydration Strategy |
|------|-------------|-------------------|
| **Custom Elements** | Components registered as Web Components with Shadow DOM | Declarative Shadow DOM (DSD) + morphdom |
| **Internal Components** | Components composed directly via JSX (no registration) | Hydration-aware `h()` factory |

### When to Use Each

- **Custom Elements:** Boundary components that need to be used across frameworks or in plain HTML
- **Internal Components:** Application components composed within Mantle, like React components

Most apps use **internal components** for the majority of their code, with a few **Custom Elements** for public-facing boundaries.

## 3. Custom Elements Hydration (Shadow DOM)

For Custom Elements, hydration is straightforward because:
1. Each component has its own Shadow DOM
2. Declarative Shadow DOM (DSD) pre-creates the shadow root
3. `this.shadowRoot` already exists when JS loads

```ts
// Server sends:
<my-app>
  <template shadowrootmode="open">
    <style>.container { ... }</style>
    <div class="container">...</div>
  </template>
</my-app>

// Client:
connectedCallback() {
  // shadowRoot already exists from DSD!
  const existingDom = this.shadowRoot.firstChild;
  const newDom = instance.render();
  morphdom(existingDom, newDom);
}
```

## 4. Internal Components Hydration (The Key Challenge)

Internal components are composed directly:

```tsx
class App extends Component {
  render() {
    return (
      <div class="app">
        <Header title="Hello" />      {/* Not a Custom Element */}
        <TodoList items={this.items} /> 
        <Footer />
      </div>
    );
  }
}
```

Server sends flat HTML:
```html
<div class="app">
  <h1>Hello</h1>
  <ul><li>Buy milk</li></ul>
  <footer>© 2024</footer>
</div>
```

**The challenge:** Each component instance needs a reference to its DOM node for its autorun to work. But the server HTML has no markers indicating component boundaries.

### The Solution: Hydration-Aware `h()` Factory

During hydration, `h()` **adopts existing DOM nodes** instead of creating new ones. This ensures each component instance gets a reference to its actual DOM.

```ts
// Hydration state
let isHydrating = false;
let hydrationCursor: Node | null = null;

export function h(tag: any, props: any, ...children: any[]): Node {
  if (typeof tag === 'string') {
    let el: HTMLElement;
    
    if (isHydrating && hydrationCursor) {
      // ═══════════════════════════════════════════
      // HYDRATE MODE: Adopt existing DOM node
      // ═══════════════════════════════════════════
      el = hydrationCursor as HTMLElement;
      hydrationCursor = hydrationCursor.nextSibling;
      
      // Attach event handlers to existing element
      applyEventHandlers(el, props);
      
      // Process children using this element's children as cursor
      const savedCursor = hydrationCursor;
      hydrationCursor = el.firstChild;
      processChildren(el, children);
      hydrationCursor = savedCursor;
      
    } else {
      // ═══════════════════════════════════════════
      // CREATE MODE: Build new DOM node
      // ═══════════════════════════════════════════
      el = document.createElement(tag);
      applyProps(el, props);
      appendChildren(el, children);
    }
    
    return el;
  }

  if (isComponentClass(tag)) {
    return mountComponent(tag, props);
  }

  if (typeof tag === 'function') {
    return tag(props);
  }

  throw new Error(`Unknown tag type: ${tag}`);
}

function mountComponent(ComponentClass: typeof Component, props: any): Node {
  const instance = new ComponentClass();
  instance._propsBox = observable.box(props, { deep: false });
  makeAutoObservable(instance);
  instance.onCreate?.();
  
  // render() uses hydration cursor if hydrating
  // This returns EXISTING DOM during hydration!
  const dom = instance.render();
  instance._dom = dom;
  
  // Set up component-level reactivity
  instance._dispose = autorun(() => {
    const newDom = instance.render();
    morphdom(instance._dom!, newDom);
  });
  
  // Lifecycle
  queueMicrotask(() => instance.onLayoutMount?.());
  requestAnimationFrame(() => instance.onMount?.());
  
  return dom;
}
```

### The Hydration Entry Point

```ts
export function hydrate(ComponentClass: typeof Component, container: Element): Component {
  // Enter hydration mode
  isHydrating = true;
  hydrationCursor = container.firstChild;
  
  // Create root instance
  const instance = new ComponentClass();
  instance._propsBox = observable.box({}, { deep: false });
  makeAutoObservable(instance);
  instance.onCreate?.();
  
  // render() walks existing DOM, adopting nodes
  const dom = instance.render();
  instance._dom = dom;
  
  // Exit hydration mode
  isHydrating = false;
  hydrationCursor = null;
  
  // Set up root autorun
  instance._dispose = autorun(() => {
    const newDom = instance.render();
    morphdom(instance._dom!, newDom);
  });
  
  instance.onLayoutMount?.();
  requestAnimationFrame(() => instance.onMount?.());
  
  return instance;
}

// For fresh renders (no SSR)
export function render(ComponentClass: typeof Component, container: Element): Component {
  const instance = new ComponentClass();
  instance._propsBox = observable.box({}, { deep: false });
  makeAutoObservable(instance);
  instance.onCreate?.();
  
  const dom = instance.render();
  instance._dom = dom;
  container.appendChild(dom);
  
  instance._dispose = autorun(() => {
    const newDom = instance.render();
    morphdom(instance._dom!, newDom);
  });
  
  instance.onLayoutMount?.();
  requestAnimationFrame(() => instance.onMount?.());
  
  return instance;
}
```

### How It Works Step by Step

```
Server HTML in container:
┌─────────────────────────────────┐
│ <div class="app">               │ ← cursor starts here
│   <h1>Hello</h1>                │
│   <ul><li>Buy milk</li></ul>    │
│   <footer>© 2024</footer>       │
│ </div>                          │
└─────────────────────────────────┘

hydrate(App, container):

1. isHydrating = true, cursor → <div>

2. App.render() calls h('div', ...)
   → Adopts existing <div>, cursor → null (no next sibling)
   → Saves cursor, sets cursor → <h1> (first child)
   
3.   h(Header, ...) creates Header instance
     → Header.render() calls h('h1', ...)
     → Adopts existing <h1>, cursor → <ul>
     → Header._dom = <h1> ✓
     
4.   h(TodoList, ...) creates TodoList instance
     → TodoList.render() calls h('ul', ...)
     → Adopts existing <ul>, cursor → <footer>
     → TodoList._dom = <ul> ✓
     
5.   h(Footer, ...) creates Footer instance
     → Footer.render() calls h('footer', ...)
     → Adopts existing <footer>, cursor → null
     → Footer._dom = <footer> ✓

6. App._dom = <div> ✓

7. isHydrating = false

Result: Every component instance holds a reference to EXISTING DOM!
        Each autorun now works correctly for updates.
```

## 5. Custom Element Implementation

For components exported as Custom Elements with Shadow DOM:

```typescript
function createComponent(
  ComponentClass: typeof Component,
  options?: { tag?: string }
) {
  if (options?.tag) {
    class MantleElement extends HTMLElement {
      private _instance: Component | null = null;
      private _dispose: (() => void) | null = null;
      private _dom: Node | null = null;

      connectedCallback() {
        const shadowRoot = this.shadowRoot || this.attachShadow({ mode: 'open' });
        
        this._instance = new ComponentClass();
        this._instance._propsBox = observable.box({}, { deep: false });
        makeAutoObservable(this._instance);
        this._instance.onCreate?.();

        // Check for server-rendered content (Declarative Shadow DOM)
        const existingDom = shadowRoot.firstChild;

        if (existingDom) {
          // HYDRATE
          const newDom = this._instance.render();
          morphdom(existingDom, newDom);
          this._dom = existingDom;
        } else {
          // CREATE
          this._dom = this._instance.render();
          shadowRoot.appendChild(this._dom);
        }

        // Set up reactive updates
        this._dispose = autorun(() => {
          const newDom = this._instance!.render();
          morphdom(this._dom!, newDom);
        });

        this._instance.onLayoutMount?.();
        requestAnimationFrame(() => this._instance?.onMount?.());
      }

      disconnectedCallback() {
        this._dispose?.();
        this._instance?.onUnmount?.();
      }
    }

    customElements.define(options.tag, MantleElement);
  }

  return ComponentClass;
}
```

## 6. Server-Side Rendering

### renderToString

```typescript
// mantle-ssr/renderToString.ts
export function renderToString(ComponentClass: typeof Component, props?: any): string {
  // Create instance (runs in Node.js with jsdom or similar)
  const instance = new ComponentClass();
  instance._propsBox = { get: () => props || {} } as any;  // Mock observable
  
  // Note: makeAutoObservable skipped on server (no reactivity needed)
  instance.onCreate?.();
  
  const dom = instance.render();
  return serializeDom(dom);
}

function serializeDom(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeHtml(node.textContent || '');
  }

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  
  // Serialize attributes
  const attrs = Array.from(el.attributes)
    .filter(a => !a.name.startsWith('on'))  // Skip event handlers
    .map(a => `${a.name}="${escapeHtml(a.value)}"`)
    .join(' ');

  // Serialize children
  const children = Array.from(el.childNodes)
    .map(serializeDom)
    .join('');

  // Self-closing tags
  if (['br', 'hr', 'img', 'input', 'meta', 'link'].includes(tag)) {
    return `<${tag}${attrs ? ' ' + attrs : ''} />`;
  }

  return `<${tag}${attrs ? ' ' + attrs : ''}>${children}</${tag}>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```

### Rendering Custom Elements with Declarative Shadow DOM

```typescript
export function renderCustomElement(
  ComponentClass: typeof Component,
  tag: string,
  props?: any
): string {
  const content = renderToString(ComponentClass, props);
  
  return `<${tag}><template shadowrootmode="open">${content}</template></${tag}>`;
}
```

## 7. How Updates Work (Post-Hydration)

After hydration, each component has:
- An instance with observable state
- A `_dom` reference to its root DOM node
- An autorun that re-renders on changes

### Scenario: User Interaction

```
User clicks "Add Todo" button
        ↓
TodoList.addTodo() modifies this.items (observable)
        ↓
MobX detects change, triggers TodoList's autorun
        ↓
TodoList.render() creates NEW DOM tree
        ↓
morphdom(todoList._dom, newDom) patches differences
        ↓
Only the <ul> updates. App and Header untouched.
```

### Why This Works

Each component's autorun only tracks observables accessed in **its own** `render()`:

- `App.render()` reads `this.items` reference → App's autorun tracks array identity
- `TodoList.render()` reads `this.props.items.length` and each item → TodoList's autorun tracks the array contents

When an item is added:
- App's autorun? **Not triggered** (array reference unchanged)
- TodoList's autorun? **Triggered** (array contents changed)

**Result:** Only TodoList re-renders. morphdom patches just its DOM.

## 8. What morphdom Preserves

| State | How |
|-------|-----|
| Focus | Same element identity, attributes updated in place |
| Cursor position | Input elements not replaced |
| Scroll position | Containers not replaced |
| CSS transitions | Elements not destroyed mid-animation |
| Event listeners | Reattached during render, but element preserved |

## 9. Handling Mismatches

If server and client render differently (e.g., client-only data), the hydration cursor may get out of sync.

### The Problem

A naive approach sets `isHydrating = false` on mismatch, but this causes **all subsequent siblings** to also exit hydration mode — creating duplicate DOM for everything that follows:

```ts
// ❌ Bad: Exits hydration for entire sibling chain
if (hydrationCursor.nodeName !== tag.toUpperCase()) {
  isHydrating = false;  // Everything after this creates fresh DOM!
  return createElement(tag, props, children);
}
```

### The Solution: Subtree-Scoped Recovery

Handle the mismatch locally, then **resume hydration** for siblings:

```ts
// In h() during hydration
if (isHydrating && hydrationCursor) {
  if (hydrationCursor.nodeName !== tag.toUpperCase()) {
    // ═══════════════════════════════════════════
    // MISMATCH: Create this subtree fresh, resume hydration for siblings
    // ═══════════════════════════════════════════
    console.warn(
      `[Mantle] Hydration mismatch: expected <${tag}>, found <${hydrationCursor.nodeName.toLowerCase()}>. ` +
      `Creating fresh subtree. This may indicate SSR/client render inconsistency.`
    );
    
    // Remember the mismatched node and advance cursor
    const skippedNode = hydrationCursor;
    hydrationCursor = hydrationCursor.nextSibling;
    
    // Create this element fresh (temporarily exit hydration for this subtree)
    const savedHydrating = isHydrating;
    isHydrating = false;
    
    const el = document.createElement(tag);
    applyProps(el, props);
    appendChildren(el, children);
    
    // RESUME hydration for subsequent siblings
    isHydrating = savedHydrating;
    
    // Replace the mismatched node in the DOM
    skippedNode.parentNode?.replaceChild(el, skippedNode);
    
    return el;
  }
  
  // ... normal hydration continues
}
```

### How It Works

```
Server HTML:          Client expects:
<div>                 <div>
  <span>A</span>        <p>A</p>      ← Mismatch!
  <span>B</span>        <span>B</span> ← Should still hydrate
  <span>C</span>        <span>C</span> ← Should still hydrate
</div>                </div>

With subtree-scoped recovery:
1. Mismatch detected at <span> vs <p>
2. Create fresh <p>A</p>, replace <span>A</span>
3. Cursor advances to next sibling
4. isHydrating restored → <span>B</span> and <span>C</span> hydrate normally
```

### Mismatch Modes

| Mode | Behavior |
|------|----------|
| **Custom Elements** | morphdom patches the shadow DOM (no cursor to lose) |
| **Internal Components** | Subtree-scoped recovery, resume hydration for siblings |

### Debugging Mismatches

Mismatches indicate SSR/client inconsistency. Common causes:

| Cause | Fix |
|-------|-----|
| Client-only data | Defer to `onMount()`, use same data for SSR/hydration |
| Different sort order | Ensure SSR and client use identical sort |
| Conditional rendering | Use consistent conditions (e.g., check `typeof window`) |
| Date/time differences | Use server-provided timestamps |

```tsx
// Example: Deferring client-only state
class MyComponent extends Component {
  clientOnly = false;
  
  onMount() {
    this.clientOnly = true;  // Now safe to diverge from SSR
  }
  
  render() {
    return (
      <div>
        {this.clientOnly && <ClientOnlyWidget />}
      </div>
    );
  }
}
```

## 10. Keyed List Hydration

Mantle uses keyed reconciliation for efficient list updates. During hydration, lists are handled specially to set up the keyed tracking.

### How It Works

**SSR outputs flat HTML — no keys in markup:**
```html
<ul>
  <li>Buy milk</li>
  <li>Write code</li>
</ul>
```

**Hydration adopts nodes and builds the keyed map:**
```ts
// During hydration of a keyed list:
function hydrateKeyedChildren(parent: Node, children: Node[]) {
  const map = { children: new Map(), keyOrder: [] };
  keyedMaps.set(parent, map);
  
  for (const child of children) {
    const key = child.__key;
    // DOM node already exists (adopted), just track it
    map.children.set(key, { 
      node: child,           // Existing DOM from SSR
      component: child.__component 
    });
    map.keyOrder.push(key);
    // No DOM mutations — just building the tracking map
  }
}
```

**Subsequent updates use keyed reconciliation:**
```
Add item → appendChild()
Remove item → node.remove()
Reorder → insertBefore()
```

### The `<For>` Component

`<For>` hydrates identically to `.map()` with keys:

```tsx
// Server renders:
<For each={todos}>{todo => <TodoItem item={todo} />}</For>
// → <li>Buy milk</li><li>Write code</li>

// Client hydrates:
// 1. Iterates todos array
// 2. Each TodoItem adopts existing <li>
// 3. Keyed map built (by object reference or explicit key)
// 4. Future updates use keyed reconciliation
```

### Hydration Requirements

For correct hydration, server and client must render lists in the **same order**:

| Scenario | Result |
|----------|--------|
| Same data, same order | ✅ Perfect hydration |
| Same data, different order | ⚠️ Nodes adopted incorrectly, then fixed on first update |
| Different data | ⚠️ Mismatch, falls back to morphdom patching |

**Best practice:** Ensure SSR and client render with identical data and sort order. Client-only sorting or filtering should happen *after* hydration completes.

```tsx
class TodoList extends Component {
  hydrated = false;
  
  onMount() {
    this.hydrated = true;  // Now safe to apply client-only transforms
  }
  
  get displayItems() {
    if (!this.hydrated) return this.props.items;  // SSR order
    return this.sortedAndFiltered;                 // Client order
  }
}
```

## 11. Inline Style Objects

Mantle supports React-style inline style objects for compatibility between mantle-react and mantle-web:

```tsx
<div style={{ backgroundColor: 'red', fontSize: 16, opacity: 0.9 }}>
```

### How It Works

**Server (renderToString):**
```
style={{ backgroundColor: 'red', fontSize: 16 }}
    ↓ (serialize to CSS string)
style="background-color: red; font-size: 16px"
    ↓ (HTML output)
<div style="background-color: red; font-size: 16px">
```

**Client (hydration):**
```
render() runs
    ↓
h('div', { style: { backgroundColor: 'red', fontSize: 16 } })
    ↓
h() adopts existing element, applies props including style
    ↓
el.style.backgroundColor = 'red'
el.style.fontSize = '16px'
    ↓
Browser updates style attribute (same values, no visible change)
```

The style object is applied naturally as part of the render flow. No special handling needed—`h()` applies props to the element whether creating or hydrating.

### Implementation in h()

```ts
function applyProps(el: HTMLElement, props: Record<string, any>) {
  for (const [key, val] of Object.entries(props || {})) {
    if (key === 'style') {
      if (typeof val === 'object' && val !== null) {
        // React-style object: { backgroundColor: 'red' }
        for (const [prop, propVal] of Object.entries(val)) {
          setStyleProperty(el.style, prop, propVal);
        }
      } else if (typeof val === 'string') {
        // Plain string: "background-color: red"
        el.style.cssText = val;
      }
    }
    // ... other props
  }
}

// Handle numeric values (auto-append 'px' where appropriate)
const unitlessProperties = new Set([
  'opacity', 'zIndex', 'fontWeight', 'lineHeight', 'flex', 
  'flexGrow', 'flexShrink', 'order', 'orphans', 'widows',
]);

function setStyleProperty(style: CSSStyleDeclaration, prop: string, value: any) {
  if (value == null || value === false) {
    style[prop as any] = '';
  } else if (typeof value === 'number' && !unitlessProperties.has(prop)) {
    style[prop as any] = `${value}px`;
  } else {
    style[prop as any] = String(value);
  }
}
```

### Server Serialization

```ts
function styleObjectToString(style: Record<string, any>): string {
  return Object.entries(style)
    .filter(([, v]) => v != null && v !== false)
    .map(([k, v]) => {
      // camelCase → kebab-case
      const cssKey = k.replace(/([A-Z])/g, '-$1').toLowerCase();
      const cssVal = typeof v === 'number' && !unitlessProperties.has(k)
        ? `${v}px`
        : v;
      return `${cssKey}: ${cssVal}`;
    })
    .join('; ');
}
```

### Optimization: Style Diffing (Optional)

For subsequent updates, you can optimize by diffing style objects instead of re-applying all properties:

```ts
interface MantleElement extends HTMLElement {
  __mantleStyle?: Record<string, any>;
}

function updateStyle(el: MantleElement, newStyle: Record<string, any>) {
  const oldStyle = el.__mantleStyle || {};
  
  // Only apply changed properties
  for (const key in newStyle) {
    if (newStyle[key] !== oldStyle[key]) {
      setStyleProperty(el.style, key, newStyle[key]);
    }
  }
  
  // Remove properties no longer present
  for (const key in oldStyle) {
    if (!(key in newStyle)) {
      el.style[key as any] = '';
    }
  }
  
  el.__mantleStyle = newStyle;
}
```

This is a micro-optimization—only necessary for components with many inline styles that update frequently. For most cases, re-applying all style properties is negligible overhead.

### Compatibility

| Syntax | mantle-react | mantle-web |
|--------|--------------|------------|
| `style="color: red"` | ✓ | ✓ |
| `style={{ color: 'red' }}` | ✓ (React handles) | ✓ (h() handles) |
| `style={{ fontSize: 16 }}` | ✓ (auto px) | ✓ (auto px) |
| `style={{ opacity: 0.5 }}` | ✓ (unitless) | ✓ (unitless) |

Components using inline style objects work identically in both renderers.

## 12. CSS-in-JS SSR (Goober, Emotion)

Mantle-Web works seamlessly with CSS-in-JS libraries like Goober and Emotion. These libraries handle their own SSR — no framework-level integration required.

### How It Works

During SSR, CSS-in-JS libraries accumulate styles as components render. After rendering, you extract the collected CSS and inject it into the HTML.

```typescript
// Server
import { renderToString } from 'mantle-web/ssr';
import { extractCss } from 'goober';  // or @emotion/css

// 1. Render components (CSS-in-JS collects styles)
const html = renderToString(App, props);

// 2. Extract only the CSS used by rendered components
const css = extractCss();

// 3. Send HTML with critical CSS in <head>
res.send(`
  <!DOCTYPE html>
  <html>
    <head>
      <style id="_goober">${css}</style>
    </head>
    <body>${html}</body>
  </html>
`);
```

### Why This Is Great

- **Critical CSS only** — Only styles for rendered components are sent, not your entire stylesheet
- **No unused CSS** — Tree-shaking by default, no PurgeCSS needed
- **Standard pattern** — Same `extractCss()` pattern used across React, Solid, Vue ecosystems
- **No Mantle coupling** — Developers bring their own CSS-in-JS library

### Hydration

On the client, the CSS-in-JS library rehydrates automatically. When components render during hydration, the library recognizes the styles already exist in the `<style>` tag and doesn't duplicate them.

```typescript
// Client
import { hydrate } from 'mantle-web';
import { setup } from 'goober';

setup(h);  // Configure goober to use Mantle's h()

hydrate(App, document.getElementById('root'));
// Goober sees existing styles, skips regeneration
```

### Nested Selectors (SCSS-style)

Both Goober and Emotion support nested selectors:

```typescript
import { css } from 'goober';

const cardStyle = css`
  padding: 16px;
  background: white;
  
  &:hover {
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  }
  
  .title {
    font-size: 18px;
    font-weight: bold;
  }
  
  .body {
    margin-top: 8px;
  }
`;
```

---

## 13. Summary

### Two Modes, One Goal

| Mode | SSR Output | Hydration Strategy | Component Reactivity |
|------|------------|-------------------|---------------------|
| Custom Elements | DSD templates | `shadowRoot` already exists | Per-component autorun |
| Internal Components | Flat HTML | Hydration-aware `h()` cursor | Per-component autorun |

### Key Insights

1. **Custom Elements** get hydration "for free" via Declarative Shadow DOM
2. **Internal Components** need the `h()` factory to adopt existing DOM during hydration
3. **morphdom** handles updates for both modes—same code path
4. **Component-level reactivity** means only changed components re-render

### Code Size

| Piece | Lines |
|-------|-------|
| Hydration-aware `h()` additions | ~40 |
| `hydrate()` entry point | ~30 |
| `renderToString()` | ~50 |
| Custom Element wrapper | ~60 |
| Style object handling | ~30 |
| Style diffing (optional) | ~20 |
| **Total** | **~230 lines** |

### Dependencies

| Piece | Size |
|-------|------|
| morphdom | ~3KB min+gzip |
| mantle-ssr | ~50 lines |

### The Architecture

```
                         SERVER
                         ──────
    Component tree → renderToString() → HTML
                                          │
                    ┌─────────────────────┘
                    ▼
                 BROWSER
                 ───────
    HTML parsed → Content visible (no JS yet!)
                    │
                    ▼ (JS loads)
    ┌───────────────────────────────────────┐
    │ Custom Elements?                       │
    │   → connectedCallback                  │
    │   → shadowRoot exists (DSD)            │
    │   → morphdom reconciles                │
    │                                        │
    │ Internal Components?                   │
    │   → hydrate(App, container)            │
    │   → h() adopts existing DOM            │
    │   → Each component._dom = existing     │
    └───────────────────────────────────────┘
                    │
                    ▼
    Component tree with DOM references
    Each component has autorun for updates
    morphdom patches on observable changes
```
