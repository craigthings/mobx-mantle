# mobx-view

A minimal library that brings MobX reactivity to React components with a familiar class-based API.

Full access to the React ecosystem. Better access to vanilla JS libraries. Simpler DX for both.

## Why

React hooks solve real problems—stale closures, dependency tracking, memoization. MobX already solves those problems. So if you're using MobX, hooks add complexity without benefit.

This library lets you write components in a way that is more familiar to common programming patterns outside the React ecosystem: mutable state, stable references, computed getters, direct method calls.

## Basic Example

```tsx
import { View, createView } from 'mobx-view';

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
| `onMount()` | Component mounted. Return a cleanup function (optional). |
| `onUnmount()` | Component unmounting. Called after `onMount` cleanup (optional). |
| `render()` | Standard React render |

### Props Reactivity

`this.props` is reactive—MobX tracks access automatically. Use `reaction` or `autorun` to respond to prop changes:

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
class TodoVM extends View<Props> {
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

For teams that prefer explicit annotations:

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

export const Todo = createView(TodoView, { autoObservable: false });
```

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

Split effects, multiple refs, dependency tracking—all unnecessary with mobx-view.

## API

### `View<P>`

Base class for view components.

| Property/Method | Description |
|-----------------|-------------|
| `props` | Current props (reactive) |
| `forwardRef` | Ref passed from parent component (for ref forwarding) |
| `onCreate()` | Called when instance created |
| `onMount()` | Called on mount, return cleanup function (optional) |
| `onUnmount()` | Called on unmount, after `onMount` cleanup (optional) |
| `render()` | Return JSX (optional if using template) |
| `ref<T>()` | Create a ref for DOM elements |

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
