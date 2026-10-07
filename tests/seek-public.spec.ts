import { test } from '@playwright/test';
import { verifyPublicJob } from '../src/pages/seek-public-page.js';

test('live SEEK listing has the designated job, employer, location and application link', async ({ page }) => {
  await test.step('Read and verify the real public job page without applying', () => verifyPublicJob(page));
});
