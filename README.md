# mobx-mantle

A minimal library that brings MobX reactivity to React components with a familiar class-based API.

Full access to the React ecosystem. Better access to vanilla JS libraries. Simpler DX for both.

## Why

React hooks solve real problems—stale closures, dependency tracking, memoization. MobX already solves those problems. So if you're using MobX, hooks add complexity without benefit.

This library lets you write components in a way that is more familiar to common programming patterns outside the React ecosystem: mutable state, stable references, computed getters, direct method calls.

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
| `onUnmount()` | Component unmounting. Called after cleanups (optional). |
| `render()` | On mount and updates. Return JSX. |

### Props Reactivity

`this.props` is reactive—your component re-renders when accessed props change. Use `reaction` or `autorun` to respond to prop changes:

```tsx
onMount() {
  return reaction(
    () => this.props.filter,
    (filter) => this.applyFilter(filter)
  );
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

### With Decorators

For teams that prefer explicit annotations, disable `autoObservable` globally:

```tsx
// app.tsx (or entry point)
import { configure } from 'mobx-mantle';

configure({ autoObservable: false });
```

**TC39 Decorators** (recommended, self-registering):

```tsx
class Todo extends View<Props> {
  @observable accessor todos: TodoItem[] = [];
  @observable accessor input = '';

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

**Legacy Decorators** (experimental, requires `makeObservable`):

```tsx
class Todo extends View<Props> {
  @observable todos: TodoItem[] = [];
  @observable input = '';

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

Note: `this.props` is always reactive regardless of decorator type.

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

Split effects, multiple refs, dependency tracking—all unnecessary with mobx-mantle.

## Error Handling

Render errors propagate to React error boundaries as usual. Lifecycle errors (`onLayoutMount`, `onMount`, `onUnmount`) in both Views and Behaviors are caught and routed through a configurable handler.

By default, errors are logged to `console.error`. Configure a global handler to integrate with your error reporting:

```tsx
import { configure } from 'mobx-mantle';

configure({
  onError: (error, context) => {
    // context.phase: 'onLayoutMount' | 'onMount' | 'onUnmount'
    // context.name: class name of the View or Behavior
    // context.isBehavior: true if the error came from a Behavior
    Sentry.captureException(error, {
      tags: { phase: context.phase, component: context.name },
    });
  },
});
```

Behavior errors are isolated — a failing Behavior won't prevent sibling Behaviors or the parent View from mounting.

## Behaviors (Experimental)

> ⚠️ **Experimental:** The Behaviors API is still evolving and may change in future releases.

Behaviors are reusable pieces of state and logic that can be shared across views. Define them as plain classes, wrap with `createBehavior()`, and instantiate them in your Views.

### Basic Behavior

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

  // Class methods are auto-bound as actions (works with MobX strict mode)
  handleResize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
  }

  onMount() {
    window.addEventListener('resize', this.handleResize);
    return () => window.removeEventListener('resize', this.handleResize);
  }
}

export default createBehavior(WindowSizeBehavior);
```

Use it in a View by instantiating directly—arguments come from `onCreate`:

```tsx
import WindowSizeBehavior from './WindowSizeBehavior';

class Responsive extends View<Props> {
  windowSize = new WindowSizeBehavior(768);

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

### Behaviors with Arguments

Pass arguments via `onCreate()`. The constructor signature is inferred automatically:

```tsx
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

export default createBehavior(FetchBehavior);
```

```tsx
class MyView extends View<Props> {
  users = new FetchBehavior('/api/users', 10000);
  posts = new FetchBehavior('/api/posts');  // interval defaults to 5000

  render() {
    return (
      <div>
        {this.users.loading ? 'Loading...' : `${this.users.data.length} users`}
      </div>
    );
  }
}

export default createView(MyView);
```

> **Note:** If you prefer traditional constructors, you can use them instead:
> ```tsx
> class FetchBehavior extends Behavior {
>   constructor(public url: string, public interval = 5000) {
>     super();
>   }
> }
> ```
> Both patterns work—`createBehavior` infers constructor args from either.

### Behavior Lifecycle

Behaviors support the same lifecycle methods as Views:

| Method | When |
|--------|------|
| `onCreate(...args)` | Called during construction with the constructor arguments |
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

Base class for view components. `ViewModel` is an alias for `View`—use it when separating the ViewModel from the template for semantic clarity.

| Property/Method | Description |
|-----------------|-------------|
| `props` | Current props (reactive) |
| `forwardRef` | Ref passed from parent component (for ref forwarding) |
| `onCreate()` | Called when instance created |
| `onLayoutMount()` | Called before paint, return cleanup (optional) |
| `onMount()` | Called after paint, return cleanup (optional) |
| `onUnmount()` | Called on unmount, after cleanups (optional) |
| `render()` | Return JSX (optional if using template) |
| `ref<T>()` | Create a ref for DOM elements |

### `Behavior`

Base class for behaviors. Extend it and wrap with `createBehavior()`.

| Method | Description |
|--------|-------------|
| `onCreate(...args)` | Called during construction with constructor args |
| `onLayoutMount()` | Called before paint, return cleanup (optional) |
| `onMount()` | Called after paint, return cleanup (optional) |
| `onUnmount()` | Called when parent View unmounts |

### `createBehavior(Class)`

Wraps a behavior class for automatic observable wrapping and lifecycle management.

```tsx
class MyBehavior extends Behavior {
  value!: string;
  
  onCreate(value: string) {
    this.value = value;
  }
}

export default createBehavior(MyBehavior);

// Usage: new MyBehavior('hello')
```

### `createView(ViewClass, templateOrOptions?)`

Creates a React component from a View class.

```tsx
// Basic
createView(MyView)

// With template
createView(MyView, (vm) => <div>{vm.value}</div>)

// With options
createView(MyView, { autoObservable: false })
```

| Option | Default | Description |
|--------|---------|-------------|
| `autoObservable` | `true` | Use `makeAutoObservable`. Set to `false` for decorators. |

## Who This Is For

- Teams using MobX for state management
- Developers from other platforms (mobile, backend, other frameworks)
- Projects integrating vanilla JS libraries
- Anyone tired of dependency arrays

## License

MIT
