# Changelog

## 0.7.0

- Add `createView(Model, template)`: a tracked view of the nearest mounted model, for splitting a template across files or handing a library a component that reads model state.
- Add `this.view(render)` on components: a per-instance tracked view with stable identity and ref forwarding. It carries the model's context, so `findParent()` and services resolve inside it even in a React root a library owns.
- Auto-observable mode keeps React components made by `observer()`, `this.view()` or `createView()` by reference instead of converting them.

## 0.6.1

- Built-in behaviors (`mobx-mantle/behaviors`) are observable regardless of the app's `autoObservable` setting, so they work the same in apps with or without decorators.
- `withDebounce` is a true debounce: the value settles after `delay` ms of quiet. It previously used MobX's reaction `delay`, which fires from the first change and batches the rest.
- `@action` works on arrow-function fields as well as methods (`@action handler = () => …`), in both TypeScript decorator modes.
- Docs: the `watch`/`effect` `delay` option is documented as MobX's reaction delay rather than a debounce, and ARCHITECTURE reflects the `manageMobxActions: false` default.

- Rename `withServiceScope()` to `withInjectionScope()` without a compatibility alias; synchronous resolver scoping is unchanged.

- Add imported `inject(Token)` for synchronous construction and `onCreate`, with the same typed tokens and service identity handling as instance injection.
- Rename `this.getService(Token)` to `this.inject(Token)` on Components and Behaviors, with no compatibility alias. `inject` replaces `getService` as the reserved member name.
- Add `configure({ resolveService })` for application-wide service resolution without a JSX provider. Explicit service scopes override the default; existing instances retain their captured resolver.
- Preserve strict test scopes and optional resolver fallbacks, including existing tsyringe service mocks. Imported injection reports a clear error outside a construction scope; use `this.inject()` for later lookups.

## 0.6.0

- Add scoped `ServiceProvider`, typed service tokens, `this.getService()` on models and behaviors, and `withServiceScope()` for synchronous construction outside React. Resolvers retain ownership of service identity and lifetime.
- The `getService` member name is now reserved on Components/Behaviors. Rename an existing application field with that name when upgrading.
- Support Mantle field, action and computed decorators with either TypeScript legacy decorators or TC39 decorators, including inherited components and behaviors.
- Add `mobx-mantle/testing` with test-local service registrations and model substitution. Substituted views use the normal framework runtime without constructing the original model. Separate templates work directly; integrated views require an explicit test template.
- Expose `ModelProvider` and logical `isModel()` identity for construction substitution. `findParent()` recognizes substituted ancestors.
- **Changed default:** `manageMobxActions` is now `false`. Mantle preserves the host's MobX policy. To retain globally permissive actions, call `configure({ manageMobxActions: true })` before the first model or behavior is created.
- Synchronous lifecycle callbacks and built-in async/timer writes use actions. Effect bodies remain tracked; application async continuations still need explicit `runInAction` when required by the host's policy.
- Both ESM and CommonJS secondary package entries share their public core runtime.
