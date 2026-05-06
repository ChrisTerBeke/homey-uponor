import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.mts'],
    alias: {
      homey: resolve(__dirname, './tests/__mocks__/homey.mts'),
    },
  },
});
