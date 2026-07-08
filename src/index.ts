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

export type { MantleConfig, MantleErrorContext, WatchOptions, MantleComponent, ForwardRefMantleComponent } from './mantle';

// Hosting behaviors in plain function components
export { useBehavior } from './useBehavior';
export { observer } from './observer';

// Reactive behavior arguments (value-or-getter convention)
export { resolve, type MaybeGetter } from './reactive-args';
