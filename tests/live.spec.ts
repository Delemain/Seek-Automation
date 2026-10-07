import { test, expect } from '@playwright/test';
import { loadConfig } from '../src/config.js';
import { runWorkflow } from '../src/reporting.js';
test('one explicitly configured approved SEEK application', async ({}, testInfo) => {
  if (!process.env.SEEK_CONFIG) throw new Error('Set SEEK_CONFIG to a complete local config. Live tests are never included in npm test.');
  const loaded = await loadConfig(process.env.SEEK_CONFIG);
  if (loaded.config.environment !== 'production') throw new Error('Live tests require production configuration.');
  const result = await runWorkflow(loaded, 'apply', (name, action) => test.step(name, action));
  await testInfo.attach('result', { path: result.artifacts.result, contentType: 'application/json' });
  expect(result.exitCode, `${result.code}: ${result.message}`).toBe(0);
});
