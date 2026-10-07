import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '**/live.spec.ts', fullyParallel: false, workers: 1, retries: 0,
  // The runner owns its configurable deadline; this outer limit only allows cleanup.
  timeout: 1900000, expect: { timeout: 15000 }, reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results/live',
});
