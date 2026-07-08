# Mantle Live — Behavior-Based Architecture v2

A collaborative, real-time layer for Mantle components. Any Mantle component becomes collaborative by adding `live = withLive()` and marking fields with `sync()`. No base class, no inheritance, no rewrites.

---

## Design Principles

The live layer is a **behavior** — a reusable piece of state and logic that attaches to any existing Mantle component. The component owns the UI and local state. The behavior owns the CRDT document, sync connection, and undo history.

Synced properties live directly on `this`, not behind a namespace. After `withLive` does its work, synced properties *are* MobX observables. The Loro binding is a layer underneath — invisible to everything except the behavior itself. Any code that reads or writes `this.current` has no idea there's a network behind it.

This architecture relies on framework enhancements to the Mantle `Component` and `Behavior` classes that formalize the hooks behaviors need for advanced metaprogramming.

---

## API Surface

The entire vocabulary is four imports:

```tsx
import { withLive, sync, broadcast, ForLive } from 'mantle-live';
```

| API | Purpose |
|---|---|
| `withLive()` | Attach the live behavior to a component (child mode) |
| `withLive({ server })` | Attach as root — owns connection and undo stack |
| `sync(default)` | Synced, persisted, undo-able value (owner only) |
| `sync(default, { shared: true })` | Synced value editable by any editor |
| `sync(default, { transient: true })` | Synced value excluded from undo history |
| `sync.components(Class)` | Synced collection of live child components |
| `sync.components(Class, [...])` | Synced collection with initial values |
| `broadcast(fn)` | Ephemeral event sent to all connected peers |
| `<ForLive each={...}>` | Render a synced collection |

---

## Basic Example

```tsx
// HpTracker.tsx
import { Component, createComponent } from 'mobx-mantle';
import { withLive, sync, broadcast } from 'mantle-live';

class HpTracker extends Component {
  live = withLive();

  // Synced state — persisted, collaborative, undo-able
  current = sync(45);
  max = sync(78);
  temp = sync(0);
  name = sync('Unnamed', { shared: true });

  // Local state — this client only
  showEdit = false;

  // Computed — derived from synced state
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
    this.flashRed();
  }

  heal(amount: number) {
    this.current = Math.min(this.max, this.current + amount);
  }

  // Ephemeral broadcast — all peers see the flash
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
        <button onClick={() => this.live.undo()} disabled={!this.live.canUndo}>
          Undo
        </button>
      </div>
    );
  }
}

export default createComponent(HpTracker);
```

Everything above is a normal Mantle component. Synced fields are just properties. Computed getters derive from them directly. Methods mutate them with plain assignment. The only addition is `live = withLive()` and the `sync()` markers.

When used as a root component, pass the server URL: `withLive({ server: 'wss://...' })`. When nested inside another live component via `sync.components()`, it inherits the parent's connection automatically.

---

## Property Model

| Declaration | Synced | Persisted | Undo-able | Editable By |
|---|---|---|---|---|
| `sync(default)` | Yes | Yes | Yes | Owner only |
| `sync(default, { shared: true })` | Yes | Yes | Yes | Any editor |
| `sync(default, { transient: true })` | Yes | Yes | No | Owner only |
| `sync(default, { shared: true, transient: true })` | Yes | Yes | No | Any editor |
| `sync.components(Class)` | Yes | Yes | Yes | Owner only |
| `broadcast(fn)` | — | No | No | Any client |
| Plain field (`= value`) | No | No | No | Local client |
| `get` accessor | Derived | — | — | — |

The defaults are right for the common case — no options means owner-only and undo-able. You only add options when you need something different.

### When to use `{ transient: true }`

Most synced state should be undo-able. Use `{ transient: true }` for state that should sync and persist but where undo would feel wrong — turn tracking, round counters, timestamps, or similar bookkeeping:

```tsx
class Board extends Component {
  // Root component — owns the WebSocket connection
  live = withLive({ server: 'wss://my-app.partykit.dev' });

  name = sync('Game Session', { shared: true });
  trackers = sync.components(HpTracker);

  // Synced but not undo-able — undoing damage shouldn't revert whose turn it is
  round = sync(1, { transient: true });
  turnIndex = sync(0, { transient: true });
  lastModified = sync(0, { transient: true });
}
```

---

## Mantle Framework Enhancements

The `withLive` behavior relies on framework enhancements to Component and Behavior that formalize hooks for advanced metaprogramming.

### Component Tree Awareness

Component gains methods to navigate the component tree:

```tsx
class Component<P = {}> {
  /** Get parent component instance, or null if root */
  getParent<T extends Component = Component>(): T | null;

  /** Get root component instance */
  getRoot<T extends Component = Component>(): T;

  /** Find nearest ancestor of a specific type */
  getAncestor<T extends Component>(Type: new () => T): T | null;
}
```

### Behavior Enhancements

Behavior gains a built-in `host` reference and new lifecycle hooks:

```tsx
class Behavior {
  /** Host component — set by framework before any hooks */
  host!: Component;

  /** 
   * Static schema extraction for external consumers.
   * Called once at createComponent() time.
   */
  static schema?(fields: Map<string, any>): Record<symbol, any>;

  /** 
   * Bind to host. Called before MobX observability.
   * Can examine and transform host fields.
   */
  onBind?(fields: Map<string, any>): Map<string, any> | void;

  /** Initialize behavior with factory arguments */
  onCreate?(...args: any[]): void;

  /** Called synchronously after DOM mount */
  onLayoutMount?(): void | (() => void);

  /** Called after paint */
  onMount?(): void | (() => void);

  /** Called on unmount */
  onUnmount?(): void;
}
```

### Initialization Timeline

```
createComponent(HpTracker) called:
  └── Behavior.schema(fields)        → cache schema for sync.components()

<HpTracker /> rendered:
  ├── Constructor runs, field initializers execute
  │     └── live = withLive()        → behavior created (no this needed!)
  ├── collectBehaviors()             → finds behaviors, sets behavior.host
  ├── behavior.onBind(fields)        → transform sync() markers to values
  ├── makeComponentObservable()      → MobX sees plain values
  ├── behavior.onCreate()            → behavior initialization
  ├── component.onCreate()
  ├── React render
  ├── behavior.onLayoutMount()
  ├── component.onLayoutMount()
  ├── behavior.onMount()
  └── component.onMount()
```

By the time MobX runs, the `sync()` markers are gone — MobX sees plain values. The Loro binding is layered on top during mount.

### WeakMap Internals

Component internals (propsBox, behaviors, watchDisposers) live in a WeakMap keyed by component instance, keeping the component's `this` clean:

```tsx
// No underscore properties on Component
class HpTracker extends Component {
  live = withLive();
  current = sync(45);
  // this.current is just a number
  // this._anything doesn't exist
}
```

---

## How `withLive` Works

### The Behavior Implementation

```tsx
import { Behavior, createBehavior, getComponentSchema } from 'mobx-mantle';
import { LoroDoc, LoroMap, UndoManager } from 'loro-crdt';
import { SyncMarker, BroadcastMarker, ComponentsMarker, LIVE_SCHEMA } from './markers';

interface LiveConfig {
  server?: string;
}

class LiveBehavior extends Behavior {
  private config: LiveConfig = {};
  private schema!: LiveSchema;
  private doc!: LoroDoc;
  private rootMap!: LoroMap;
  private undoManager!: UndoManager;
  private disposers: (() => void)[] = [];
  private ws: WebSocket | null = null;

  // Observable state
  isReadOnly = false;
  isConnected = false;

  // Computed
  get canUndo(): boolean {
    return this.undoManager?.canUndo() ?? false;
  }

  get canRedo(): boolean {
    return this.undoManager?.canRedo() ?? false;
  }

  // ─────────────────────────────────────────────────────────────
  // Static Schema (for sync.components)
  // ─────────────────────────────────────────────────────────────

  static schema(fields: Map<string, any>) {
    return { [LIVE_SCHEMA]: extractLiveSchema(fields) };
  }

  // ─────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────

  onCreate(config: LiveConfig = {}) {
    this.config = config;
  }

  onBind(fields: Map<string, any>) {
    this.schema = extractLiveSchema(fields);

    // Transform markers to real values before MobX
    for (const [key, value] of fields) {
      if (value instanceof SyncMarker) {
        fields.set(key, value.defaultValue);
      } else if (value instanceof BroadcastMarker) {
        fields.set(key, this.wrapBroadcast(key, value.handler));
      } else if (value instanceof ComponentsMarker) {
        fields.set(key, new SyncedCollection(this, key, value));
      }
    }

    return fields;
  }

  onMount() {
    this.initializeDocument();
    this.setupSync();
    return () => this.cleanup();
  }

  // ─────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────

  undo() {
    this.undoManager.undo();
  }

  redo() {
    this.undoManager.redo();
  }

  getSubDocFor(childId: string): LoroMap {
    return this.rootMap.get(childId) as LoroMap;
  }

  // ─────────────────────────────────────────────────────────────
  // Document Initialization
  // ─────────────────────────────────────────────────────────────

  private initializeDocument() {
    const parent = this.host.getParent();
    const parentLive = this.findParentLive(parent);
    const liveId = (this.host.props as any).__liveId;

    if (parentLive && liveId) {
      // Child mode: rendered via ForLive
      this.doc = parentLive.doc;
      this.rootMap = parentLive.getSubDocFor(liveId);
      this.undoManager = parentLive.undoManager;
      this.isReadOnly = parentLive.isReadOnly;
    } else {
      // Root mode: create our own document
      this.doc = new LoroDoc();
      this.rootMap = this.doc.getMap('root');
      this.initializeDefaults();
      this.undoManager = new UndoManager(this.doc, {
        excludeOriginPrefixes: ['transient', 'remote'],
      });
      this.openConnection();
    }
  }

  private findParentLive(parent: Component | null): LiveBehavior | null {
    while (parent) {
      const live = (parent as any).live;
      if (live instanceof LiveBehavior) {
        return live;
      }
      parent = parent.getParent();
    }
    return null;
  }

  private initializeDefaults() {
    for (const [key, field] of Object.entries(this.schema.fields)) {
      if (this.rootMap.get(key) === undefined) {
        this.rootMap.set(key, field.default);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Bidirectional Sync
  // ─────────────────────────────────────────────────────────────

  private setupSync() {
    // MobX → Loro
    for (const [key, field] of Object.entries(this.schema.fields)) {
      const dispose = reaction(
        () => (this.host as any)[key],
        (value) => {
          if (this.rootMap.get(key) === value) return;
          
          if (field.transient) {
            this.doc.setNextCommitOrigin('transient');
          }
          
          this.rootMap.set(key, value);
          this.doc.commit();
        }
      );
      this.disposers.push(dispose);
    }

    // Loro → MobX
    const unsubscribe = this.doc.subscribe((event) => {
      if (event.origin === 'local') return;
      
      runInAction(() => {
        for (const key of Object.keys(this.schema.fields)) {
          const loroValue = this.rootMap.get(key);
          if ((this.host as any)[key] !== loroValue) {
            (this.host as any)[key] = loroValue;
          }
        }
      });
    });
    this.disposers.push(unsubscribe);
  }

  // ─────────────────────────────────────────────────────────────
  // Broadcasts
  // ─────────────────────────────────────────────────────────────

  private broadcastHandlers = new Map<string, Function>();

  private wrapBroadcast(key: string, handler: Function): Function {
    // Store raw handler for incoming broadcasts
    this.broadcastHandlers.set(key, handler);

    // Return wrapped function that sends to peers
    return (...args: any[]) => {
      handler.apply(this.host, args);
      
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'broadcast', key, args }));
      }
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Connection
  // ─────────────────────────────────────────────────────────────

  private openConnection() {
    const server = this.config.server ?? 'ws://localhost:1999';
    const docId = (this.host.props as any).docId ?? crypto.randomUUID();
    this.ws = new WebSocket(`${server}/parties/main/${docId}`);
    
    this.ws.onopen = () => {
      runInAction(() => { this.isConnected = true; });
      this.ws!.send(this.doc.export({ mode: 'snapshot' }));
    };
    
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'loro') {
        this.doc.import(data.payload, 'remote');
      } else if (data.type === 'broadcast') {
        // Call raw handler directly — don't re-broadcast
        const handler = this.broadcastHandlers.get(data.key);
        if (handler) {
          handler.apply(this.host, data.args);
        }
      }
    };
    
    this.ws.onclose = () => {
      runInAction(() => { this.isConnected = false; });
    };
  }

  private cleanup() {
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
    this.ws?.close();
    this.ws = null;
  }
}

export const withLive = createBehavior(LiveBehavior);
```

### Schema Extraction Helper

```tsx
function extractLiveSchema(fields: Map<string, any>): LiveSchema {
  const schema: LiveSchema = { fields: {}, broadcasts: {}, collections: {} };

  for (const [key, value] of fields) {
    if (value instanceof SyncMarker) {
      schema.fields[key] = {
        default: value.defaultValue,
        shared: value.options.shared ?? false,
        transient: value.options.transient ?? false,
      };
    } else if (value instanceof BroadcastMarker) {
      schema.broadcasts[key] = true;
    } else if (value instanceof ComponentsMarker) {
      const childSchema = getComponentSchema(value.componentClass)?.[LIVE_SCHEMA];
      if (!childSchema) {
        throw new Error(
          `${value.componentClass.name} has no withLive behavior. ` +
          `Add "live = withLive()" to use it with sync.components.`
        );
      }
      schema.collections[key] = {
        componentClass: value.componentClass,
        childSchema,
      };
    }
  }

  return schema;
}
```

### Root vs. Child Mode

The behavior detects its context using `this.host.getParent()`:

```
Parent component exists with live behavior + __liveId prop?
  ├── Yes → Child mode: bind to parent's sub-document
  │         Shares LoroDoc, shares UndoManager, inherits permissions
  └── No  → Root mode: create LoroDoc, open WebSocket, own UndoManager
```

The same component class works in both contexts. There is nothing in the component code that acknowledges the distinction.

---

## Parent-Child Composition

### Declaring Children

```tsx
// Board.tsx
import { Component, createComponent } from 'mobx-mantle';
import { withLive, sync, ForLive } from 'mantle-live';
import HpTracker from './HpTracker';

class Board extends Component {
  // Root — owns connection, passes server URL
  live = withLive({ server: 'wss://my-app.partykit.dev' });

  name = sync('Game Session', { shared: true });
  trackers = sync.components(HpTracker, [
    { name: 'Gandalf', current: 85, max: 85 },
    { name: 'Aragorn', current: 120, max: 120 },
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

        <button onClick={() => this.live.undo()} disabled={!this.live.canUndo}>
          Undo
        </button>
        <button onClick={() => this.live.redo()} disabled={!this.live.canRedo}>
          Redo
        </button>
      </div>
    );
  }
}

export default createComponent(Board);
```

### `ForLive`

`ForLive` renders a synced collection. It hands the render function two arguments: a pre-bound component and the entry data.

```tsx
<ForLive each={this.trackers}>
  {(Tracker, entry) => (
    <div className={entry.current <= 0 ? 'dead' : ''}>
      <Tracker />
      <button onClick={() => this.trackers.remove(entry.id)}>×</button>
    </div>
  )}
</ForLive>
```

`Tracker` is the child component class pre-bound to the correct sub-document. Keys are handled internally. The child's `withLive` discovers its binding via `getParent()` and the `__liveId` prop.

### Schema Extraction

`sync.components(HpTracker)` reads the child's schema from the static cache:

```tsx
sync.components = function<T extends Component>(
  ComponentClass: new () => T,
  initial?: Partial<T>[]
) {
  const schema = getComponentSchema(ComponentClass)?.[LIVE_SCHEMA];
  if (!schema) {
    throw new Error(
      `${ComponentClass.name} has no withLive behavior. ` +
      `Add "live = withLive()" to use it with sync.components.`
    );
  }
  return new ComponentsMarker(ComponentClass, schema, initial);
};
```

The schema was cached when `createComponent(HpTracker)` ran, via the static `Behavior.schema()` method. No dummy instantiation at runtime.

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

---

## Undo / Redo

Undo uses Loro's `UndoManager`, not mobx-keystone's `undoMiddleware`. Loro's undo manager understands who made each change and only reverses the current user's operations, preserving everyone else's concurrent edits.

```
User calls this.live.undo()
  → Loro UndoManager reverses the user's CRDT operations
  → Loro-to-MobX binding picks up the change
  → MobX observables update
  → React re-renders
  → Change syncs to other clients as a normal Loro update
```

Undo is scoped to the root. The Board's `withLive` owns the `LoroDoc` and `UndoManager`. When a child HpTracker mutates `this.current`, that write goes into the same Loro doc. Hitting undo on the Board reverses whatever the user last did — whether that was renaming the board, adding a tracker, or dealing damage to a specific tracker. One undo stack for the whole tree.

Properties declared with `{ transient: true }` are excluded from the undo stack:

```tsx
// Framework internals
const undoManager = new UndoManager(doc, {
  excludeOriginPrefixes: ['transient', 'remote'],
});

// When writing a { transient: true } property:
doc.setNextCommitOrigin('transient');
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
| `sync()` | Read/Write | Read | Read |
| `sync({ shared: true })` | Read/Write | Read/Write | Read |
| `broadcast()` | Send/Receive | Send/Receive | Receive |
| Plain fields | Full | Full | Full |

Permissions are inherited from parent to child. A child HpTracker in a Board's `sync.components` collection inherits its parent's permission context.

---

## Broadcasts

Broadcasts are ephemeral, fire-and-forget events sent to all connected peers. They use the same WebSocket connection as Loro sync.

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

`broadcast()` returns a function marker. `onBind` replaces it with a real function that runs the body locally, serializes the arguments, and sends them over the WebSocket. Incoming broadcast messages from other peers call the same function body on the local instance.

Broadcasts are never persisted and are lost if no clients are listening.

---

## Marker Classes

Markers are class instances for reliable detection:

```tsx
// src/markers.ts
export abstract class Marker<T = unknown> {
  constructor(public readonly defaultValue: T) {}
}

export class SyncMarker<T> extends Marker<T> {
  constructor(
    defaultValue: T,
    public readonly options: { shared?: boolean; transient?: boolean } = {}
  ) {
    super(defaultValue);
  }
}

export class BroadcastMarker extends Marker<Function> {
  constructor(public readonly handler: Function) {
    super(handler);
  }
}

export class ComponentsMarker<T> extends Marker<T[]> {
  constructor(
    public readonly componentClass: new () => any,
    public readonly childSchema: LiveSchema,
    defaultValue: T[] = []
  ) {
    super(defaultValue);
  }
}

// Type-safe detection
export function isSyncMarker(value: unknown): value is SyncMarker<unknown> {
  return value instanceof SyncMarker;
}
```

The public API:

```tsx
export function sync<T>(
  defaultValue: T, 
  options?: { shared?: boolean; transient?: boolean }
): T {
  return new SyncMarker(defaultValue, options) as unknown as T;
}

export function broadcast<F extends (...args: any[]) => void>(fn: F): F {
  return new BroadcastMarker(fn) as unknown as F;
}

sync.components = function<T extends Component>(
  ComponentClass: new () => T,
  initial?: Partial<T>[]
): SyncedComponents<T> {
  const schema = getComponentSchema(ComponentClass)?.[LIVE_SCHEMA];
  if (!schema) {
    throw new Error(`${ComponentClass.name} has no withLive behavior.`);
  }
  return new ComponentsMarker(ComponentClass, schema, initial) as unknown as SyncedComponents<T>;
};
```

---

## Compatibility with Existing Behaviors

After `withLive` does its work, synced properties are standard MobX observables. Any existing behavior that reads or writes observable properties works with synced state without modification.

```tsx
class HpTracker extends Component {
  live = withLive();

  current = sync(45);
  max = sync(78);

  // Written for plain MobX — knows nothing about Loro
  autosave = withAutosave('/api/backup');

  // Writes flow through to Loro automatically
  clamp = withClamp('current', 0, 999);
}
```

The layer cake:

```
Behaviors read/write       →  MobX observable
MobX observable            ↔  Loro LoroMap entry (bidirectional binding)
Loro LoroMap               ↔  WebSocket ↔ other peers
Loro LoroMap               →  UndoManager
```

Every layer only talks to its neighbor. Behaviors talk to MobX. MobX talks to Loro. Loro talks to the network.

---

## Server

The server is a pure relay — it doesn't parse messages, run Loro, or manage state. Loro handles CRDT merge on each client; the server just forwards bytes between peers in the same room.

### PartyKit (Recommended)

PartyKit runs on Cloudflare's edge network with zero configuration:

```typescript
// party/index.ts
import type * as Party from "partykit/server";

export default class MantleRelay implements Party.Server {
  constructor(readonly room: Party.Room) {}

  onMessage(message: string, sender: Party.Connection) {
    // Relay to all peers except sender
    this.room.broadcast(message, [sender.id]);
  }
}
```

**Setup:**

```bash
npm create partykit@latest mantle-sync
cd mantle-sync
# Replace party/index.ts with the code above
npx partykit deploy
```

You get a URL like `wss://mantle-sync.YOUR_USERNAME.partykit.dev`. Pass it to your root component:

```tsx
live = withLive({ server: 'wss://mantle-sync.you.partykit.dev' });
```

**Local development:**

```bash
npx partykit dev
# Runs on ws://localhost:1999
```

The default server URL (`ws://localhost:1999`) works out of the box for local dev. Only production needs the explicit config.

### How It Works

The relay doesn't distinguish between message types. Both Loro CRDT updates and broadcast events flow through the same pipe:

```
Client A: {"type":"loro","payload":[...]}     → Server → Client B, C, D
Client A: {"type":"broadcast","key":"ping"}   → Server → Client B, C, D
```

Loro merges happen client-side. Broadcast handlers fire client-side. The server is stateless — if all clients disconnect, the room is gone. First client to reconnect becomes the source of truth for late joiners via Loro's snapshot exchange.

---

## Complete Example

### HpTracker.tsx

```tsx
import { Component, createComponent } from 'mobx-mantle';
import { withLive, sync, broadcast } from 'mantle-live';

class HpTracker extends Component {
  // Child component — inherits connection from parent
  live = withLive();

  current = sync(45);
  max = sync(78);
  temp = sync(0);
  name = sync('Unnamed', { shared: true });

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
import { withLive, sync, ForLive } from 'mantle-live';
import HpTracker from './HpTracker';

class Board extends Component {
  // Root component — owns the connection
  live = withLive({ server: 'wss://my-app.partykit.dev' });

  name = sync('Game Session', { shared: true });
  trackers = sync.components(HpTracker, [
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

        <button onClick={() => this.live.undo()} disabled={!this.live.canUndo}>
          Undo
        </button>
        <button onClick={() => this.live.redo()} disabled={!this.live.canRedo}>
          Redo
        </button>
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
| Synced state | `sync(default)` marker → transformed in `onBind` → MobX observable → bound to Loro |
| Shared editing | `sync(default, { shared: true })` → open edit permissions |
| Transient state | `sync(default, { transient: true })` → excluded from undo stack |
| Local state | Plain class field → MobX observable, no sync |
| Computed | `get` accessor → MobX computed, derived from any state |
| Mutations | Direct property assignment → tracked in Loro, undo-able |
| Broadcasts | `broadcast(fn)` → runs locally + sends to all peers |
| Child components | `sync.components(Class)` → schema from static `Behavior.schema()` |
| Rendering children | `<ForLive each={...}>` → pre-bound components, automatic wiring |
| Parent discovery | `this.host.getParent()` → walk component tree |
| Add / Remove | `collection.add()` / `.remove(id)` / `.move(from, to)` |
| Permissions | `this.live.isReadOnly` + `{ shared: true }` option |
| Undo / Redo | Loro `UndoManager`, per-user, one stack per root |
| Server config | `withLive({ server })` on root → children inherit automatically |
| Existing behaviors | Work unchanged — synced properties are standard MobX observables |

---

## Mantle Framework Requirements

| Enhancement | Purpose |
|---|---|
| `Component.getParent()` | Navigate component tree |
| `Component.getRoot()` | Find root component |
| `Behavior.host` | Built-in host reference |
| `Behavior.onBind(fields)` | Transform fields before MobX |
| `static Behavior.schema(fields)` | Cache schema at definition time |
| WeakMap internals | Clean component instance |
| Static schema caching | Enable `sync.components()` without runtime instantiation |
| Delayed `onCreate` | Call after `host` is set |

The developer writes normal Mantle components. Adds `live = withLive()`. Marks fields with `sync()`. Mutates state directly. Composes with JSX. Everything else — networking, conflict resolution, persistence, undo, permissions — is handled by the behavior.
