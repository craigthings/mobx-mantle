export {
  // Core classes
  Component,
  ViewModel,
  Behavior,
  
  // Wrappers
  createComponent,
  createBehavior,
  
  // Decorators (for explicit annotation mode)
  observable,
  action,
  computed,
  
  // Config
  configure,
} from './mantle';

export type { MantleConfig, MantleErrorContext, WatchOptions } from './mantle';
