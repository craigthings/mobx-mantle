# Changelog

## 0.6.0

- Add scoped `ServiceProvider`, typed service tokens, `this.getService()` on models and behaviors, and `withServiceScope()` for synchronous construction outside React. Resolvers retain ownership of service identity and lifetime.
- The `getService` member name is now reserved on Components/Behaviors. Rename an existing application field with that name when upgrading.
- Support Mantle field, action and computed decorators with either TypeScript legacy decorators or TC39 decorators, including inherited components and behaviors.
- Add `mobx-mantle/testing` with test-local service registrations and model substitution. Substituted views use the normal framework runtime without constructing the original model. Separate templates work directly; integrated views require an explicit test template.
- Expose `ModelProvider` and logical `isModel()` identity for construction substitution. `findParent()` recognizes substituted ancestors.
- **Changed default:** `manageMobxActions` is now `false`. Mantle preserves the host's MobX policy. To retain globally permissive actions, call `configure({ manageMobxActions: true })` before the first model or behavior is created.
- Synchronous lifecycle callbacks and built-in async/timer writes use actions. Effect bodies remain tracked; application async continuations still need explicit `runInAction` when required by the host's policy.
- Both ESM and CommonJS secondary package entries share their public core runtime.
