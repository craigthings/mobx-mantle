import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { resetMantleConfig } from './helpers';

// Symbol.metadata is the well-known symbol the TC39 decorator-metadata
// proposal writes class metadata under. Not yet present on all runtimes;
// define it before any decorated class module loads.
if (!(Symbol as any).metadata) {
  Object.defineProperty(Symbol, 'metadata', {
    value: Symbol.for('Symbol.metadata'),
    // configurable so the "metadata absent" decorator test can delete and
    // restore it to exercise the graceful-fallback path.
    configurable: true,
    enumerable: false,
    writable: false,
  });
}

// React 18 act() environment flag — silences "not wrapped in act(...)" noise
// and enables Testing Library's async utilities to flush effects.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  // Files that opt into the node environment have no DOM to clean up.
  if (typeof document !== 'undefined') cleanup();
  resetMantleConfig();
});
