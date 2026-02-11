# MobX Mantle

A lightweight library for building React components with a class-based API and MobX reactivity built in. Get full access to the React ecosystem, with better access to vanilla JS libraries, and simpler overall DX for both.

## Why

If you're using MobX for state management, React hooks often add complexity without benefit. React hooks solve real problems: stale closures, dependency tracking, memoization. But when using MobX reactivity, many of those problems are already solved.

The goal is to give React developers a way to build components using patterns common outside the React world: mutable state, stable references, computed getters, direct method calls. Patterns familiar to developers from game development, mobile frameworks, and other web frameworks. This makes it easier to use excellent vanilla JS libraries while still accessing the massive React ecosystem.

## Installation

```bash
npm install mobx-mantle
```

Requires React 17+, MobX 6+, and mobx-react-lite 3+.

## Basic Example

```tsx
import { View, createView } from 'mobx-mantle';

interface CounterProps {
  initial: number;
}

class Counter extends View<CounterProps> {
  count = 0;

  onCreate() {
    this.count = this.props.initial;
  }

  increment() {
    this.count++;
  }

  render() {
    return (
      <button onClick={this.increment}>
        Count: {this.count}
      </button>
    );
  }
}

export default createView(Counter);
```

**Everything is reactive by default.** All properties become observable, getters become computed, and methods become auto-bound actions. No annotations needed.

> Want explicit control? See [Decorators](#decorators) below to opt into manual annotations.

## What You Get

**Direct mutation:**
```tsx
this.items.push(item);  // not setItems(prev => [...prev, item])
```

**Computed values via getters:**
```tsx
get completed() {       // not useMemo(() => items.filter(...), [items])
  return this.items.filter(i => i.done);
}
```

**Stable methods (auto-bound):**
```tsx
toggle(id: number) {    // automatically bound to this
  const item = this.items.find(i => i.id === id);
  if (item) item.done = !item.done;
}

// use directly, no wrapper needed
<button onClick={this.toggle} />
```

**React to changes explicitly:**
```tsx
onMount() {
  return reaction(
    () => this.props.filter,
    (filter) => this.applyFilter(filter)
  );
}
```

## Lifecycle

| Method | When |
|--------|------|
| `onCreate()` | Instance created, props available |
| `onLayoutMount()` | DOM ready, before paint. Return a cleanup function (optional). |
| `onMount()` | Component mounted, after paint. Return a cleanup function (optional). |
| `onUpdated()` | After every render (via `useEffect`). |
| `onUnmount()` | Component unmounting. Called after cleanups (optional). |
| `render()` | On mount and updates. Return JSX. |

### Watching State

Use `this.watch` to react to state changes. Watchers are automatically disposed on unmount.

```tsx
this.watch(
  () => expr,           // reactive expression (getter)
  (value, prev) => {},  // callback when expression result changes
  options?              // optional: { delay, fireImmediately }
)
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `delay` | `number` | — | Debounce the callback by N milliseconds |
| `fireImmediately` | `boolean` | `false` | Run callback immediately with current value |

**Basic example:**

```tsx
class SearchView extends View<Props> {
  query = '';
  results: string[] = [];

  onCreate() {
    this.watch(
      () => this.query,
      async (query) => {
        if (query.length > 2) {
          this.results = await searchApi(query);
        }
      },
      { delay: 300 }
    );
  }
}
```

**Multiple watchers:**

```tsx
onCreate() {
  this.watch(() => this.props.filter, (filter) => this.applyFilter(filter));
  this.watch(() => this.props.sort, (sort) => this.applySort(sort));
  this.watch(() => this.props.page, (page) => this.fetchPage(page));
}
```

**Early disposal:**

```tsx
onCreate() {
  const stop = this.watch(() => this.props.token, (token) => {
    this.authenticate(token);
    stop(); // only needed once
  });
}
```

### Props Reactivity

`this.props` is reactive: your component re-renders when accessed props change.

**Option 1: `this.watch`** — the recommended way to react to state changes:

```tsx
onCreate() {
  this.watch(
    () => this.props.filter,
    (filter) => this.applyFilter(filter)
  );
}
```

Watchers are automatically disposed on unmount. No cleanup needed.

**Option 2: `reaction`** — for advanced MobX patterns (autorun, when, custom schedulers):

```tsx
onMount() {
  return reaction(
    () => this.props.filter,
    (filter) => this.applyFilter(filter)
  );
}
```

**Option 3: `onUpdated`** — imperative hook after each render (requires manual dirty-checking):

```tsx
onUpdated() {
  if (this.props.filter !== this.lastFilter) {
    this.lastFilter = this.props.filter;
    this.applyFilter(this.props.filter);
  }
}
```

Or access props directly in `render()` and MobX handles re-renders when they change.

## Patterns

### Combined (default)

State, logic, and template in one class:

```tsx
class Todo extends View<Props> {
  todos: TodoItem[] = [];
  input = '';

  add() {
    this.todos.push({ id: Date.now(), text: this.input, done: false });
    this.input = '';
  }

  setInput(e: React.ChangeEvent<HTMLInputElement>) {
    this.input = e.target.value;
  }

  render() {
    return (
      <div>
        <input value={this.input} onChange={this.setInput} />
        <button onClick={this.add}>Add</button>
        <ul>{this.todos.map(t => <li key={t.id}>{t.text}</li>)}</ul>
      </div>
    );
  }
}

export default createView(Todo);
```

### Separated

ViewModel and template separate:

```tsx
import { ViewModel, createView } from 'mobx-mantle';

class Todo extends ViewModel<Props> {
  todos: TodoItem[] = [];
  input = '';

  add() {
    this.todos.push({ id: Date.now(), text: this.input, done: false });
    this.input = '';
  }

  setInput(e: React.ChangeEvent<HTMLInputElement>) {
    this.input = e.target.value;
  }
}

export default createView(Todo, (vm) => (
  <div>
    <input value={vm.input} onChange={vm.setInput} />
    <button onClick={vm.add}>Add</button>
    <ul>{vm.todos.map(t => <li key={t.id}>{t.text}</li>)}</ul>
  </div>
));
```

## Decorators

For teams that prefer explicit annotations over auto-observable, Mantle provides its own decorators. These are lightweight metadata collectors. No `accessor` keyword required.

```tsx
import { View, createView, observable, action, computed } from 'mobx-mantle';

class Todo extends View<Props> {
  @observable todos: TodoItem[] = [];
  @observable input = '';

  @computed get remaining() {
    return this.todos.filter(t => !t.done).length;
  }

  @action add() {
    this.todos.push({ id: Date.now(), text: this.input, done: false });
    this.input = '';
  }

  render() {
    return /* ... */;
  }
}

export default createView(Todo);
```

**Key differences from auto-observable mode:**
- Only decorated fields are reactive (undecorated fields are inert)
- Methods are still auto-bound for stable `this` references

### Available Decorators

| Decorator | Purpose |
|-----------|---------|
| `@observable` | Deep observable field |
| `@observable.ref` | Reference-only observation |
| `@observable.shallow` | Shallow observation (add/remove only) |
| `@observable.struct` | Structural equality comparison |
| `@action` | Action method (auto-bound) |
| `@computed` | Computed getter (optional; getters are computed by default) |

### MobX Decorators (Legacy)

If you prefer using MobX's own decorators (requires `accessor` keyword for TC39):

```tsx
import { observable, action } from 'mobx';
import { configure } from 'mobx-mantle';

// Disable auto-observable globally
configure({ autoObservable: false });

class Todo extends View<Props> {
  @observable accessor todos: TodoItem[] = [];  // note: accessor required
  @action add() { /* ... */ }
}

export default createView(Todo);
```

Note: `this.props` is always reactive regardless of decorator mode.

## Refs

```tsx
class FormView extends View<Props> {
  inputRef = this.ref<HTMLInputElement>();

  onMount() {
    this.inputRef.current?.focus();
  }

  render() {
    return <input ref={this.inputRef} />;
  }
}
```

### Forwarding Refs

Expose a DOM element to parent components via `this.forwardRef`:

```tsx
class FancyInput extends View<InputProps> {
  render() {
    return <input ref={this.forwardRef} className="fancy-input" />;
  }
}

export default createView(FancyInput);

// Parent can now get a ref to the underlying input:
function Parent() {
  const inputRef = useRef<HTMLInputElement>(null);
  
  return (
    <>
      <FancyInput ref={inputRef} placeholder="Type here..." />
      <button onClick={() => inputRef.current?.focus()}>Focus</button>
    </>
  );
}
```

## Reactions

```tsx
class SearchView extends View<Props> {
  query = '';
  results: string[] = [];

  onMount() {
    const dispose = reaction(
      () => this.query,
      async (query) => {
        if (query.length > 2) {
          this.results = await searchApi(query);
        }
      },
      { delay: 300 }
    );

    return dispose;
  }

  setQuery(e: React.ChangeEvent<HTMLInputElement>) {
    this.query = e.target.value;
  }

  render() {
    return (
      <div>
        <input value={this.query} onChange={this.setQuery} />
        <ul>{this.results.map(r => <li key={r}>{r}</li>)}</ul>
      </div>
    );
  }
}
```

## React Hooks

Hooks work inside `render()`:

```tsx
class DataView extends View<{ id: string }> {
  render() {
    const navigate = useNavigate();
    const { data, isLoading } = useQuery({
      queryKey: ['item', this.props.id],
      queryFn: () => fetchItem(this.props.id),
    });

    if (isLoading) return <div>Loading...</div>;

    return (
      <div onClick={() => navigate('/home')}>
        {data.name}
      </div>
    );
  }
}
```

## Vanilla JS Integration

Imperative libraries become straightforward:

```tsx
class ChartView extends View<{ data: number[] }> {
  containerRef = this.ref<HTMLDivElement>();
  chart: Chart | null = null;

  onMount() {
    this.chart = new Chart(this.containerRef.current!, {
      data: this.props.data,
    });

    const dispose = reaction(
      () => this.props.data,
      (data) => this.chart?.update(data)
    );

    return () => {
      dispose();
      this.chart?.destroy();
    };
  }

  render() {
    return <div ref={this.containerRef} />;
  }
}
```

Compare to hooks:

```tsx
function ChartView({ data }) {
  const containerRef = useRef();
  const chartRef = useRef();

  useEffect(() => {
    chartRef.current = new Chart(containerRef.current, { data });
    return () => chartRef.current.destroy();
  }, []);

  useEffect(() => {
    chartRef.current?.update(data);
  }, [data]);

  return <div ref={containerRef} />;
}
```

Split effects, multiple refs, dependency tracking: all unnecessary with Mantle.

## Error Handling

Render errors propagate to React error boundaries as usual. Lifecycle errors (`onLayoutMount`, `onMount`, `onUpdated`, `onUnmount`, `watch`) in both Views and Behaviors are caught and routed through a configurable handler.

By default, errors are logged to `console.error`. Configure a global handler to integrate with your error reporting:

```tsx
import { configure } from 'mobx-mantle';

configure({
  onError: (error, context) => {
    // context.phase: 'onLayoutMount' | 'onMount' | 'onUpdated' | 'onUnmount' | 'watch'
    // context.name: class name of the View or Behavior
    // context.isBehavior: true if the error came from a Behavior
    Sentry.captureException(error, {
      tags: { phase: context.phase, component: context.name },
    });
  },
});
```

Behavior errors are isolated. A failing Behavior won't prevent sibling Behaviors or the parent View from mounting.

## Behaviors (Experimental)

> ⚠️ **Experimental:** The Behaviors API is still evolving and may change in future releases.

Behaviors are reusable pieces of state and logic that can be shared across views. Define them as classes, wrap with `createBehavior()`, and use the resulting factory function in your Views.

### Defining a Behavior

```tsx
import { Behavior, createBehavior } from 'mobx-mantle';

class WindowSizeBehavior extends Behavior {
  width = window.innerWidth;
  height = window.innerHeight;
  breakpoint!: number;

  onCreate(breakpoint = 768) {
    this.breakpoint = breakpoint;
  }

  get isMobile() {
    return this.width < this.breakpoint;
  }

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
```

The naming convention:
- **Class**: PascalCase (`WindowSizeBehavior`)
- **Factory**: camelCase with `with` prefix (`withWindowSize`)

### Using Behaviors

Call the factory function (no `new` keyword) in your View. The `with` prefix signals that the View manages this behavior's lifecycle:

```tsx
import { withWindowSize } from './withWindowSize';

class Responsive extends View<Props> {
  windowSize = withWindowSize(768);

  render() {
    return (
      <div>
        {this.windowSize.isMobile ? <MobileLayout /> : <DesktopLayout />}
        <p>Window: {this.windowSize.width}x{this.windowSize.height}</p>
      </div>
    );
  }
}

export default createView(Responsive);
```

### Watching in Behaviors

Behaviors can use `this.watch` just like Views:

```tsx
class FetchBehavior extends Behavior {
  url!: string;
  data: any[] = [];
  loading = false;

  onCreate(url: string) {
    this.url = url;
    this.watch(() => this.url, () => this.fetchData(), { fireImmediately: true });
  }

  async fetchData() {
    this.loading = true;
    this.data = await fetch(this.url).then(r => r.json());
    this.loading = false;
  }
}

export const withFetch = createBehavior(FetchBehavior);
```

### Multiple Behaviors

Behaviors compose naturally:

```tsx
// FetchBehavior.ts
import { Behavior, createBehavior } from 'mobx-mantle';

class FetchBehavior extends Behavior {
  url!: string;
  interval = 5000;
  data: Item[] = [];
  loading = false;

  onCreate(url: string, interval = 5000) {
    this.url = url;
    this.interval = interval;
  }

  onMount() {
    this.fetchData();
    const id = setInterval(() => this.fetchData(), this.interval);
    return () => clearInterval(id);
  }

  async fetchData() {
    this.loading = true;
    this.data = await fetch(this.url).then(r => r.json());
    this.loading = false;
  }
}

export const withFetch = createBehavior(FetchBehavior);
```

```tsx
import { View, createView } from 'mobx-mantle';
import { withFetch } from './FetchBehavior';
import { withWindowSize } from './WindowSizeBehavior';

class Dashboard extends View<Props> {
  users = withFetch('/api/users', 10000);
  posts = withFetch('/api/posts');
  windowSize = withWindowSize(768);

  render() {
    return (
      <div>
        {this.users.loading ? 'Loading...' : `${this.users.data.length} users`}
        {this.windowSize.isMobile && <MobileNav />}
      </div>
    );
  }
}

export default createView(Dashboard);

### Behavior Lifecycle

Behaviors support the same lifecycle methods as Views:

| Method | When |
|--------|------|
| `onCreate(...args)` | Called during construction with the factory arguments |
| `onLayoutMount()` | Called when parent View layout mounts (before paint). Return cleanup (optional). |
| `onMount()` | Called when parent View mounts (after paint). Return cleanup (optional). |
| `onUnmount()` | Called when parent View unmounts, after cleanups (optional). |


## API

### `configure(config)`

Set global defaults for all views. Settings can still be overridden per-view in `createView` options.

```tsx
import { configure } from 'mobx-mantle';

// Disable auto-observable globally (for decorator users)
configure({ autoObservable: false });
```

| Option | Default | Description |
|--------|---------|-------------|
| `autoObservable` | `true` | Whether to automatically make View instances observable |
| `onError` | `console.error` | Global error handler for lifecycle errors (see [Error Handling](#error-handling)) |

### `View<P>` / `ViewModel<P>`

Base class for view components. `ViewModel` is an alias for `View`. Use it when separating the ViewModel from the template for semantic clarity.

| Property/Method | Description |
|-----------------|-------------|
| `props` | Current props (reactive) |
| `forwardRef` | Ref passed from parent component (for ref forwarding) |
| `onCreate()` | Called when instance created |
| `onLayoutMount()` | Called before paint, return cleanup (optional) |
| `onMount()` | Called after paint, return cleanup (optional) |
| `onUpdated()` | Called after every render |
| `onUnmount()` | Called on unmount, after cleanups (optional) |
| `render()` | Return JSX (optional if using template) |
| `ref<T>()` | Create a ref for DOM elements |
| `watch(expr, callback, options?)` | Watch reactive expression, auto-disposed on unmount |

### `Behavior`

Base class for behaviors. Extend it and wrap with `createBehavior()`.

| Method | Description |
|--------|-------------|
| `onCreate(...args)` | Called during construction with constructor args |
| `onLayoutMount()` | Called before paint, return cleanup (optional) |
| `onMount()` | Called after paint, return cleanup (optional) |
| `onUnmount()` | Called when parent View unmounts |
| `watch(expr, callback, options?)` | Watch reactive expression, auto-disposed on unmount |

### `createBehavior(Class)`

Creates a factory function from a behavior class. Returns a callable (no `new` needed).

```tsx
class MyBehavior extends Behavior {
  onCreate(value: string) { /* ... */ }
}

export const withMyBehavior = createBehavior(MyBehavior);

// Usage: withMyBehavior('hello')
```

### `createView(ViewClass, templateOrOptions?)`

Function that creates a React component from a View class.

```tsx
// Basic (auto-observable)
createView(MyView)

// With template
createView(MyView, (vm) => <div>{vm.value}</div>)

// With options
createView(MyView, { autoObservable: false })
```

| Option | Default | Description |
|--------|---------|-------------|
| `autoObservable` | `true` | Make all fields observable. Set to `false` when using decorators. |

## Who This Is For

- Teams using MobX for state management
- Developers from other platforms (mobile, backend, other frameworks)
- Projects integrating vanilla JS libraries
- Anyone tired of dependency arrays

## License

MIT
