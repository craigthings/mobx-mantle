# Mantle Live — Behavior-Based Architecture

A collaborative, real-time layer for Mantle components. Any Mantle component becomes collaborative by adding `live = withLive(this)` and marking fields with `synced()`. No base class, no inheritance, no rewrites.

---

## Design Principles

The live layer is a **behavior** — a reusable piece of state and logic that attaches to any existing Mantle component. The component owns the UI and local state. The behavior owns the CRDT document, sync connection, and undo history.

Synced properties live directly on `this`, not behind a namespace. After `withLive` does its work, synced properties *are* MobX observables. The Loro binding is a layer underneath — invisible to everything except the behavior itself. Any code that reads or writes `this.current` has no idea there's a network behind it.

This is only possible because Mantle components are class instances — a stable, mutable object that can be scanned, mutated, and referenced for the component's entire lifetime. The `withLive(this)` pattern relies on capabilities that the hooks model doesn't expose: runtime introspection, property replacement, and a stable identity that external systems can bind to.

---

## API Surface

The entire vocabulary is four imports:

```tsx
import { withLive, synced, broadcast, ForLive } from 'mantle-live';
```

| API | Purpose |
|---|---|
| `withLive(this)` | Attach the live behavior to a component |
| `synced(default)` | Synced, persisted, undo-able value (owner only) |
| `synced(default, { shared: true })` | Synced value editable by any editor |
| `synced(default, { undo: false })` | Synced value excluded from undo history |
| `synced.components(Class)` | Synced collection of live child components |
| `synced.components(Class, [...])` | Synced collection with initial values |
| `broadcast(fn)` | Ephemeral event sent to all connected peers |
| `<ForLive each={...}>` | Render a synced collection |

---

## Basic Example

```tsx
// HpTracker.tsx
import { Component, createComponent } from 'mobx-mantle';
import { withLive, synced } from 'mantle-live';

class HpTracker extends Component {
  live = withLive(this);

  // Synced state — persisted, collaborative, undo-able
  current = synced(45);
  max = synced(78);
  temp = synced(0);
  name = synced('Unnamed', { shared: true });

  // Local state — this client only
  showEdit = false;

  // Computed — derived from synced state, no prefix needed
  get percentage() {
    return this.max > 0 ? this.current / this.max : 0;
  }

  get status() {
    if (this.current <= 0) return 'dead';
    if (this.percentage < 0.25) return 'bloodied';
    return 'healthy';
  }

  // Mutations — just mutate properties directly
  damage(amount: number) {
    const absorbed = Math.min(amount, this.temp);
    this.temp -= absorbed;
    this.current = Math.max(0, this.current - (amount - absorbed));
  }

  heal(amount: number) {
    this.current = Math.min(this.max, this.current + amount);
  }

  render() {
    return (
      <div className={`hp-tracker ${this.status}`}>
        <span onClick={() => this.showEdit = !this.showEdit}>
          {this.name}
        </span>
        {this.showEdit && (
          <input
            value={this.name}
            onChange={e => this.name = e.target.value}
          />
        )}
        <HealthBar percent={this.percentage} status={this.status} />
        <span>{this.current}/{this.max} {this.temp > 0 && `(+${this.temp})`}</span>
        {!this.live.isReadOnly && (
          <div>
            <button onClick={() => this.damage(5)}>-5</button>
            <button onClick={() => this.heal(5)}>+5</button>
          </div>
        )}
      </div>
    );
  }
}

export default createComponent(HpTracker);
```

Everything above is a normal Mantle component. Synced fields are just properties. Computed getters derive from them directly. Methods mutate them with plain assignment. The only addition is `live = withLive(this)` and the `synced()` markers.

---

## Property Model

| Declaration | Synced | Persisted | Undo-able | Editable By |
|---|---|---|---|---|
| `synced(default)` | Yes | Yes | Yes | Owner only |
| `synced(default, { shared: true })` | Yes | Yes | Yes | Any editor |
| `synced(default, { undo: false })` | Yes | Yes | No | Owner only |
| `synced(default, { shared: true, undo: false })` | Yes | Yes | No | Any editor |
| `synced.components(Class)` | Yes | Yes | Yes | Owner only |
| `broadcast(fn)` | — | No | No | Any client |
| Plain field (`= value`) | No | No | No | Local client |
| `get` accessor | Derived | — | — | — |

The defaults are right for the common case — no options means owner-only and undo-able. You only add options when you need something different.

### When to use `{ undo: false }`

Most synced state should be undo-able. Use `{ undo: false }` for state that should sync and persist but where undo would feel wrong — turn tracking, round counters, timestamps, or similar bookkeeping:

```tsx
class Board extends Component {
  live = withLive(this);

  name = synced('Game Session', { shared: true });
  trackers = synced.components(HpTracker);

  // Synced but not undo-able — undoing damage shouldn't revert whose turn it is
  round = synced(1, { undo: false });
  turnIndex = synced(0, { undo: false });
  lastModified = synced(0, { undo: false });
}
```

---

## How `withLive(this)` Works

`synced(45)` is a marker — it returns something like `{ __synced: true, default: 45 }`. Same for `synced.components()` and `broadcast()`.

When `withLive(this)` runs, it receives the host component instance. The actual wiring happens across the component initialization timeline:

```
1. new HpTracker()
   → Property initializers run
   → current = { __synced: true, default: 45 }     // marker
   → max = { __synced: true, default: 78 }          // marker
   → live = withLive(this)                           // captures reference

2. _collectBehaviors()
   → Finds withLive behavior
   → Scans host for synced / broadcast / synced.components markers
   → Collects schema
   → Replaces markers with default values: current = 45, max = 78, ...

3. makeComponentObservable()
   → Sees current = 45, max = 78, showEdit = false
   → Makes them all MobX observable as normal
   → Markers are gone — MobX sees plain values

4. onCreate()
   → Behavior's onCreate fires
   → Root mode: creates LoroDoc, sets up bidirectional MobX ↔ Loro sync
   → Child mode: binds to parent's sub-document
```

By step 3, the markers are gone and MobX sees plain values. The Loro binding is layered on top in step 4. The component's MobX observables are the source of truth for rendering; the behavior keeps them in sync with the CRDT document.

### Root vs. Child Mode

The behavior detects its context automatically. When a component is rendered through `<ForLive>`, the framework pre-binds the sub-document connection before the child mounts. The child's `withLive` discovers this binding internally — no props, no configuration, no awareness from the component code.

```
Pre-bound sub-document exists?
  ├── Yes → Child mode: bind to parent's sub-document
  │         No new LoroDoc, no WebSocket, shared UndoManager
  └── No  → Root mode: create LoroDoc, open WebSocket, own UndoManager
```

The same component class works in both contexts. There is literally nothing in the component code that acknowledges the distinction.

### Lifecycle

`withLive` is a Mantle behavior created with `createBehavior()`. It follows the standard behavior lifecycle:

**`onCreate`** — Scans host, builds schema, creates Loro doc or binds to parent's sub-document, wires bidirectional MobX ↔ Loro sync, creates `UndoManager`.

**`onMount`** — In root mode: opens WebSocket to sync server, subscribes to local updates for outbound sync, subscribes to incoming messages for inbound sync. Returns cleanup.

**`onUnmount`** — Handled automatically by Mantle's behavior lifecycle. All Loro subscriptions, the undo manager, and the WebSocket connection are disposed.

---

## Parent-Child Composition

### Declaring Children

The parent uses `synced.components()` with a reference to the child component class:

```tsx
// Board.tsx
import { Component, createComponent } from 'mobx-mantle';
import { withLive, synced, ForLive } from 'mantle-live';
import HpTracker from './HpTracker';

class Board extends Component {
  live = withLive(this);

  name = synced('Game Session', { shared: true });
  trackers = synced.components(HpTracker);

  render() {
    return (
      <div className="board">
        <h2>{this.name}</h2>

        <ForLive each={this.trackers}>
          {(Tracker, entry) => (
            <div>
              <Tracker />
              <button onClick={() => this.trackers.remove(entry.id)}>×</button>
            </div>
          )}
        </ForLive>

        {!this.live.isReadOnly && (
          <button onClick={() => this.trackers.add()}>+ Add Tracker</button>
        )}

        <button onClick={() => this.live.undo()}>Undo</button>
        <button onClick={() => this.live.redo()}>Redo</button>
      </div>
    );
  }
}

export default createComponent(Board);
```

### `ForLive`

`ForLive` renders a synced collection. It hands the render function two arguments: a pre-bound component and the entry data.

```tsx
// Full access to both the component and entry data
<ForLive each={this.trackers}>
  {(Tracker, entry) => (
    <div className={entry.current <= 0 ? 'dead' : ''}>
      <Tracker />
      <button onClick={() => this.trackers.remove(entry.id)}>×</button>
    </div>
  )}
</ForLive>

// Just the component, no entry data needed
<ForLive each={this.trackers}>
  {(Tracker) => <Tracker />}
</ForLive>
```

`Tracker` is the child component class pre-bound to the correct sub-document. Keys are handled internally. The child's `withLive` discovers its binding automatically — no props, no wiring.

### Schema Extraction

`synced.components(HpTracker)` doesn't require the developer to repeat the child's field definitions. At initialization, the framework temporarily instantiates `HpTracker`, scans its properties for a `withLive` behavior, and reads the schema from it.

```tsx
function resolveChildSchema(ComponentClass) {
  const temp = new ComponentClass();
  let liveProperty = null;

  for (const key of Object.keys(temp)) {
    if (isLiveBehavior(temp[key])) {
      if (liveProperty) {
        throw new Error(
          `${ComponentClass.name} has multiple withLive behaviors. ` +
          `synced.components requires exactly one.`
        );
      }
      liveProperty = key;
    }
  }

  if (!liveProperty) {
    throw new Error(
      `${ComponentClass.name} has no withLive behavior. ` +
      `Add "live = withLive(this)" to use it with synced.components.`
    );
  }

  return {
    liveProperty,
    schema: temp[liveProperty].__schema,
  };
}
```

If someone later adds a `notes` field to HpTracker's synced properties, the Board's collection automatically knows about it. The schema is always colocated with the component that uses it — single source of truth.

### Initial Values

`synced.components` takes an optional second argument for initial data:

```tsx
// Starts empty
trackers = synced.components(HpTracker);

// Starts with initial entries
trackers = synced.components(HpTracker, [
  { name: 'Gandalf', current: 85, max: 85 },
  { name: 'Aragorn', current: 120, max: 120 },
  { name: 'Frodo', current: 45, max: 45 },
]);

// Partial values — missing fields use defaults from HpTracker's schema
trackers = synced.components(HpTracker, [
  { name: 'Gandalf' },     // current: 45, max: 78, temp: 0 from defaults
]);
```

### Add and Remove

```tsx
// Add — uses defaults from HpTracker's schema, overridden with provided values
this.trackers.add({ name: 'Frodo', current: 45, max: 45, temp: 0 });
this.trackers.add();  // all defaults

// Remove — deletes from Loro doc, child unmounts naturally
this.trackers.remove(entry.id);

// Reorder (backed by LoroMovableList)
this.trackers.move(fromIndex, toIndex);
```

### Collection API

```tsx
interface SyncedComponents<T> {
  // Read
  length: number;
  map<U>(fn: (entry: LiveEntry<T>, index: number) => U): U[];
  get(id: string): LiveEntry<T> | undefined;
  [Symbol.iterator](): Iterator<LiveEntry<T>>;

  // Mutate (all undo-able)
  add(values?: Partial<T>): LiveEntry<T>;
  remove(id: string): void;
  move(fromIndex: number, toIndex: number): void;
}

interface LiveEntry<T> {
  readonly id: string;
  // All fields from T as observable get/set properties
}
```

### Loro Document Structure

The Loro document tree mirrors the component tree:

```
Board's LoroDoc
  LoroMap("root")
    ├── "name": "Game Session"
    └── "trackers": LoroMovableList
          ├── [0]: LoroMap { id, current, max, temp, name }  → HpTracker A
          ├── [1]: LoroMap { id, current, max, temp, name }  → HpTracker B
          └── [2]: LoroMap { id, current, max, temp, name }  → HpTracker C
```

### Validation

`synced.components` validates at definition time that the referenced class has a `withLive` behavior:

```tsx
class Plain extends Component {
  count = 0;
}

class Board extends Component {
  live = withLive(this);
  items = synced.components(Plain);
  // Error: Plain has no withLive behavior.
  // Add "live = withLive(this)" to use it with synced.components.
}
```

In dev mode, `add()` validates that provided keys match the child's schema.

---

## Undo / Redo

Undo uses LORO's `UndoManager`, not mobx-keystone's `undoMiddleware`. LORO's undo manager understands who made each change and only reverses the current user's operations, preserving everyone else's concurrent edits.

```
User calls this.live.undo()
  → LORO UndoManager reverses the user's CRDT operations
  → Loro-to-MobX binding picks up the change
  → MobX observables update
  → React re-renders
  → Change syncs to other clients as a normal LORO update
```

Undo is scoped to the root. The Board's `withLive` owns the `LoroDoc` and `UndoManager`. When a child HpTracker mutates `this.current`, that write goes into the same Loro doc. Hitting undo on the Board reverses whatever the user last did — whether that was renaming the board, adding a tracker, or dealing damage to a specific tracker. One undo stack for the whole tree.

Properties declared with `{ undo: false }` are excluded from the undo stack. Under the hood, writes to these properties commit with a special origin that the `UndoManager` ignores:

```tsx
// Framework internals
const undoManager = new UndoManager(doc, {
  excludeOriginPrefixes: ['no-undo'],
});

// When writing a { undo: false } property:
doc.setNextCommitOrigin('no-undo');
loroMap.set(key, value);
doc.commit();
```

The behavior exposes:

```tsx
this.live.undo()       // undo last operation
this.live.redo()       // redo
this.live.canUndo      // observable boolean
this.live.canRedo      // observable boolean
```

---

## Permissions

Every `withLive` instance exposes `this.live.isReadOnly`, a boolean indicating whether the current user can modify synced state.

| Property Type | Owner | Editor | Viewer |
|---|---|---|---|
| `synced()` | Read/Write | Read | Read |
| `synced({ shared: true })` | Read/Write | Read/Write | Read |
| `broadcast()` | Send/Receive | Send/Receive | Receive |
| Plain fields | Full | Full | Full |

Permissions are inherited from parent to child. A child HpTracker in a Board's `synced.components` collection inherits its parent's permission context.

---

## Broadcasts

Broadcasts are ephemeral, fire-and-forget events sent to all connected peers. They use the same WebSocket connection as LORO sync.

### Declaration

```tsx
// Simple — no arguments
flashRed = broadcast(() => {
  this.playFlashAnimation();
});

// With arguments — must be serializable
ping = broadcast((x: number, y: number) => {
  this.showPingAt(x, y);
});
```

### Usage

```tsx
// Calling runs the body locally AND sends to all peers
this.flashRed();
this.ping(100, 200);
```

`broadcast()` returns a function marker. `withLive` replaces it with a real function that runs the body locally, serializes the arguments, and sends them over the WebSocket. Incoming broadcast messages from other peers call the same function body on the local instance.

Broadcasts are never persisted and are lost if no clients are listening. They are rate-limited on the server.

---

## Compatibility with Existing Behaviors

After `withLive` does its work, synced properties are standard MobX observables. Any existing behavior that reads or writes observable properties works with synced state without modification.

```tsx
class HpTracker extends Component {
  live = withLive(this);

  current = synced(45);
  max = synced(78);

  // Written for plain MobX — knows nothing about Loro
  autosave = withAutosave(
    () => ({ current: this.current, max: this.max }),
    '/api/backup'
  );

  // Writes flow through to Loro automatically
  clamp = withClamp(this, 'current', 0, 999);
}
```

The layer cake:

```
Behaviors read/write       →  MobX observable
MobX observable            ↔  Loro LoroMap entry (bidirectional binding)
Loro LoroMap               ↔  WebSocket ↔ other peers
Loro LoroMap               →  UndoManager
```

Every layer only talks to its neighbor. Behaviors talk to MobX. MobX talks to Loro. Loro talks to the network. A behavior written for layer 1 doesn't need to know layers 2–4 exist.

This is the key reason synced properties live directly on `this` rather than behind a namespace. If synced state were accessed as `this.live.current`, every existing behavior would need to be adapted. With `synced()` properties on `this`, the boundary is invisible to everything except `withLive` itself.

---

## Standalone vs. Nested

The same component class works in both contexts:

```tsx
// Standalone — root of its own collaboration session
<HpTracker />

// Nested — child rendered through ForLive
<ForLive each={this.trackers}>
  {(Tracker) => <Tracker />}
</ForLive>
```

No code changes. No special props. No awareness from the component. The `withLive` behavior detects its context internally and wires accordingly.

---

## Sync Server

The server is a room-based WebSocket relay. It handles two message types on a single connection:

```
Client A  ──┐                    ┌── Client B
             ├── WebSocket ──→  Server  ←── WebSocket ──┤
Client C  ──┘                    └── Persistence (snapshots)

Messages:
  loro      →  persist + relay to room
  broadcast →  relay to room only, never persist
```

The server does not interpret or transform data. LORO's CRDT semantics handle conflict resolution on every client independently.

| Responsibility | Description |
|---|---|
| Relay LORO updates | Forward CRDT operations between clients, persist to storage |
| Relay broadcasts | Forward ephemeral messages to room, discard after delivery |
| Room management | One room per document ID, track connected clients per room |
| Permission checks | Validate `{ shared: true }` properties |
| Rate limiting | Throttle broadcast messages to prevent spam |

---

## Why Class Instances Make This Possible

The `withLive(this)` pattern relies on capabilities that class instances provide and hooks do not:

**Introspection.** `withLive(this)` walks `Object.keys(this)` to discover synced fields, broadcast markers, and component collections at runtime. Hooks are opaque slots in a linked list — no hook can see what other hooks exist.

**Property replacement.** `synced(45)` places a marker on `this`. The behavior replaces it with a real value before MobX observables are applied. With hooks, `useState(synced(45))` would store the marker as initial state with no way to intercept it.

**Stable identity.** The `this` reference never changes. The Loro binding, WebSocket handler, undo manager, and MobX reactions all hold a reference to the same object for the component's entire lifetime. Hooks close over snapshots that go stale.

**Schema extraction.** `synced.components(HpTracker)` works by doing `new HpTracker()` temporarily and scanning the instance. A function component's shape only exists while it's executing inside React.

**Mutation in place.** When a remote peer changes a value, the behavior writes `this.current = 30`. MobX notifies observers. The render reads the new value. With hooks, `setCurrent(30)` triggers a full re-render that re-runs all hooks and rebuilds all closures.

**Cross-cutting behaviors.** Existing behaviors like `withAutosave` or `withClamp` work with synced properties because they're just MobX observables on a real object. No adaptation needed.

---

## Complete Example

### HpTracker.tsx

```tsx
import { Component, createComponent } from 'mobx-mantle';
import { withLive, synced, broadcast } from 'mantle-live';

class HpTracker extends Component {
  live = withLive(this);

  current = synced(45);
  max = synced(78);
  temp = synced(0);
  name = synced('Unnamed', { shared: true });

  showEdit = false;

  get percentage() {
    return this.max > 0 ? this.current / this.max : 0;
  }

  get status() {
    if (this.current <= 0) return 'dead';
    if (this.percentage < 0.25) return 'bloodied';
    return 'healthy';
  }

  damage(amount: number) {
    const absorbed = Math.min(amount, this.temp);
    this.temp -= absorbed;
    this.current = Math.max(0, this.current - (amount - absorbed));
    this.flashRed();
  }

  heal(amount: number) {
    this.current = Math.min(this.max, this.current + amount);
  }

  flashRed = broadcast(() => {
    this.playFlashAnimation();
  });

  render() {
    return (
      <div className={`hp-tracker ${this.status}`}>
        <span onClick={() => this.showEdit = !this.showEdit}>
          {this.name}
        </span>
        {this.showEdit && (
          <input
            value={this.name}
            onChange={e => this.name = e.target.value}
          />
        )}
        <HealthBar percent={this.percentage} status={this.status} />
        <span>{this.current}/{this.max} {this.temp > 0 && `(+${this.temp})`}</span>
        {!this.live.isReadOnly && (
          <div>
            <button onClick={() => this.damage(5)}>-5</button>
            <button onClick={() => this.heal(5)}>+5</button>
          </div>
        )}
      </div>
    );
  }
}

export default createComponent(HpTracker);
```

### Board.tsx

```tsx
import { Component, createComponent } from 'mobx-mantle';
import { withLive, synced, ForLive } from 'mantle-live';
import HpTracker from './HpTracker';

class Board extends Component {
  live = withLive(this);

  name = synced('Game Session', { shared: true });
  trackers = synced.components(HpTracker, [
    { name: 'Gandalf', current: 85, max: 85 },
    { name: 'Aragorn', current: 120, max: 120 },
    { name: 'Frodo', current: 45, max: 45 },
  ]);

  render() {
    return (
      <div className="board">
        <h2>{this.name}</h2>

        <ForLive each={this.trackers}>
          {(Tracker, entry) => (
            <div>
              <Tracker />
              <button onClick={() => this.trackers.remove(entry.id)}>×</button>
            </div>
          )}
        </ForLive>

        {!this.live.isReadOnly && (
          <button onClick={() => this.trackers.add()}>+ Add Tracker</button>
        )}

        <button onClick={() => this.live.undo()}>Undo</button>
        <button onClick={() => this.live.redo()}>Redo</button>
      </div>
    );
  }
}

export default createComponent(Board);
```

---

## Summary

| Concept | Mechanism |
|---|---|
| Synced state | `synced(default)` marker → replaced by MobX observable → bound to Loro |
| Shared editing | `synced(default, { shared: true })` → open edit permissions |
| No-undo state | `synced(default, { undo: false })` → excluded from undo stack |
| Local state | Plain class field → MobX observable, no sync |
| Computed | `get` accessor → MobX computed, derived from any state |
| Mutations | Direct property assignment → tracked in Loro, undo-able |
| Broadcasts | `broadcast(fn)` → runs locally + sends to all peers |
| Child components | `synced.components(Class)` → schema extracted from child's `withLive` |
| Rendering children | `<ForLive each={...}>` → pre-bound components, automatic wiring |
| Add / Remove | `collection.add()` / `.remove(id)` / `.move(from, to)` |
| Permissions | `this.live.isReadOnly` + `{ shared: true }` option |
| Undo / Redo | LORO `UndoManager`, per-user, one stack per root |
| Existing behaviors | Work unchanged — synced properties are standard MobX observables |
| Sync server | Room-based WebSocket relay, persists LORO snapshots |
| Conflict resolution | LORO CRDTs handle merging automatically |

The developer writes normal Mantle components. Adds `live = withLive(this)`. Marks fields with `synced()`. Mutates state directly. Composes with JSX. Everything else — networking, conflict resolution, persistence, undo, permissions — is handled by the behavior.
