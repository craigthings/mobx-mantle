import { StrictMode, type ReactElement } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { observable, onBecomeObserved, onBecomeUnobserved, runInAction } from 'mobx';
import { configure, type MantleErrorContext } from '../src';

/**
 * A promise you resolve/reject by hand — for driving async behavior timing
 * (withAsync, withFetch) deterministically from a test.
 */
export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let queued microtasks (awaited continuations) drain. */
export function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

/** Render inside <StrictMode> so mount effects run the mount→unmount→remount cycle. */
export function renderStrict(ui: ReactElement): RenderResult {
  return render(<StrictMode>{ui}</StrictMode>);
}

export interface CapturedError {
  error: unknown;
  context: MantleErrorContext;
}

/**
 * Route Mantle lifecycle errors into an array instead of console.error.
 * Reset by resetMantleConfig() in the global afterEach.
 */
export function captureErrors(): CapturedError[] {
  const errors: CapturedError[] = [];
  configure({ onError: (error, context) => errors.push({ error, context }) });
  return errors;
}

/** Restore Mantle global config to its shipped defaults between tests. */
export function resetMantleConfig(): void {
  configure({
    autoObservable: true,
    cacheAnnotations: true,
    manageMobxActions: true,
    onError: undefined,
  });
}

/**
 * A sentinel observable plus a live `observed` flag, maintained through
 * MobX's public onBecomeObserved/onBecomeUnobserved hooks. Read `probe.get()`
 * inside a watch/effect/render; `probe.observed` then reports whether that
 * reaction is currently live and tracking — the public-API way to assert a
 * reaction was created and later disposed (leak tests).
 */
export function observationProbe() {
  const box = observable.box(0);
  const state = { observed: false };
  onBecomeObserved(box, () => {
    state.observed = true;
  });
  onBecomeUnobserved(box, () => {
    state.observed = false;
  });
  return {
    get: () => box.get(),
    bump: () => runInAction(() => box.set(box.get() + 1)),
    get observed() {
      return state.observed;
    },
  };
}
