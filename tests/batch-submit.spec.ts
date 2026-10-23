import { chromium, expect, test } from '@playwright/test';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runBatchSubmit, validateBatchSubmitOptions } from '../src/batch-submit.js';
import { fixtureAdapter, fixtureConfig, startFixture, type Options } from './fixtures/seek-fixture.js';
import { loadConfig } from '../src/config.js';
import { Ledger } from '../src/submission-ledger.js';

async function scenario(options: Options, action: (context: {
  loaded: Awaited<ReturnType<typeof loadConfig>>; endpoint: string;
  server: Awaited<ReturnType<typeof startFixture>>; operatorPage: import('@playwright/test').Page;
}) => Promise<void>) {
  const server = await startFixture({ batchJobs: 3, existingResume: true, profileOnly: true, radioCoverCompletion: true, questionsBeforeProfile: true, ...options });
  const files = await fixtureConfig(server.origin);
  let chrome: import('@playwright/test').BrowserContext | undefined;
  try {
    const config = JSON.parse(await readFile(files.file, 'utf8'));
    config.mode = 'submit'; config.answers = []; delete config.applicant;
    config.documents = { existingResumeFilename: 'Resume.docx', coverLetterPath: './Cover Letter.docx' };
    config.runHistoryPath = './history.json';
    await writeFile(files.file, JSON.stringify(config));
    const adapter = structuredClone(fixtureAdapter);
    adapter.search.cardTitle = adapter.search.cardLink;
    adapter.search.cardEmployer = { by: 'testId', value: 'company' };
    adapter.application.steps[0].uploads!.existingResume = { option: { by: 'role', role: 'radio', value: 'Resume.docx' } };
    delete adapter.application.steps[0].uploads!.resume;
    adapter.application.steps[0].uploads!.coverLetter = { input: { by: 'label', value: 'Upload cover letter' }, selectedRadio: { by: 'testId', value: 'cover-choice' } };
    adapter.application.steps[1].ready = { by: 'testId', value: 'profile' };
    adapter.application.steps[1].next = { by: 'role', role: 'button', value: 'Continue' };
    delete adapter.application.steps[1].fields; delete adapter.application.steps[1].questionRegion;
    await writeFile(path.join(files.dir, 'adapter.json'), JSON.stringify(adapter));
    const loaded = await loadConfig(files.file);
    const profile = path.join(files.dir, 'chrome');
    chrome = await chromium.launchPersistentContext(profile, { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH, headless: true, args: ['--remote-debugging-port=0'] });
    await chrome.addCookies(JSON.parse(await readFile(loaded.config.account.storageStatePath, 'utf8')).cookies);
    const port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
    await action({ loaded, endpoint: `http://127.0.0.1:${port}`, server, operatorPage: chrome.pages()[0] });
  } finally { await chrome?.close(); await server.close(); await rm(files.dir, { recursive: true, force: true }); }
}

test('batch submits only approved IDs, waits after confirmation, paginates, records history and skips local duplicates', async () => {
  await scenario({ batchJobs: 4, batchPageSize: 1, batchApplied: ['94974243'] }, async ({ loaded, endpoint, server, operatorPage }) => {
    const waits: number[] = [];
    const result = await runBatchSubmit(loaded, loaded.adapter, endpoint, {
      count: 2, waitSeconds: 5,
      confirm: async candidates => {
        expect(candidates.map(item => item.jobId)).toEqual(['94974244', '94974245']);
        expect(server.state.uploads).toHaveLength(0); return true;
      },
      wait: async milliseconds => {
        expect(server.state.submittedIds).toEqual(['94974244']);
        expect(server.state.selectedJobs).toEqual(['94974244']);
        waits.push(milliseconds);
      },
    });
    expect(result.status, JSON.stringify(result.failure)).toBe('completed');
    expect(result.exitCode).toBe(0); expect(result.submitted).toBe(2);
    expect(server.state.submittedIds).toEqual(['94974244', '94974245']);
    expect(waits).toEqual([5000]);
    expect(server.state.screeningAnswers).toEqual(Array(2).fill({ experience: 'first', licence: 'first', skills: ['first'], details: 'N/A' }));
    const history = JSON.parse(await readFile(result.history, 'utf8'));
    expect(history.runs[0].request).toMatchObject({ command: 'batch-submit', limit: 2, submissionIntervalSeconds: 5 });
    expect(history.runs[0].jobs.map((job: any) => [job.status, job.submitted])).toEqual([['submitted', true], ['submitted', true]]);
    expect(JSON.parse(await readFile(result.artifact, 'utf8')).submitted).toBe(2);
    const next = await runBatchSubmit(loaded, loaded.adapter, endpoint, { count: 1, waitSeconds: 0, confirm: async candidates => {
      expect(candidates.map(item => item.jobId)).toEqual(['94974246']); return true;
    }, wait: async () => { throw Error('No wait for a one-job batch'); } });
    expect(next.submitted, JSON.stringify(next.failure)).toBe(1);
    expect(server.state.submittedIds).toEqual(['94974244', '94974245', '94974246']);
    expect(operatorPage.isClosed()).toBe(false);
  });
});

for (const cancel of [true, false]) test(cancel ? 'cancelled batch uploads and submits nothing' : 'insufficient candidates never prompt or upload', async () => {
  await scenario({ batchJobs: 1 }, async ({ loaded, endpoint, server }) => {
    const result = await runBatchSubmit(loaded, loaded.adapter, endpoint, { count: cancel ? 1 : 2, waitSeconds: 0,
      confirm: async () => { if (!cancel) throw Error('Must not prompt'); return false; } });
    expect(result.failure?.code).toBe(cancel ? 'BATCH_CANCELLED' : 'BATCH_INSUFFICIENT_CANDIDATES');
    expect(server.state.uploads).toHaveLength(0); expect(server.state.submissions).toBe(0);
  });
});

test('uncertain first submission stops the batch and leaves later jobs untouched', async () => {
  await scenario({ loseConfirmation: true }, async ({ loaded, endpoint, server }) => {
    const result = await runBatchSubmit(loaded, loaded.adapter, endpoint, { count: 2, waitSeconds: 5, confirm: async () => true,
      wait: async () => { throw Error('Must not wait or advance after uncertainty'); } });
    expect(result.status).toBe('submission_uncertain'); expect(result.exitCode).toBe(7);
    expect(server.state.submittedIds).toEqual(['94974243']);
    expect(result.candidates.map(item => item.status)).toEqual(['submission_uncertain', 'pending']);
    expect((await new Ledger(loaded.config).read())?.state).toBe('submission_uncertain');
    const history = JSON.parse(await readFile(result.history, 'utf8'));
    expect(history.runs[0].jobs[0]).toMatchObject({ status: 'submission_uncertain', submitted: false, submissionAttempted: true });
  });
});

test('a pre-submit rejection is skipped without adding unapproved replacement jobs', async () => {
  await scenario({ batchBlocked: ['94974243'] }, async ({ loaded, endpoint, server }) => {
    const result = await runBatchSubmit(loaded, loaded.adapter, endpoint, { count: 2, waitSeconds: 0, confirm: async () => true });
    expect(result.status).toBe('completed'); expect(result.exitCode).toBe(4); expect(result.submitted).toBe(1);
    expect(server.state.selectedJobs).toEqual(['94974243', '94974244']);
    expect(server.state.submittedIds).toEqual(['94974244']);
  });
});

test('invalid count and wait parameters are rejected', () => {
  for (const count of [0, -1, 1.5, NaN, Infinity]) expect(() => validateBatchSubmitOptions(count, 0)).toThrow(/--count/);
  for (const seconds of [-1, 1.5, NaN, Infinity]) expect(() => validateBatchSubmitOptions(1, seconds)).toThrow(/--wait-seconds/);
  expect(() => validateBatchSubmitOptions(1, 0)).not.toThrow();
});
