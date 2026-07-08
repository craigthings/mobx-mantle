import { configure as mobxConfigure } from 'mobx';

/** Options for the watch method */
export interface WatchOptions {
  /** Debounce the callback by N milliseconds */
  delay?: number;
  /** Run callback immediately with current value */
  fireImmediately?: boolean;
}

/** Options for the effect method */
export interface EffectOptions {
  /** Debounce the effect by N milliseconds */
  delay?: number;
}

/**
 * Error context passed to the onError handler
 */
export interface MantleErrorContext {
  /** The lifecycle phase where the error occurred */
  phase: 'onLayoutMount' | 'onMount' | 'onUpdate' | 'onUnmount' | 'watch' | 'effect';
  /** The Component or Behavior class name */
  name: string;
  /** Whether the error came from a Behavior (true) or a Component (false) */
  isBehavior: boolean;
}

/**
 * Global configuration options for mobx-mantle
 */
export interface MantleConfig {
  /** Whether to automatically make Component/Behavior instances observable (default: true) */
  autoObservable?: boolean;
  /**
   * Cache per-class prototype annotation data (getters, methods) so repeated
   * instantiations of the same class skip the prototype walk (default: true).
   * Turn off only if a class's prototype is mutated between instantiations.
   */
  cacheAnnotations?: boolean;
  /** Global error handler for lifecycle errors. Defaults to console.error. */
  onError?: (error: unknown, context: MantleErrorContext) => void;
  /**
   * Whether Mantle sets MobX's `enforceActions` to `'never'` (default: true).
   *
   * MobX's default (`enforceActions: "observed"`) warns whenever observed
   * state is mutated outside an action — which includes every async
   * continuation (`this.value = x` after an `await`) and watch callback.
   * Mantle's method binding already batches synchronous mutations, so the
   * remaining warnings are noise for the patterns Mantle encourages.
   *
   * Set to false if your app runs deliberate strict-mode MobX stores; you
   * are then responsible for your own `enforceActions` setting. Must be set
   * (via configure) before the first component or behavior is created.
   */
  manageMobxActions?: boolean;
}

export const globalConfig: MantleConfig = {
  autoObservable: true,
  cacheAnnotations: true,
  manageMobxActions: true,
};

let actionPolicyApplied = false;

/**
 * @internal Apply the MobX action policy once, lazily at the first
 * component/behavior instantiation. Lazy (rather than at import) so an app
 * can opt out with configure({ manageMobxActions: false }) during startup,
 * regardless of module import order.
 */
export function applyMobxActionPolicy(): void {
  if (actionPolicyApplied) return;
  actionPolicyApplied = true;
  if (globalConfig.manageMobxActions !== false) {
    mobxConfigure({ enforceActions: 'never' });
  }
}

/** @internal Report a lifecycle error through the configured handler or console.error */
export function reportError(error: unknown, context: MantleErrorContext): void {
  if (globalConfig.onError) {
    globalConfig.onError(error, context);
  } else {
    console.error(
      `[mobx-mantle] Error in ${context.isBehavior ? 'behavior' : 'component'} ${context.name}.${context.phase}():`,
      error,
    );
  }
}

/**
 * Configure global defaults for mobx-mantle.
 * Settings can still be overridden per-component in createComponent options.
 */
export function configure(config: MantleConfig): void {
  Object.assign(globalConfig, config);
}
