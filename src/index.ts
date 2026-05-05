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
