import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: '**/seek-public.spec.ts',
  fullyParallel: false, workers: 1, retries: 0,
  timeout: 60000, expect: { timeout: 15000 },
  reporter: [['list'], ['html', { outputFolder: 'artifacts/public-report', open: 'never' }]],
  outputDir: 'artifacts/public-test-results',
  use: {
    headless: true, trace: 'retain-on-failure', screenshot: 'only-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined },
  },
});
