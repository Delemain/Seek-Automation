import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testIgnore: ['**/live.spec.ts', '**/seek-public.spec.ts'], fullyParallel: false, workers: 1, retries: 0,
  timeout: 60000, expect: { timeout: 3000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  // The shared runner starts tracing before navigation and retains its own evidence.
  use: { headless: true, trace: 'off', screenshot: 'off',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined } },
});
