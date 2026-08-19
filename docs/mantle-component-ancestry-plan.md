# Mantle Component Ancestry Plan

## Status

Implemented and verified on 2026-08-19.

## Goal

Give every Mantle component automatic access to its nearest rendered Mantle ancestor while preserving ordinary JSX and Mantle's existing public rendering model.

This is a general Mantle runtime capability. Studio will use it to discover live design-surface ancestry, but the API should remain useful for forms, lists, navigation, controllers, and other behavior-oriented systems.

## Public API

Add a small, read-only ancestry API to `Component`:

```ts
export type ComponentConstructor<C extends Component = Component> =
  abstract new (...args: any[]) => C

export class Component<P = {}> {
  getParent(): Component | undefined

  findParent<C extends Component>(
    type: ComponentConstructor<C>,
  ): C | undefined

  getParents(): readonly Component[]

  getRoot(): Component
}
```

Semantics:

- `getParent()` returns the nearest ancestor in the live Mantle view tree.
- `findParent()` starts at the parent and returns the nearest matching parent.
- `getParents()` returns a readonly array ordered from the immediate parent toward the root.
- `getRoot()` returns the highest Mantle ancestor, or `this` for a root.
- Plain React wrappers and fragments are transparent.
- React portals preserve logical Mantle ancestry even when their DOM is rendered elsewhere.
- Separate React roots remain separate Mantle trees.
- A component constructed directly outside `createComponent()` has no automatic parent.
- Ancestry is runtime-only, read-only, non-observable, non-enumerable, and never serialized.

Predicate, behavior, and capability searches are natural future additions, for example `findAncestorWhere()` or `findAncestorProviding()`. They are not required for the first API.

## Public compatibility

The feature is additive:

- Existing JSX remains unchanged.
- `createComponent()` and `createForwardRef()` signatures remain unchanged.
- Existing component constructors require no new argument.
- No DOM wrapper is introduced.
- Props, refs, MobX tracking, behavior collection, and public lifecycle ordering remain unchanged.
- The internal React tree gains only a private Context Provider with a stable value.

## Internal model

Use an internal React Context to carry a private component handle through the logical React tree. React is only the transport; the public API remains class-based.

The handle should be stable for the lifetime of a Mantle React wrapper:

```ts
interface ComponentHandle {
  current: Component | undefined
}
```

Each wrapper provides its own handle to descendants. When HMR replaces its model instance, Mantle updates `handle.current`; descendants can then resolve the replacement without retaining a stale parent instance.

Store each component's parent handle in a private `WeakMap`:

```ts
const componentParents = new WeakMap<Component, ComponentHandle | undefined>()
```

`getParent()` resolves the current instance from that handle. Nothing is added to the component's enumerable or observable state.

## Construction-time availability

The parent must be available during derived class-field initialization and component `onCreate()`. A behavior created as a class field can read ancestry through its already-parented host; the behavior itself does not receive its own ancestry API. Do this without changing constructor signatures or temporarily mutating `Component.prototype`.

Use a targeted, synchronous construction scope:

```text
Parent Mantle wrapper has its model handle
→ provides that handle through internal Context
→ child wrapper reads the parent handle
→ opens a targeted construction scope
→ constructs the child model
→ Component base constructor consumes the scope
→ stores the parent handle in the WeakMap
→ derived child fields initialize with ancestry available
→ construction scope closes in finally
→ behaviors are collected
→ MobX observability is prepared
→ component.onCreate() runs
→ child renders and provides its own stable handle
```

Construction scopes must be:

- protected with `try/finally`;
- scoped to the expected component class;
- consumed once by the intended base constructor;
- safe when constructors create other objects or throw;
- unable to leak ancestry between separate roots or later constructions.

After construction, the wrapper refreshes the component's parent handle on every render. This covers genuine reparenting while preserving the construction-time relationship.

## HMR and lifecycle behavior

- When a parent model is replaced by HMR, its stable handle points to the replacement.
- A surviving child resolves the new parent through the same handle.
- When a child model is replaced, its constructor receives the current parent handle.
- Strict Mode remounts do not create duplicate ancestry state.
- WeakMap entries require no explicit teardown and disappear with their component instances.
- Components should call `getParent()` or `findParent()` when needed rather than permanently caching a parent instance in `onCreate()`.
- The internal Provider value remains stable during ordinary renders, avoiding ancestry-driven descendant updates.

## Studio usage

Mantle exposes only live class ancestry. It does not own Studio's design tree or stable design identity.

`withDesignSurface()` will walk `getParent()` until it finds the nearest Mantle ancestor that also exposes a design surface. Studio then registers stable IDs:

```text
Mantle parent ancestry
→ nearest parent design surface
→ surfaceId + parentSurfaceId + mountId registration
→ Studio derives children and breadcrumbs by ID
```

Parent class references remain disposable runtime information. Studio IDs remain authoritative for selection, overrides, HMR reconnection, and mobx-keystone state.

## Implementation steps

1. Add the private Context, stable component handle, WeakMap, and targeted construction scope.
2. Wire ancestry into `createComponent()` before model construction and refresh it on later renders.
3. Wrap rendered output in the private Provider without adding DOM.
4. Add `getParent()`, `findParent()`, `getParents()`, and `getRoot()` to `Component`.
5. Ensure `createForwardRef()` receives the behavior through its existing delegation to `createComponent()`.
6. Document the runtime-only semantics and examples.
7. Run the complete existing Mantle test suite in addition to the ancestry tests.

## Required tests

### Tree semantics

- Root, parent, grandparent, and missing-ancestor cases.
- Correct order from `getParents()` and correct `getRoot()` value.
- Multiple children receive the same parent without sharing child state.
- Separate React roots never share ancestry.

### React composition

- Plain React wrappers and fragments are transparent.
- Components passed through `props.children` receive the rendered Mantle parent.
- Portals retain logical ancestry while DOM ancestry differs.
- Conditional rendering and genuine reparenting update the relationship.

### Construction and lifecycle

- Ancestry is available in derived class-field initialization.
- Ancestry is available in component `onCreate()`.
- A behavior created as a class field can read ancestry through its host during initialization.
- Constructor failure closes the construction scope and cannot affect the next component.
- Nested or manual construction cannot accidentally consume another component's scope.
- Strict Mode, unmount/remount, SSR, and hydration remain safe.

### HMR and compatibility

- Parent replacement updates surviving descendants through the stable handle.
- Child replacement receives the current parent during construction.
- Existing refs and rendered markup are unchanged.
- No additional DOM node appears.
- Ancestry is not observable, enumerable, or serializable.
- Type tests cover correct `findParent()` subclass inference.
- Existing Mantle behavior, props, observer, and lifecycle tests continue to pass.

## Acceptance criteria

The work is complete when an unchanged Mantle component can render another unchanged Mantle component with ordinary JSX, the child can reliably access its logical Mantle ancestry during field initialization and `onCreate()`, ancestry remains correct through wrappers, portals, reparenting, and HMR, and rendered DOM and existing component behavior remain unchanged.
