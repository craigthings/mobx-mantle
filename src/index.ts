export {
  // Core classes
  View,
  ViewModel,
  Behavior,
  
  // Wrappers
  createView,
  createBehavior,
  
  // Decorators (for explicit annotation mode)
  observable,
  action,
  computed,
  
  // Config
  configure,
} from './mantle';

export type { MantleConfig, MantleErrorContext, WatchOptions } from './mantle';
