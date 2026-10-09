import { expect, test } from '@playwright/test';
import path from 'node:path';
import { hasExplicitAppliedMarker, loadBatchAdapter } from '../../src/batch.js';

test('batch discovery skips only an explicit Applied marker', () => {
  expect(hasExplicitAppliedMarker('AI Engineer - Applied')).toBe(true);
  expect(hasExplicitAppliedMarker('AI Engineer\nSubmit an application today')).toBe(false);
});

test('observed batch adapter includes title and employer card mappings', async () => {
  const adapter = await loadBatchAdapter(path.resolve('config/seek.batch.prepare.candidate.json'));
  expect(adapter.kind).toBe('observed');
  expect(adapter.search.cardTitle).toBeTruthy();
  expect(adapter.search.cardEmployer).toBeTruthy();
  expect(adapter.review.identity.targetPreviouslyVerified).toBe(true);
});
