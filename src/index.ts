export {
  // Core classes
  Component,
  ViewModel,
  Behavior,

  // Wrappers
  createComponent,
  createForwardRef,
  createBehavior,

  // Decorators (for explicit annotation mode)
  observable,
  action,
  computed,

  // Config
  configure,
} from './mantle';

export type {
  ComponentConstructor,
  MantleConfig,
  MantleErrorContext,
  WatchOptions,
  MantleComponent,
  ForwardRefMantleComponent,
} from './mantle';

// Hosting behaviors in plain function components
export { useBehavior } from './useBehavior';
export { observer } from './observer';

// Reactive behavior arguments (value-or-getter convention)
export { toValue, type MaybeGetter } from './reactive-args';

// Stores shared across every window of one application
export { shared, shareStores, unshare, type SharedOptions, type ShareStoresOptions } from './shared';
