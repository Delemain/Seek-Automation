import { test, expect } from '@playwright/test';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startFixture, fixtureConfig, fixtureAdapter, type Options } from './fixtures/seek-fixture.js';
import { loadConfig, type Loaded } from '../src/config.js';
import { runWorkflow } from '../src/reporting.js';
import { Ledger } from '../src/submission-ledger.js';

async function scenario(options: Options, action: (loaded: Loaded, server: Awaited<ReturnType<typeof startFixture>>) => Promise<void>) {
  const server = await startFixture(options);
  const files = await fixtureConfig(server.origin);
  try { await action(await loadConfig(files.file), server); }
  finally { await server.close(); await rm(files.dir, { recursive: true, force: true }); }
}
async function run(loaded: Loaded, operation: 'apply' | 'reconcile' = 'apply') {
  const result = await runWorkflow(loaded, operation, (name, fn) => test.step(name, fn));
  for (const [name, file] of Object.entries(result.artifacts)) if (file)
    await test.info().attach(`${result.runId}-${name}`, { path: file });
  return result;
}

test('prepare searches exact ID, uploads both new files despite reversed inputs, verifies all answer types, and never submits', async () => {
  await scenario({}, async (loaded, server) => {
    const result = await run(loaded);
    expect(result.status, result.message).toBe('prepared');
    expect(server.state.searches[0]).toEqual({ query: 'QA test', location: 'Sydney NSW' });
    expect(server.state.selectedJobs).toEqual(['94974243']);
    expect(server.state.uploads.map(f => f.filename)).toEqual(['Resume.docx', 'Cover Letter.docx']);
    expect(server.state.uploads[0].body).toContain('Synthetic resume fixture bytes');
    expect(server.state.uploads[1].body).toContain('Synthetic cover letter fixture bytes');
    expect(server.state.submissions).toBe(0);
    expect(result.artifacts.screenshot).toBeTruthy();
    expect(result.artifacts.trace).toBeTruthy();
    expect(await new Ledger(loaded.config).read()).toBeUndefined();
    expect((await readFile(result.artifacts.result, 'utf8'))).not.toContain('test@example.invalid');
  });
});
test('name-only search clears a prefilled location and still selects the exact job', async () => {
  await scenario({ prefilledSearchLocation: true }, async (loaded, server) => {
    loaded.config.location = '';
    const result = await run(loaded);
    expect(result.status, result.message).toBe('prepared');
    expect(server.state.searches[0]).toEqual({ query: 'QA test', location: '' });
    expect(server.state.selectedJobs).toEqual(['94974243']);
    expect(server.state.submissions).toBe(0);
  });
});
for (const [unselectedResume, mode] of [[false, 'prepare'], [false, 'submit'], [true, 'prepare']] as const) {
  test(unselectedResume ? 'stored résumé not selected stops before uploading the cover letter' : `${mode} uses the selected SEEK résumé and unchanged profile with a local cover letter`, async () => {
    const server = await startFixture({ existingResume: true, unselectedResume, profileOnly: true, radioCoverCompletion: true });
    const files = await fixtureConfig(server.origin);
    try {
      const config = JSON.parse(await readFile(files.file, 'utf8'));
      config.documents = { existingResumeFilename: 'Resume.docx', coverLetterPath: './Cover Letter.docx' };
      config.mode = mode;
      delete config.applicant;
      config.answers = [];
      await writeFile(files.file, JSON.stringify(config));
      const adapter = structuredClone(fixtureAdapter);
      adapter.application.steps[0].uploads!.existingResume = { option: { by: 'role', role: 'radio', value: 'Resume.docx' } };
      delete adapter.application.steps[0].uploads!.resume;
      adapter.application.steps[0].uploads!.coverLetter = { input: { by: 'label', value: 'Upload cover letter' }, selectedRadio: { by: 'testId', value: 'cover-choice' } };
      adapter.application.steps[1].ready = { by: 'testId', value: 'profile' };
      adapter.application.steps[1].next = { by: 'role', role: 'button', value: 'Continue' };
      delete adapter.application.steps[1].fields;
      delete adapter.application.steps[1].questionRegion;
      await writeFile(path.join(files.dir, 'adapter.json'), JSON.stringify(adapter));
      await rm(path.join(files.dir, 'Resume.docx'));
      const loaded = await loadConfig(files.file);
      expect(loaded.documents.resume).toEqual({ source: 'seek', filename: 'Resume.docx' });
      const result = await run(loaded);
      if (unselectedResume) {
        expect(result.code).toBe('STORED_RESUME_MISMATCH');
        expect(server.state.uploads).toHaveLength(0);
      } else {
        expect(result.status, result.message).toBe(mode === 'submit' ? 'submitted' : 'prepared');
        expect(server.state.uploads.map(f => f.filename)).toEqual(['Cover Letter.docx']);
        expect(result.documents.resume).toEqual({ source: 'seek', filename: 'Resume.docx' });
      }
      expect(server.state.submissions).toBe(mode === 'submit' && !unselectedResume ? 1 : 0);
    } finally { await server.close(); await rm(files.dir, { recursive: true, force: true }); }
  });
}
test('confirmed submission is durable and a new invocation cannot duplicate it', async () => {
  await scenario({}, async (loaded, server) => {
    loaded.config.mode = 'submit';
    const first = await run(loaded);
    expect(first.status, first.message).toBe('submitted');
    expect(first.confirmation).toBe('fixture-application-1');
    expect((await new Ledger(loaded.config).read())?.state).toBe('confirmed');
    const second = await run(loaded);
    expect(second.code).toBe('DUPLICATE_REFUSED');
    expect(second.exitCode).toBe(8);
    expect(second.runId).not.toBe(first.runId);
    expect(server.state.submissions).toBe(1);
  });
});
test('lost confirmation is uncertain, never retried, and reconciles the original application', async () => {
  await scenario({ loseConfirmation: true }, async (loaded, server) => {
    loaded.config.mode = 'submit';
    const first = await run(loaded);
    expect(first.status).toBe('submission_uncertain');
    expect(first.exitCode).toBe(7);
    const entry = await new Ledger(loaded.config).read();
    expect(entry?.state).toBe('submission_uncertain');
    expect((await run(loaded)).exitCode).toBe(8);
    const reconciled = await run(loaded, 'reconcile');
    expect(reconciled.code, reconciled.message).toBe('RECONCILED');
    expect(reconciled.exitCode).toBe(8);
    expect((await new Ledger(loaded.config).read())?.runId).toBe(entry?.runId);
    expect((await new Ledger(loaded.config).read())?.state).toBe('confirmed');
    expect(server.state.submissions).toBe(1);
  });
});
for (const [name, options, code, exit] of [
  ['unknown required question', { unknownQuestion: true }, 'UNKNOWN_REQUIRED_QUESTION', 5],
  ['expired authentication', { expired: true }, 'AUTH_REQUIRED', 3],
  ['human verification', { challenge: true }, 'AUTH_REQUIRED', 3],
  ['external redirect', { external: true }, 'EXTERNAL_FLOW', 5],
  ['external popup', { external: true, popup: true }, 'EXTERNAL_FLOW', 5],
  ['no target', { missing: true }, 'TARGET_NOT_FOUND', 4],
  ['ambiguous target', { ambiguous: true }, 'AMBIGUOUS_TARGET', 4],
  ['wrong employer', { mismatch: true }, 'TARGET_MISMATCH', 4],
  ['previously applied', { alreadyApplied: true }, 'ALREADY_APPLIED', 8],
] as const) {
  test(`${name} stops before final submission`, async () => {
    await scenario(options, async (loaded, server) => {
      loaded.config.mode = 'submit';
      const result = await run(loaded);
      expect(result.code, result.message).toBe(code);
      expect(result.exitCode).toBe(exit);
      expect(server.state.submissions).toBe(0);
    });
  });
}
test('same-origin popup and bounded pagination work', async () => {
  await scenario({ popup: true, pagination: true }, async (loaded, server) => {
    expect((await run(loaded)).status).toBe('prepared');
    expect(server.state.searches).toHaveLength(2);
    expect(server.state.submissions).toBe(0);
  });
});
test('upload processing failure cannot advance to review', async () => {
  await scenario({ uploadFailure: true }, async (loaded, server) => {
    const result = await run(loaded);
    expect(result.exitCode).toBe(6);
    expect(result.phase).toBe('form');
    expect(server.state.submissions).toBe(0);
    expect(result.artifacts.trace).toBeTruthy();
  });
});
test('run deadline interrupts a stuck upload and retains the first-failure trace', async () => {
  await scenario({ uploadFailure: true }, async (loaded, server) => {
    loaded.config.runTimeoutMs = 3500;
    loaded.config.stepTimeoutMs = 15000;
    const result = await run(loaded);
    expect(result.code).toBe('RUN_TIMEOUT');
    expect(result.artifacts.trace).toBeTruthy();
    expect(result.artifacts.screenshot).toBeTruthy();
    expect(server.state.submissions).toBe(0);
  });
});
test('missing session state returns an actionable authentication result', async () => {
  await scenario({}, async (loaded, server) => {
    await rm(loaded.config.account.storageStatePath);
    const result = await run(loaded);
    expect(result.code).toBe('AUTH_STATE_MISSING'); expect(result.exitCode).toBe(3);
    expect(server.state.submissions).toBe(0);
  });
});
