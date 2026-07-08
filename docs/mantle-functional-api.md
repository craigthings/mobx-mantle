# Mantle Functional API — Design Document

## Overview

Mantle's class-based API is the core implementation. The functional API is a thin sugar layer over it, providing a familiar onramp for developers coming from Vue's Composition API or React hooks. Both APIs share identical behavior, reactivity, and performance characteristics.

The functional API is built on five primitives:

| Primitive | Purpose |
|-----------|---------|
| `reactive()` | Object state — direct property access |
| `ref()` | Single-value state — uses `.value` |
| `computed()` | Derived values — uses `.value` |
| `watch()` | Explicit reactions to state changes |
| `effect()` | Auto-tracked side effects |

Everything else — behaviors, DOM refs, lifecycle, cleanup — composes from these.

---

## Core Primitive: `reactive()`

`reactive()` accepts a plain object and returns a deeply observable version. Properties become observable, getters become computed values. Direct property access — no `.value`.

```tsx
const state = reactive({
  count: 0,
  label: 'clicks',
  get doubled() { return state.count * 2; },
});

state.count++;         // direct mutation, triggers reactivity
state.doubled;         // computed, no .value
```

### Implementation

`reactive()` wraps MobX's `makeAutoObservable` with a proxy layer that automatically wraps property sets in `runInAction`. This ensures compatibility with MobX strict mode without requiring the user to wrap closures in `action()`.

```tsx
function reactive<T extends object>(obj: T): T {
  const obs = makeAutoObservable(obj, {}, { autoBind: true });

  return new Proxy(obs, {
    set(target, key, value) {
      if (isObservableProp(target, key)) {
        runInAction(() => { target[key] = value; });
      } else {
        target[key] = value;
      }
      return true;
    }
  });
}
```

Standalone closures that mutate state just work:

```tsx
const state = reactive({ count: 0 });
const increment = () => state.count++;  // no action() wrapper needed
```

Class components continue using `makeAutoObservable` directly, which handles action wrapping on methods natively. The proxy layer is specific to the functional API.

---

## Single Values: `ref()`

`ref()` creates an observable wrapper for a single value. Access and mutate via `.value`.

```tsx
const count = ref(0);
const name = ref('Alice');

count.value++;           // triggers reactivity
name.value = 'Bob';      // triggers reactivity

console.log(count.value); // 1
```

The `.value` is required because JavaScript cannot intercept primitive variable assignment — there's no way to make `count++` reactive on a plain variable.

### Implementation

`ref()` wraps MobX's `observable.box`:

```tsx
function ref<T>(initial: T): { value: T } {
  const box = observable.box(initial);
  
  return {
    get value() { return box.get(); },
    set value(v: T) { runInAction(() => box.set(v)); },
  };
}
```

### `ref()` vs `reactive()`

| Function | For | Access | Mutate |
|----------|-----|--------|--------|
| `reactive()` | Objects | `state.count` | `state.count++` |
| `ref()` | Primitives | `count.value` | `count.value++` |

Use `reactive()` for grouped state with computed getters. Use `ref()` for standalone primitive values.

---

## Derived Values: `computed()`

`computed()` creates a derived value from a reactive expression. The computation is cached and only re-runs when dependencies change.

```tsx
const state = reactive({ items: [], filter: 'all' });

const filtered = computed(() => {
  if (state.filter === 'all') return state.items;
  return state.items.filter(i => i.status === state.filter);
});

// Read the computed value
console.log(filtered.value);
```

### With `ref()`

```tsx
const count = ref(0);
const doubled = computed(() => count.value * 2);

count.value = 5;
console.log(doubled.value); // 10
```

### Implementation

`computed()` wraps MobX's `computed`:

```tsx
import { computed as mobxComputed } from 'mobx';

function computed<T>(fn: () => T): { readonly value: T } {
  const c = mobxComputed(fn);
  return {
    get value() { return c.get(); },
  };
}
```

### When to Use `computed()` vs Inline Getters

Inside `reactive()` objects, use inline getters:

```tsx
const state = reactive({
  count: 0,
  get doubled() { return state.count * 2; },  // preferred
});
```

Use standalone `computed()` when:
- Deriving from multiple reactive sources
- The computation doesn't belong to any single state object
- Building a computation pipeline

```tsx
const userState = reactive({ users: [] });
const filterState = reactive({ search: '', role: 'all' });

// Combines multiple sources — standalone computed makes sense
const visibleUsers = computed(() => {
  return userState.users.filter(u => 
    u.name.includes(filterState.search) &&
    (filterState.role === 'all' || u.role === filterState.role)
  );
});
```

---

## Auto-Tracked Effects: `effect()`

`effect()` runs a side effect immediately and re-runs whenever any accessed observable changes. It auto-tracks dependencies — you don't specify what to watch.

```tsx
const state = reactive({ count: 0 });

effect(() => {
  document.title = `Count: ${state.count}`;  // auto-tracks state.count
});
```

### With Cleanup

Return a cleanup function that runs before each re-run and on unmount:

```tsx
effect(() => {
  const handler = () => console.log('clicked at', state.count);
  window.addEventListener('click', handler);
  
  return () => window.removeEventListener('click', handler);
});
```

### With Debounce

```tsx
effect(() => {
  localStorage.setItem('draft', state.text);
}, { delay: 500 });
```

### `effect()` vs `watch()`

| Method | Best for |
|--------|----------|
| `effect(fn)` | Simple sync: DOM updates, logging, derived side effects |
| `watch(expr, fn)` | Complex reactions: API calls, debounced actions, explicit triggers |

`effect()` auto-tracks all accessed state, which can lead to unexpected re-runs. For side effects where you want explicit control over triggers, prefer `watch()`.

```tsx
// effect: re-runs if query OR results OR loading changes
effect(() => {
  console.log(`Query "${state.query}" returned ${state.results.length} results`);
});

// watch: only re-runs when query changes
watch(
  () => state.query,
  (query) => fetchResults(query),
  { delay: 300 }
);
```

---

## Functional Components: `defineView()`

`defineView()` accepts a setup function that runs once. The setup function receives props and an optional `self` reference, then returns a render function. This mirrors Vue's Composition API — the outer function is `setup()`, the returned function is `render()`.

### Basic Example

```tsx
import { defineView, reactive, watch, effect, onMount } from 'mobx-mantle';

const Counter = defineView((props: { initial: number }) => {
  const state = reactive({
    count: props.initial,
    label: 'clicks',
    get doubled() { return state.count * 2; },
  });

  const increment = () => state.count++;

  // Auto-tracked effect: updates document title whenever count changes
  effect(() => {
    document.title = `${state.count} ${state.label}`;
  });

  // Explicit watch: logs when count passes a threshold
  watch(
    () => state.count,
    (val) => {
      if (val > 10) console.log('High count!');
    }
  );

  onMount(() => {
    console.log('mounted');
    return () => console.log('cleanup');
  });

  return () => (
    <button onClick={increment}>
      {state.count} (doubled: {state.doubled})
    </button>
  );
});
```

### The `self` Reference

The optional second argument provides access to the underlying component instance:

```tsx
const FancyInput = defineView((props: InputProps, self) => {
  return () => <input ref={self.forwardRef} className="fancy" />;
});

// Parent can ref the underlying input
<FancyInput ref={inputRef} />
```

`self` exposes:
- `self.forwardRef` — ref passed from parent (for ref forwarding)
- `self.props` — reactive props (same as first argument, but useful for behaviors)

Most components don't need `self` — props and closures handle typical cases. Use it for ref forwarding or when passing the component reference to behaviors that require it.
```

### How It Works

Under the hood, `defineView()` creates a class instance that serves as the lifecycle context. The setup function runs during `onCreate()`, receiving props and `self` (the instance). Lifecycle functions like `onMount()` and `watch()` register against the current context.

```tsx
let currentContext: View<any> | null = null;

function defineView<P>(setup: (props: P, self: View<P>) => () => JSX.Element) {
  class Functional extends View<P> {
    private _renderFn!: () => JSX.Element;

    onCreate() {
      currentContext = this;
      this._renderFn = setup(this.props, this);  // pass self as second arg
      currentContext = null;
    }

    render() {
      return this._renderFn();
    }
  }

  return createView(Functional);
}

function getContext() {
  if (!currentContext) throw new Error('Must be called inside defineView');
  return currentContext;
}
```

Lifecycle functions delegate to the context:

```tsx
function onMount(fn: () => void | (() => void)) {
  const ctx = getContext();
  ctx.onMount = () => fn();
}

function onUnmount(fn: () => void) {
  const ctx = getContext();
  ctx.onUnmount = () => fn();
}

function watch(expr, callback, options?) {
  getContext().watch(expr, callback, options);
}

function effect(fn, options?) {
  getContext().effect(fn, options);
}

function domRef<T>() {
  return getContext().ref<T>();
}
```

### Behavior Registration

Behaviors called during setup automatically register with the current context. `createBehavior` detects `currentContext` and wires up lifecycle:

```tsx
function createBehavior<T>(BehaviorClass: new () => T) {
  return (...args: any[]): T => {
    const instance = new BehaviorClass();
    instance.onCreate?.(...args);
    
    // Auto-register with parent component if in setup context
    if (currentContext) {
      currentContext._behaviors.push({ instance });
    }
    
    return instance;
  };
}
```

On component unmount, all registered behaviors are cleaned up automatically — `onUnmount` called, watchers disposed. No manual wiring required.

### Available Lifecycle Functions

| Function | Equivalent Class Method | Description |
|----------|------------------------|-------------|
| `onMount(fn)` | `onMount()` | After paint. Return cleanup function (optional). |
| `onLayoutMount(fn)` | `onLayoutMount()` | Before paint. Return cleanup function (optional). |
| `onUpdate(fn)` | `onUpdate()` | After every render. |
| `onUnmount(fn)` | `onUnmount()` | On unmount, after cleanups. |
| `watch(expr, cb, opts?)` | `this.watch()` | Reactive expression watcher. Auto-disposed. |
| `effect(fn, opts?)` | `this.effect()` | Auto-tracked side effect. Auto-disposed. |
| `domRef<T>()` | `this.ref<T>()` | Create a DOM ref. |

### Hooks in Render

React hooks work inside the returned render function, just as they do in the class `render()` method:

```tsx
const DataView = defineView((props: { id: string }) => {
  return () => {
    const navigate = useNavigate();
    const { data, isLoading } = useQuery({
      queryKey: ['item', props.id],
      queryFn: () => fetchItem(props.id),
    });

    if (isLoading) return <div>Loading...</div>;
    return <div onClick={() => navigate('/home')}>{data.name}</div>;
  };
});
```

---

## Functional Behaviors: `defineBehavior()`

Behaviors can be authored using the same functional pattern. The `defineBehavior()` factory handles lifecycle registration and returns a clean object with direct property access — no `.value` on the consumer side.

### Authoring a Functional Behavior

```tsx
import { defineBehavior, reactive, onMount } from 'mobx-mantle';

const withWindowSize = defineBehavior((breakpoint = 768) => {
  const state = reactive({
    width: window.innerWidth,
    height: window.innerHeight,
    get isMobile() { return state.width < breakpoint; },
  });

  const handleResize = () => {
    state.width = window.innerWidth;
    state.height = window.innerHeight;
  };

  onMount(() => {
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  });

  return state;
});
```

### Consuming Behaviors

Consumption is identical regardless of whether the behavior was authored as a class or with `defineBehavior()`. Direct property access, no `.value`:

```tsx
// In a functional component
const App = defineView((props) => {
  const windowSize = withWindowSize(768);

  return () => (
    <div>{windowSize.isMobile ? <MobileNav /> : <DesktopNav />}</div>
  );
});

// In a class component — same thing
class App extends View<Props> {
  windowSize = withWindowSize(768);

  render() {
    return <div>{this.windowSize.isMobile ? <MobileNav /> : <DesktopNav />}</div>;
  }
}
```

### Behaviors That Need Parent Reference

Some behaviors may require a reference to the parent component (e.g., to access `forwardRef` or coordinate with parent state). Use `self`:

```tsx
// In class component
class Form extends View<Props> {
  validation = withValidation(this);  // pass this
}

// In functional component
const Form = defineView((props, self) => {
  const validation = withValidation(self);  // pass self
  
  return () => <form>...</form>;
});
```

Most behaviors don't need this — they capture what they need via closures or constructor args. But `self` provides parity with the class API when needed.

### Multiple Behaviors

```tsx
const Dashboard = defineView((props) => {
  const mouse = withMouse();
  const windowSize = withWindowSize(768);
  const users = withFetch('/api/users', 10000);

  return () => (
    <div>
      {windowSize.isMobile && <MobileNav />}
      {users.loading ? 'Loading...' : `${users.data.length} users`}
      <p>Mouse: {mouse.x}, {mouse.y}</p>
    </div>
  );
});
```

### Behavior Lifecycle

Functional behaviors support the same lifecycle methods as class behaviors. They are tied to the parent View's lifecycle — mounting when it mounts, unmounting when it unmounts.

| Function | When |
|----------|------|
| `onMount(fn)` | Parent View mounts (after paint). Return cleanup (optional). |
| `onLayoutMount(fn)` | Parent View layout mounts (before paint). Return cleanup (optional). |
| `onUnmount(fn)` | Parent View unmounts. |
| `watch(expr, cb, opts?)` | Reactive watcher. Auto-disposed on unmount. |
| `effect(fn, opts?)` | Auto-tracked side effect. Auto-disposed on unmount. |

---

## Class vs Functional Equivalence

Both APIs produce identical output. The functional API is sugar over the class API.

### Component

```tsx
// Class
class Counter extends View<{ initial: number }> {
  count = 0;
  get doubled() { return this.count * 2; }

  onCreate() {
    this.count = this.props.initial;
  }

  increment() { this.count++; }

  render() {
    return <button onClick={this.increment}>{this.count} ({this.doubled})</button>;
  }
}

export default createView(Counter);

// Functional (with reactive object)
const Counter = defineView((props: { initial: number }) => {
  const state = reactive({
    count: props.initial,
    get doubled() { return state.count * 2; },
  });

  const increment = () => state.count++;

  return () => <button onClick={increment}>{state.count} ({state.doubled})</button>;
});

// Functional (with ref + computed — alternative style)
const Counter = defineView((props: { initial: number }) => {
  const count = ref(props.initial);
  const doubled = computed(() => count.value * 2);

  const increment = () => count.value++;

  return () => <button onClick={increment}>{count.value} ({doubled.value})</button>;
});
```

### Behavior

```tsx
// Class
class WindowSizeBehavior extends Behavior {
  width = window.innerWidth;
  height = window.innerHeight;
  breakpoint!: number;

  onCreate(breakpoint = 768) {
    this.breakpoint = breakpoint;
  }

  get isMobile() { return this.width < this.breakpoint; }

  handleResize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
  }

  onMount() {
    window.addEventListener('resize', this.handleResize);
    return () => window.removeEventListener('resize', this.handleResize);
  }
}

export const withWindowSize = createBehavior(WindowSizeBehavior);

// Functional
export const withWindowSize = defineBehavior((breakpoint = 768) => {
  const state = reactive({
    width: window.innerWidth,
    height: window.innerHeight,
    get isMobile() { return state.width < breakpoint; },
  });

  const handleResize = () => {
    state.width = window.innerWidth;
    state.height = window.innerHeight;
  };

  onMount(() => {
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  });

  return state;
});
```

---

## API Summary

### Functional Exports

| Export | Description |
|--------|-------------|
| `defineView(setup)` | Create a component from a setup function |
| `defineBehavior(setup)` | Create a behavior factory from a setup function |
| `reactive(obj)` | Make an object deeply observable. Direct property access. |
| `ref(value)` | Make a single value observable. Access via `.value`. |
| `computed(fn)` | Create derived value from reactive expression. Access via `.value`. |
| `watch(expr, cb, opts?)` | Watch a reactive expression. Auto-disposed on unmount. |
| `effect(fn, opts?)` | Auto-tracked side effect. Auto-disposed on unmount. |
| `onMount(fn)` | Register mount callback. Return cleanup (optional). |
| `onLayoutMount(fn)` | Register layout mount callback. Return cleanup (optional). |
| `onUpdate(fn)` | Register post-render callback. |
| `onUnmount(fn)` | Register unmount callback. |
| `domRef<T>()` | Create a DOM ref. |

### Key Design Decisions

**Two functions, clear contract.** `reactive()` for objects (direct access), `ref()` for primitives (`.value`). The name tells you what to expect — no surprises about syntax.

**`reactive()` handles MobX strict mode automatically.** The proxy wraps property sets in `runInAction`, so standalone closures work without explicit `action()` wrappers. Class components handle this natively via `makeAutoObservable`.

**`effect()` for auto-tracking, `watch()` for explicit triggers.** Two complementary patterns: `effect()` is simpler but may over-subscribe; `watch()` requires explicit dependencies but gives precise control.

**The functional API is a thin layer.** It is approximately 150 lines of code that delegates entirely to the class API. Adding a feature to the class API means adding a small wrapper function to the functional API.

**Behaviors use the same `reactive()` pattern.** There is one mental model for state across views and behaviors, in both class and functional styles.

**Classes are the recommended default.** The functional API is documented as an onramp, not an alternative. Docs lead with the class API. A "Functional API" section covers the equivalent patterns without duplicating every example.

---

## Documentation Strategy

To avoid community fragmentation (the Vue Options vs Composition problem), Mantle takes an opinionated stance:

> Mantle recommends the class API. The functional API exists as a familiar onramp for developers coming from Vue or hooks-based React. They are identical under the hood — use whichever you prefer, and know you can switch at any time.

Docs lead with classes. The functional API has its own section rather than appearing side-by-side in every example. Behaviors are documented once since consumption is identical in both styles.
