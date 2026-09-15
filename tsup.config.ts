import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'testing/index': 'src/testing/index.tsx',
    'behaviors/index': 'src/behaviors/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  // Secondary entries import the external public core in both module formats.
  // No duplicated service/provider/model-construction state in their bundles.
  splitting: true,
  external: ['react', 'mobx', 'mobx-mantle'],
});
