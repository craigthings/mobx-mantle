/** Options for the watch method */
export interface WatchOptions {
  /** Debounce the callback by N milliseconds */
  delay?: number;
  /** Run callback immediately with current value */
  fireImmediately?: boolean;
}

/**
 * Error context passed to the onError handler
 */
export interface MantleErrorContext {
  /** The lifecycle phase where the error occurred */
  phase: 'onLayoutMount' | 'onMount' | 'onUpdate' | 'onUnmount' | 'watch';
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
  /** Global error handler for lifecycle errors. Defaults to console.error. */
  onError?: (error: unknown, context: MantleErrorContext) => void;
}

export const globalConfig: MantleConfig = {
  autoObservable: true,
};

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
