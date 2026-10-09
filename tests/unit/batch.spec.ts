import { expect, test } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { hasExplicitAppliedMarker, loadBatchAdapter } from '../../src/batch.js';
import { RunHistory } from '../../src/run-history.js';

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

test('run history appends a request and atomically records its job outcome', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'seek-history-'));
  const history = new RunHistory(path.join(directory, 'history.json'));
  try {
    await history.acquire();
    await history.append({ runId: 'run-1', requestedAt: '2026-10-09T00:00:00.000Z', request: { command: 'batch-prepare', searchText: 'AI Engineer', location: '', limit: 5 }, foundJobs: [], jobs: [], status: 'running' });
    await history.update('run-1', entry => {
      entry.foundJobs.push({ jobId: '94974243', title: 'AI Engineer', employer: 'SustainRecruit', seekUrl: 'https://au.seek.com/job/94974243' });
      entry.jobs.push({ jobId: '94974243', title: 'AI Engineer', employer: 'SustainRecruit', seekUrl: 'https://au.seek.com/job/94974243', status: 'ready_to_submit' });
      entry.status = 'completed'; entry.completedAt = '2026-10-09T00:01:00.000Z';
    });
    const saved = JSON.parse(await readFile(history.path, 'utf8'));
    expect(saved.runs).toHaveLength(1);
    expect(saved.runs[0].request.searchText).toBe('AI Engineer');
    expect(saved.runs[0].jobs[0].status).toBe('ready_to_submit');
  } finally { await history.release(); await rm(directory, { recursive: true, force: true }); }
});
