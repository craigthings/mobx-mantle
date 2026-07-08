import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  esbuild: {
    // TC39 decorators + Symbol.metadata (used by src/decorators.ts). esbuild
    // emits the decorator-metadata glue; the setup file polyfills the
    // Symbol.metadata well-known symbol for the runtime.
    target: 'es2022',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.{test,spec}.{ts,tsx}'],
    // Type-level tests are checked by tsc (npm run test:types), not run here.
    typecheck: {
      enabled: false,
    },
    restoreMocks: true,
  },
});
