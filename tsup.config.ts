import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'behaviors/index': 'src/behaviors/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  // Share chunks between the main and behaviors entries (ESM) so both use
  // one copy of the behavior machinery. CJS cannot split; the behavior
  // marker uses Symbol.for so detection still works across copies.
  splitting: true,
  external: ['react', 'mobx'],
});
