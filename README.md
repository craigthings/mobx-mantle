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

class CounterView extends View<CounterProps> {
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

export const Counter = createView(CounterView);
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
class TodoView extends View<Props> {
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

export const Todo = createView(TodoView);
```

### Separated

ViewModel and template separate:

```tsx
import { ViewModel, createView } from 'mobx-mantle';

class TodoVM extends ViewModel<Props> {
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

export const Todo = createView(TodoVM, (vm) => (
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
class TodoView extends View<Props> {
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

export const Todo = createView(TodoView);
```

**Legacy Decorators** (experimental, requires `makeObservable`):

```tsx
class TodoView extends View<Props> {
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

export const Todo = createView(TodoView);
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
class FancyInputView extends View<InputProps> {
  render() {
    return <input ref={this.forwardRef} className="fancy-input" />;
  }
}

export const FancyInput = createView(FancyInputView);

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

## Behaviors

Behaviors are reusable pieces of state and logic that can be shared across views. Use `this.use()` to create behavior instances with automatic lifecycle management.

### Basic Behavior

```tsx
class WindowSizeBehavior {
  width = window.innerWidth;
  height = window.innerHeight;

  onMount() {
    const handler = () => {
      this.width = window.innerWidth;
      this.height = window.innerHeight;
    };
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }
}

class ResponsiveView extends View<Props> {
  windowSize = this.use(WindowSizeBehavior);

  get isMobile() {
    return this.windowSize.width < 768;
  }

  render() {
    return (
      <div>
        {this.isMobile ? <MobileLayout /> : <DesktopLayout />}
        <p>Window: {this.windowSize.width}x{this.windowSize.height}</p>
      </div>
    );
  }
}

export const Responsive = createView(ResponsiveView);
```

### Behavior Lifecycle

Behaviors support the same lifecycle methods as Views:

| Method | When |
|--------|------|
| `onCreate()` | Called immediately when `this.use()` is called |
| `onLayoutMount()` | Called when parent View layout mounts (before paint). Return cleanup (optional). |
| `onMount()` | Called when parent View mounts (after paint). Return cleanup (optional). |
| `onUnmount()` | Called when parent View unmounts, after cleanups (optional). |

```tsx
class DataSyncBehavior {
  data: Item[] = [];
  loading = false;

  onCreate() {
    console.log('Behavior created');
  }

  onMount() {
    this.fetchData();
    const interval = setInterval(() => this.fetchData(), 30000);
    return () => clearInterval(interval);
  }

  onUnmount() {
    console.log('Behavior destroyed');
  }

  async fetchData() {
    this.loading = true;
    this.data = await api.getItems();
    this.loading = false;
  }
}
```

### Behavior Options

By default, behaviors are made observable automatically. Disable this if you're using decorators:

```tsx
// Auto-observable (default)
windowSize = this.use(WindowSizeBehavior);

// With decorators
windowSize = this.use(WindowSizeBehavior, { observable: false });
```

### Typed Behaviors

For better IDE support, extend the `Behavior` base class:

```tsx
import { Behavior } from 'mobx-mantle';

class TimerBehavior extends Behavior {
  seconds = 0;
  private intervalId?: number;

  onMount() {
    this.intervalId = window.setInterval(() => {
      this.seconds++;
    }, 1000);
    return () => clearInterval(this.intervalId);
  }
}
```

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
| `use<T>(Class, options?)` | Create a behavior instance with lifecycle management |

### `Behavior`

Optional base class for behaviors used with `this.use()`.

| Method | Description |
|--------|-------------|
| `onCreate()` | Called when behavior is instantiated |
| `onLayoutMount()` | Called before paint, return cleanup (optional) |
| `onMount()` | Called after paint, return cleanup (optional) |
| `onUnmount()` | Called when parent View unmounts |

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
