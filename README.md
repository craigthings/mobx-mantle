# MobX Mantle

A lightweight library for building React components with a familiar class-based API and MobX reactivity built in. Get full access to the React ecosystem, with better access to vanilla JS libraries, and simpler overall DX for both.

## Why

If you're using MobX for state management, React hooks often add complexity without benefit. React hooks solve real problems: stale closures, dependency tracking, memoization. But when using MobX reactivity, many of those problems are already solved.

The goal is to give React developers a way to build components using patterns common outside the React world: mutable state, stable references, computed getters, direct method calls. Patterns familiar to developers from game development, mobile frameworks, and other web frameworks. This makes it easier to use excellent vanilla JS libraries while still accessing the massive React ecosystem.

## Installation

```bash
npm install mobx-mantle
```

Requires React 18+ and MobX 6+. (No other dependencies — Mantle ships its own observer implementation.)

## Basic Example

```tsx
import { Component, createComponent } from 'mobx-mantle';

interface CounterProps {
  initial: number;
}

class Counter extends Component<CounterProps> {
  count = this.props.initial;

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

export default createComponent(Counter);
```

**Everything is reactive by default.** All properties become observable, getters become computed, and methods become auto-bound. No annotations needed.

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
  this.watch(
    () => this.props.filter,
    (filter) => this.applyFilter(filter)
  );
}
```

## Lifecycle

| Method | When |
|--------|------|
| `onCreate()` | Instance created, props available, before first render. Derive initial state here (synchronous only). |
| `onLayoutMount()` | DOM ready, before paint. Return a cleanup function (optional). |
| `onMount()` | Component mounted, after paint. The default home for watchers, effects, and resource acquisition. Return a cleanup function (optional). |
| `onUpdate()` | After every render (via `useEffect`). |
| `onUnmount()` | Component unmounting. Called after cleanups (optional). |
| `render()` | On mount and updates. Return JSX. |

**The rule of thumb:** everything goes in `onMount()`; derive initial state in `onCreate()`. If React unmounts and remounts a component (StrictMode does this intentionally in development), `onLayoutMount`/`onMount` re-run as usual — and as a safety net, `watch`/`effect` declarations made before mount are automatically re-created too. Plain `addCleanup` registrations are not; Mantle warns in development if one is registered before mount.

### Initial State From Props

`this.props` is available during class field initialization. Use this for simple initial state derived from props:

```tsx
class Editor extends Component<{ defaultValue: string }> {
  value = this.props.defaultValue;
}
```

Use `onCreate()` for more complex conditional setup needed before the first render:

```tsx
class Editor extends Component<{ defaultValue?: string; mode: 'plain' | 'rich' }> {
  value = '';

  onCreate() {
    if (this.props.mode === 'rich') {
      this.value = normalizeRichText(this.props.defaultValue ?? '');
    } else {
      this.value = this.props.defaultValue ?? '';
    }
  }
}
```

Most components should not define a constructor. If you do, call `super(props)` before accessing `this.props`.

### Watching State

Use `this.watch` to react to state changes. Declare watchers in `onMount()` — they're automatically disposed on unmount, and `onMount` re-runs if the component remounts, so the contract is React-native and StrictMode-safe.

Coming from Vue or Svelte, you may reach for `onCreate()` instead — that works too: watchers declared there are automatically re-created on remount. The only behavioral difference is timing: `onCreate` watchers come alive when the component commits, just before the first paint. `fireImmediately` and `effect`'s initial pass run at that point — after the first render, before the user sees anything. (Registrations are recorded during construction but not started, so renders React throws away — Suspense, interrupted transitions — never leak watchers. It also means the first render cannot depend on state a watcher or effect sets; for deriving state, prefer a computed getter.)

```tsx
this.watch(
  () => this.query,                       // expression to track
  (query, prev) => this.search(query),    // runs when result changes
  { delay: 300, fireImmediately: true }   // debounce + run on setup
);
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `delay` | `number` | — | Debounce the callback by N milliseconds |
| `fireImmediately` | `boolean` | `false` | Run callback immediately with current value |

**Basic example:**

```tsx
class Search extends Component<Props> {
  query = '';
  results: string[] = [];

  onMount() {
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

Call `this.watch` as many times as you need — each watcher is tracked and disposed independently.

**Early disposal** (works the same for `effect`):

```tsx
onMount() {
  const stop = this.watch(() => this.props.token, (token) => {
    this.authenticate(token);
    stop(); // only needed once
  });
}
```

`this.watch` wraps MobX's `reaction` with automatic lifecycle disposal and remount-safe re-creation. For advanced MobX patterns (`when`, custom schedulers), use MobX directly and return a dispose function from `onMount`.

### Effects

Use `this.effect` to run a side effect that auto-tracks dependencies. It runs immediately and re-runs whenever any accessed observable changes.

```tsx
this.effect(() => {
  document.title = `${this.count} items`;   // auto-tracks this.count
  return () => { /* cleanup */ };            // optional, runs before each re-run
}, { delay: 100 });                          // optional debounce
```

**When to use which:**

| Method | Best for |
|--------|----------|
| `effect(fn)` | Simple sync: DOM updates, logging, derived side effects |
| `watch(expr, fn)` | Complex side effects with explicit triggers: API calls, debounced actions |

`effect` auto-tracks all accessed state, which can lead to unexpected re-runs in complex scenarios. For side effects where you want explicit control over what triggers re-runs, prefer `watch`.

**Example:**

```tsx
class Counter extends Component<Props> {
  count = 0;

  onMount() {
    // Runs immediately, re-runs when this.count changes
    this.effect(() => {
      const handler = () => console.log('clicked at count:', this.count);
      window.addEventListener('click', handler);

      // Cleanup runs before each re-run and on unmount
      return () => window.removeEventListener('click', handler);
    });
  }
}
```

Early disposal works the same as `watch` — the returned `stop()` function tears the effect down early.

### Cleanup

Use `this.addCleanup` to register any cleanup function that should run automatically on unmount. This is useful for subscriptions, event listeners, timers, observers, and third-party libraries.

```tsx
onMount() {
  this.addCleanup(store.subscribe(this.handleChange));

  window.addEventListener('resize', this.handleResize);
  this.addCleanup(() => window.removeEventListener('resize', this.handleResize));

  const id = setInterval(this.tick, 1000);
  this.addCleanup(() => clearInterval(id));
}
```

`addCleanup` returns a function you can call for early cleanup. `watch()` and `effect()` use the same automatic cleanup behavior internally.

> **Note:** `addCleanup` registrations are one-shot — unlike `watch`/`effect`, they are not re-created if the component remounts. Acquire resources in `onMount()` (which re-runs on remount), or use `this.effect()` when setup must happen at creation — its setup/teardown pair is remount-safe. Mantle warns in development if `addCleanup` is called before mount.

### Props Reactivity

`this.props` is reactive: your component re-renders when accessed props change.

**Option 1: `this.watch`** — the recommended way to react to state changes:

```tsx
onMount() {
  this.watch(
    () => this.props.filter,
    (filter) => this.applyFilter(filter)
  );
}
```

Watchers are automatically disposed on unmount and re-created on remount. No cleanup needed.

**Option 2: raw MobX** — for advanced patterns (`autorun`, `when`, custom schedulers), call MobX directly in `onMount` and return the disposer.

**Option 3: `onUpdate`** — imperative hook after each render; requires manual dirty-checking against the previous value.

Or access props directly in `render()` and MobX handles re-renders when they change.

> **Performance note:** a prop change costs exactly one render when `render()` reads props directly. A computed getter *over props* read in `render()` can add one extra render before paint — what's painted is always correct. If a hot component renders twice per prop change, that's the first thing to check.

## Patterns

### Combined (default)

State, logic, and template in one class:

```tsx
class Todo extends Component<Props> {
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

export default createComponent(Todo);
```

### Separated

ViewModel and template separate:

```tsx
import { ViewModel, createComponent } from 'mobx-mantle';

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

export default createComponent(Todo, (vm) => (
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
import { Component, createComponent, observable, action, computed } from 'mobx-mantle';

class Todo extends Component<Props> {
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

export default createComponent(Todo);
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

class Todo extends Component<Props> {
  @observable accessor todos: TodoItem[] = [];  // note: accessor required
  @action add() { /* ... */ }
}

export default createComponent(Todo);
```

Note: `this.props` is always reactive regardless of decorator mode.

## Refs

```tsx
class Form extends Component<Props> {
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
class FancyInput extends Component<InputProps> {
  render() {
    return <input ref={this.forwardRef} className="fancy-input" />;
  }
}

export default createComponent(FancyInput);

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

## React Hooks

Hooks work inside `render()`:

```tsx
class DataView extends Component<{ id: string }> {
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
class Chart extends Component<{ data: number[] }> {
  containerRef = this.ref<HTMLDivElement>();
  chart: Chart | null = null;

  onMount() {
    this.chart = new Chart(this.containerRef.current!, {
      data: this.props.data,
    });

    this.watch(
      () => this.props.data,
      (data) => this.chart?.update(data)
    );

    return () => this.chart?.destroy();
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

## Side by Side

Each example shows the same component in Mantle and React hooks. As components grow, hooks require an increasingly complex web of dependency arrays, memoized callbacks, and mirrored refs that you have to maintain by hand — miss one and you get a silent bug. These comparisons show how Mantle helps to significantly sidesteps that overhead.

### Copy to Clipboard

A small component with async logic, a reset timer, and cleanup. The kind of thing every project has:

```tsx
class CopyButton extends Component<{ text: string; label?: string }> {
  copied = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  async copy() {
    await navigator.clipboard.writeText(this.props.text);
    this.copied = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => (this.copied = false), 2000);
  }

  onUnmount() {
    if (this.timer) clearTimeout(this.timer);
  }

  render() {
    return (
      <button onClick={this.copy}>
        {this.copied ? 'Copied!' : (this.props.label ?? 'Copy')}
      </button>
    );
  }
}
```

Compare to hooks:

```tsx
function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 2000);
  }, [text]); // forget `text` here and you copy stale values

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  return (
    <button onClick={copy}>
      {copied ? 'Copied!' : (label ?? 'Copy')}
    </button>
  );
}
```

The hooks version needs `useState`, `useRef`, `useCallback` with a dependency array, and a separate `useEffect` for cleanup. Miss `text` in the dependency array and you get a stale closure bug. In Mantle, `this.props.text` is always current.

### Inline List Editor

A component with multiple interaction modes — adding, editing, keyboard shortcuts, and paste handling:

```tsx
class ListEditor extends Component<{ items: string[]; onChange: (items: string[]) => void }> {
  newItem = '';
  editingIndex: number | null = null;
  editValue = '';

  add() {
    if (!this.newItem.trim()) return;
    this.props.onChange([...this.props.items, this.newItem.trim()]);
    this.newItem = '';
  }

  remove(index: number) {
    this.props.onChange(this.props.items.filter((_, i) => i !== index));
  }

  startEdit(index: number) {
    this.editingIndex = index;
    this.editValue = this.props.items[index];
  }

  saveEdit() {
    if (this.editingIndex === null) return;
    const updated = [...this.props.items];
    updated[this.editingIndex] = this.editValue.trim();
    this.props.onChange(updated);
    this.editingIndex = null;
  }

  cancelEdit() {
    this.editingIndex = null;
  }

  handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') this.add();
  }

  handleEditKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') this.saveEdit();
    if (e.key === 'Escape') this.cancelEdit();
  }

  handlePaste(e: React.ClipboardEvent) {
    const lines = e.clipboardData.getData('text').split(/\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length <= 1) return;
    e.preventDefault();
    this.props.onChange([...this.props.items, ...lines]);
  }

  render() { /* ... */ }
}
```

Compare to hooks:

```tsx
function ListEditor({ items, onChange }: { items: string[]; onChange: (items: string[]) => void }) {
  const [newItem, setNewItem] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

  const add = useCallback(() => {
    if (!newItem.trim()) return;
    onChange([...items, newItem.trim()]);
    setNewItem('');
  }, [newItem, items, onChange]);

  const remove = useCallback((index: number) => {
    onChange(items.filter((_, i) => i !== index));
  }, [items, onChange]);

  const startEdit = useCallback((index: number) => {
    setEditingIndex(index);
    setEditValue(items[index]);
  }, [items]);

  const saveEdit = useCallback(() => {
    if (editingIndex === null) return;
    const updated = [...items];
    updated[editingIndex] = editValue.trim();
    onChange(updated);
    setEditingIndex(null);
  }, [editingIndex, editValue, items, onChange]);

  const cancelEdit = useCallback(() => setEditingIndex(null), []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') add();
  }, [add]);

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') saveEdit();
    if (e.key === 'Escape') cancelEdit();
  }, [saveEdit, cancelEdit]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const lines = e.clipboardData.getData('text').split(/\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length <= 1) return;
    e.preventDefault();
    onChange([...items, ...lines]);
  }, [items, onChange]);

  return /* ... */;
}
```

3 `useState`, 7 `useCallback` with dependency chains where each callback depends on others. `handleKeyDown` depends on `add`, which depends on `newItem`, `items`, and `onChange`. Miss one and you get stale state. The Mantle version is just methods calling `this` — no dependency graph to maintain.

## Error Handling

Render errors propagate to React error boundaries as usual. Lifecycle errors (`onLayoutMount`, `onMount`, `onUpdate`, `onUnmount`, `watch`) in both Components and Behaviors are caught and routed through a configurable handler.

By default, errors are logged to `console.error`. Configure a global handler to integrate with your error reporting:

```tsx
import { configure } from 'mobx-mantle';

configure({
  onError: (error, context) => {
    // context.phase: 'onLayoutMount' | 'onMount' | 'onUpdate' | 'onUnmount' | 'watch'
    // context.name: class name of the Component or Behavior
    // context.isBehavior: true if the error came from a Behavior
    Sentry.captureException(error, {
      tags: { phase: context.phase, component: context.name },
    });
  },
});
```

Behavior errors are isolated. A failing Behavior won't prevent sibling Behaviors or the parent Component from mounting.

## MobX Action Enforcement

MobX's default setting (`enforceActions: "observed"`) warns whenever observed state is mutated outside an action. That default assumes you wrap every mutation site — including every async continuation:

```tsx
async copy() {
  await navigator.clipboard.writeText(this.text);
  this.copied = true;   // ← after an await, outside any action: MobX warns
}
```

Mantle already batches synchronous mutations through its method binding, and async continuations *cannot* be action-wrapped without ceremony (`runInAction` around every post-`await` assignment). Since these are exactly the patterns Mantle encourages, Mantle sets `enforceActions: 'never'` globally — applied lazily when the first component or behavior is created.

If your app runs deliberate strict-mode MobX stores alongside Mantle, opt out during startup:

```tsx
import { configure } from 'mobx-mantle';

configure({ manageMobxActions: false });
// You are now responsible for your own mobx.configure({ enforceActions: ... })
```

The opt-out must run before the first component renders. Note that MobX configuration is global to the process: with the default behavior, Mantle's setting overrides an `enforceActions` value your app set earlier.

## Behaviors (Experimental)

> ⚠️ **Experimental:** The Behaviors API is still evolving and may change in future releases.

Behaviors are reusable pieces of state and logic that can be shared across components. Define them as classes, wrap with `createBehavior()`, and use the resulting factory function in your Components.

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

Call the factory function (no `new` keyword) in your Component. The `with` prefix signals that the Component manages this behavior's lifecycle:

```tsx
import { withWindowSize } from './withWindowSize';

class Responsive extends Component<Props> {
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

export default createComponent(Responsive);
```

### Watching in Behaviors

Behaviors can use `this.watch` just like Components:

```tsx
class FetchBehavior extends Behavior {
  url!: string;
  data: any[] = [];
  loading = false;

  onCreate(url: string) {
    this.url = url;
  }

  onMount() {
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
import { Component, createComponent } from 'mobx-mantle';
import { withFetch } from './FetchBehavior';
import { withWindowSize } from './WindowSizeBehavior';

class Dashboard extends Component<Props> {
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

export default createComponent(Dashboard);
```

### Behavior Lifecycle

Behaviors support the same lifecycle methods as Components:

| Method | When |
|--------|------|
| `onCreate(...args)` | Called during construction with the factory arguments |
| `onLayoutMount()` | Called when parent Component layout mounts (before paint). Return cleanup (optional). |
| `onMount()` | Called when parent Component mounts (after paint). Return cleanup (optional). |
| `onUnmount()` | Called when parent Component unmounts, after cleanups (optional). |

### Reactive Arguments

A behavior's setup runs once, so a plain argument is a snapshot — frozen at construction. To pass a *live* value, pass a getter. Type the parameter as `MaybeGetter<T>` and read it with `resolve()`:

```tsx
import { Behavior, createBehavior, resolve, type MaybeGetter } from 'mobx-mantle';

class FetchBehavior extends Behavior {
  onCreate(url: MaybeGetter<string>) {
    this.watch(() => resolve(url), (u) => this.fetchData(u), { fireImmediately: true });
  }
}
export const withFetch = createBehavior(FetchBehavior);
```

Consumers choose per call site:

```tsx
class Dashboard extends Component<Props> {
  static = withFetch('/api/users');            // frozen at construction
  live   = withFetch(() => this.props.url);    // refetches when the prop changes
}
```

This is the same convention Vue (`MaybeRefOrGetter` + `toValue`) and Solid (`MaybeAccessor` + `access`) converged on. One caveat: an argument that is legitimately a function (a callback, not a getter) can't also be a `MaybeGetter` — the two are indistinguishable at runtime, so choose per parameter which ones are reactive.

### Nesting Behaviors

Behaviors compose recursively: a behavior declared as a field of another behavior (or assigned in its `onCreate`) receives the full lifecycle relay. Children mount before their parent's `onMount` — so a parent can rely on live children — and tear down after their parent's `onUnmount`, in reverse order.

```tsx
class AutosaveBehavior extends Behavior {
  saver = withAsync((url, data) => postJson(url, data)); // child: request state machine
  timer!: IntervalBehavior;

  onCreate(url: MaybeGetter<string>, data: () => unknown, interval = 5000) {
    this.timer = withInterval(() => this.save(), interval); // child: scheduling
  }

  save() { /* diff + this.saver.run(...) */ }
}
export const withAutosave = createBehavior(AutosaveBehavior);
```

Two rules, both consistent with how Components collect behaviors:

- **Underscore-prefixed fields are invisible** to collection — `_helper = withThing()` is not relayed.
- **Late assignment isn't collected.** Components collect behaviors at construction; a behavior assigned to a Component field later (conditionally, lazily, or in the Component's `onCreate`) silently never mounts. Mantle warns in development when it finds one. (Inside a *behavior*, `onCreate` assignment is fine — behaviors scan after `onCreate` runs.)

### Behaviors in Plain Function Components

You don't have to adopt Mantle components to use behaviors. `useBehavior()` hosts any behavior inside an ordinary function component, with the same lifecycle relay (StrictMode-safe, watchers alive from commit, full teardown on unmount). Wrap the component in `observer()` so renders track the behavior's observables:

```tsx
import { useBehavior, observer } from 'mobx-mantle';
import { withWindowSize } from 'mobx-mantle/primitives';

const Toolbar = observer(() => {
  const size = useBehavior(() => withWindowSize());
  return <div>{size.width} × {size.height}</div>;
});
```

The factory runs once per mount lifetime. Because of that, getter arguments close over the first render — getters reading observables stay live, but getters reading the function component's own props go stale. Pass observable sources instead.

This inverts the adoption story: logic written as a behavior runs in both worlds, and Mantle Components are simply the nicer host.

### Primitives

`mobx-mantle/primitives` ships a standard library of small behaviors, all with `MaybeGetter` arguments:

`withEventListener`, `withInterval`, `withTimeout`, `withAsync`, `withFetch`, `withLocalStorage`, `withWindowSize`, `withMediaQuery`, `withDebounce`, `withThrottle`, `withDocumentTitle`, `withPageVisibility`, `withAutosave`.

Several are themselves compositions — `withFetch` nests `withAsync`; `withWindowSize`, `withLocalStorage`, and `withPageVisibility` nest `withEventListener`; `withAutosave` nests `withInterval` + `withAsync` — the same nesting available to your own behaviors.

```tsx
import { withFetch, withMediaQuery } from 'mobx-mantle/primitives';

class Dashboard extends Component<Props> {
  users = withFetch<User[]>(() => `/api/users?team=${this.props.teamId}`);
  compact = withMediaQuery('(max-width: 768px)');

  render() {
    if (this.users.loading) return <Spinner />;
    return <UserList users={this.users.data} compact={this.compact.matches} />;
  }
}
```

### What Behaviors Are Not For

- **Behaviors cannot call hooks.** `useContext`, `useQuery`, and friends are render-scoped; behaviors live outside the render cycle. The blessed pattern: read the hook in `render()` and pass the value where it's needed.
- **Division of labor:** behaviors own vanilla-JS integration, MobX-native logic, and cheaply-testable state machines; hooks own React-ecosystem bindings; `render()` is where the two meet.

## API

### `configure(config)`

Set global defaults for all components. Settings can still be overridden per-component in `createComponent` options.

```tsx
import { configure } from 'mobx-mantle';

// Disable auto-observable globally (for decorator users)
configure({ autoObservable: false });
```

| Option | Default | Description |
|--------|---------|-------------|
| `autoObservable` | `true` | Whether to automatically make Component instances observable |
| `cacheAnnotations` | `true` | Cache per-class annotation data (getters, methods) so repeated instantiations skip the prototype walk. Turn off only if class prototypes are mutated between instantiations. |
| `onError` | `console.error` | Global error handler for lifecycle errors (see [Error Handling](#error-handling)) |
| `manageMobxActions` | `true` | Whether Mantle sets MobX's `enforceActions` to `'never'` (see [MobX Action Enforcement](#mobx-action-enforcement)). Set to `false` before the first render to manage it yourself. |

### `Component<P>` / `ViewModel<P>`

Base class for components. `ViewModel` is an alias for `Component`. Use it when separating the ViewModel from the template for semantic clarity.

| Property/Method | Description |
|-----------------|-------------|
| `props` | Current props (reactive, available in field initializers) |
| `forwardRef` | Ref passed from parent component (for ref forwarding) |
| `onCreate()` | Called when instance is created, before first render |
| `onLayoutMount()` | Called before paint, return cleanup (optional) |
| `onMount()` | Called after paint, return cleanup (optional) |
| `onUpdate()` | Called after every render |
| `onUnmount()` | Called on unmount, after cleanups (optional) |
| `render()` | Return JSX (optional if using template) |
| `ref<T>()` | Create a ref for DOM elements |
| `addCleanup(fn)` | Register cleanup to run automatically on unmount |
| `watch(expr, callback, options?)` | Watch reactive expression, auto-disposed on unmount, re-created on remount |
| `effect(fn, options?)` | Run auto-tracked side effect, auto-disposed on unmount, re-created on remount |

### `Behavior`

Base class for behaviors. Extend it and wrap with `createBehavior()`.

| Method | Description |
|--------|-------------|
| `onCreate(...args)` | Called during construction with constructor args |
| `onLayoutMount()` | Called before paint, return cleanup (optional) |
| `onMount()` | Called after paint, return cleanup (optional) |
| `onUnmount()` | Called when parent Component unmounts |
| `addCleanup(fn)` | Register cleanup to run automatically on unmount |
| `watch(expr, callback, options?)` | Watch reactive expression, auto-disposed on unmount, re-created on remount |
| `effect(fn, options?)` | Run auto-tracked side effect, auto-disposed on unmount, re-created on remount |

### `createBehavior(Class)`

Creates a factory function from a behavior class. Returns a callable (no `new` needed).

```tsx
class MyBehavior extends Behavior {
  onCreate(value: string) { /* ... */ }
}

export const withMyBehavior = createBehavior(MyBehavior);

// Usage: withMyBehavior('hello')
```

### `createComponent(ComponentClass, templateOrOptions?)`

Function that creates a React component from a Component class.

```tsx
// Basic (auto-observable)
createComponent(MyComponent)

// With template
createComponent(MyComponent, (vm) => <div>{vm.value}</div>)

// With options
createComponent(MyComponent, { autoObservable: false })
```

| Option | Default | Description |
|--------|---------|-------------|
| `autoObservable` | `true` | Make all fields observable. Set to `false` when using decorators. |

### `useBehavior(factory)`

Host a behavior in a plain React function component (see [Behaviors in Plain Function Components](#behaviors-in-plain-function-components)). The factory runs once per mount lifetime; the returned instance is observable — pair with `observer()`.

```tsx
const size = useBehavior(() => withWindowSize());
```

### `observer(fc)`

Minimal observer wrapper for function components — re-renders when any observable read during render changes. Ships with Mantle (no `mobx-react-lite` needed); intended for components using `useBehavior()` or reading MobX stores directly.

### `resolve(value)` / `MaybeGetter<T>`

The value-or-getter convention for reactive behavior arguments (see [Reactive Arguments](#reactive-arguments)). `resolve(v)` returns `v()` if `v` is a function, otherwise `v`.

## Who This Is For

- Teams using MobX for state management
- Developers from other platforms (mobile, backend, other frameworks)
- Projects integrating vanilla JS libraries
- Anyone tired of dependency arrays

## License

MIT
