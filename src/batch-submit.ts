import { chromium, type Page } from '@playwright/test';
import { createInterface } from 'node:readline/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Adapter, Loaded } from './config.js';
import { WorkflowError, type TerminalStatus } from './errors.js';
import { discoverBatchCandidates, type BatchCandidate } from './batch.js';
import { runWorkflow, validateCdpEndpoint, type Result } from './reporting.js';
import { Ledger, atomicJson } from './submission-ledger.js';
import { RunHistory, type RunHistoryJob } from './run-history.js';
import { configureContext, NavigationGuard } from './pages/ui.js';
import { firstOptionTestAnswer } from './pages/interactive-questions.js';

export type BatchSubmitItem = BatchCandidate & { status: TerminalStatus | 'pending' | 'running'; result?: Result };
export type BatchSubmitResult = {
  runId: string; query: string; location: string; count: number; waitSeconds: number;
  status: 'running' | 'completed' | 'cancelled' | 'failed' | 'submission_uncertain';
  exitCode: number; submitted: number; candidates: BatchSubmitItem[];
  searchUrl?: string; searchVerification?: 'result_url' | 'search_field';
  failure?: { code: string; message: string }; artifact: string; history: string;
};
export type BatchSubmitOptions = {
  count: number; waitSeconds: number;
  confirm?: (candidates: BatchCandidate[]) => Promise<boolean>;
  wait?: (milliseconds: number) => Promise<void>;
};

export function validateBatchSubmitOptions(count: number, waitSeconds: number) {
  if (!Number.isSafeInteger(count) || count < 1)
    throw new WorkflowError('INVALID_JOB_COUNT', '--count must be a whole number greater than zero.', 2, 'blocked');
  if (!Number.isSafeInteger(waitSeconds) || waitSeconds < 0)
    throw new WorkflowError('INVALID_WAIT_TIME', '--wait-seconds must be a whole number of seconds greater than or equal to zero.', 2, 'blocked');
}

function submissionJob(loaded: Loaded, adapter: Adapter, candidate: BatchCandidate): Loaded {
  return { ...loaded, adapter, config: { ...loaded.config, mode: 'submit',
    target: { jobId: candidate.jobId, expectedTitle: candidate.title, expectedEmployer: candidate.employer } } };
}

async function confirmSubmissions(candidates: BatchCandidate[]) {
  if (!process.stdin.isTTY) throw new WorkflowError('INTERACTIVE_CONFIRMATION_REQUIRED', 'Batch submit requires an interactive terminal confirmation.', 3, 'blocked');
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await terminal.question(`Type SUBMIT ${candidates.length} to prepare and submit these jobs: `)).trim() === `SUBMIT ${candidates.length}`; }
  finally { terminal.close(); }
}

function historyJob(item: BatchSubmitItem): RunHistoryJob {
  return { jobId: item.jobId, title: item.title, employer: item.employer, seekUrl: item.url,
    status: ['submitted', 'submission_uncertain', 'pending', 'running'].includes(item.status) ? item.status as RunHistoryJob['status'] : 'skipped',
    submitted: item.status === 'submitted', submissionAttempted: ['submitted', 'submission_uncertain'].includes(item.status),
    resultPath: item.result?.artifacts.result, confirmation: item.result?.confirmation,
    screeningAudit: item.result?.screeningAudit,
    reason: item.result && item.status !== 'submitted' ? { code: item.result.code, message: item.result.message }
      : !item.result ? { code: 'NOT_ATTEMPTED', message: 'This selected job has not been processed.' } : undefined };
}

/** Each job uses the same verified one-job submit workflow and its durable ledger. */
export async function runBatchSubmit(loaded: Loaded, adapter: Adapter, cdpEndpoint: string, options: BatchSubmitOptions): Promise<BatchSubmitResult> {
  validateBatchSubmitOptions(options.count, options.waitSeconds);
  const endpoint = validateCdpEndpoint(cdpEndpoint);
  if (loaded.config.mode !== 'submit' || !adapter.confirmation || !adapter.history)
    throw new WorkflowError('SUBMIT_MODE_REQUIRED', 'Batch submit requires submit mode and observed confirmation/history mappings.', 2, 'blocked');
  const runId = randomUUID();
  const history = new RunHistory(loaded.config.runHistoryPath);
  const result: BatchSubmitResult = { runId, query: loaded.config.query, location: loaded.config.location,
    count: options.count, waitSeconds: options.waitSeconds, status: 'running', exitCode: 0, submitted: 0, candidates: [],
    artifact: path.join(loaded.config.artifactsDirectory, `batch-submit-${runId}`, 'batch-result.json'), history: history.path };
  let page: Page | undefined;
  let historyAcquired = false;
  let historyStarted = false;
  const persist = async () => {
    await atomicJson(result.artifact, result);
    if (!historyStarted) return;
    await history.update(runId, record => {
      record.jobs = result.candidates.map(historyJob);
      record.status = result.status === 'submission_uncertain' ? 'failed' : result.status;
      record.failure = result.failure;
      if (result.status !== 'running') record.completedAt = new Date().toISOString();
    });
  };
  try {
    await history.acquire(); historyAcquired = true;
    await history.append({ runId, requestedAt: new Date().toISOString(),
      request: { command: 'batch-submit', searchText: result.query, location: result.location, limit: options.count, submissionIntervalSeconds: options.waitSeconds },
      foundJobs: [], jobs: [], status: 'running' });
    historyStarted = true;
    let browser;
    try { browser = await chromium.connectOverCDP(endpoint); }
    catch { throw new WorkflowError('CDP_CONNECTION_FAILED', 'Cannot connect to the dedicated Chrome profile. Start Chrome with port 9222 and sign in first.', 3, 'blocked'); }
    const context = browser.contexts()[0];
    if (!context) throw new WorkflowError('CDP_CONTEXT_MISSING', 'The dedicated Chrome profile has no browser context.', 3, 'blocked');
    configureContext(context, loaded.config.stepTimeoutMs);
    const guard = new NavigationGuard(loaded.config);
    page = await context.newPage();
    await guard.installPage(page);
    const discovery = await discoverBatchCandidates(page, loaded, adapter, guard, options.count, {
      paginate: true, eligible: async candidate => !await new Ledger(submissionJob(loaded, adapter, candidate).config).read(),
    });
    result.searchUrl = discovery.searchUrl; result.searchVerification = discovery.searchVerification;
    result.candidates = discovery.candidates.map(candidate => ({ ...candidate, status: 'pending' }));
    await history.update(runId, record => {
      record.searchUrl = result.searchUrl; record.searchVerification = result.searchVerification;
      record.foundJobs = discovery.candidates.map(candidate => ({ jobId: candidate.jobId, title: candidate.title, employer: candidate.employer, seekUrl: candidate.url }));
    });
    await persist();
    console.log(`Verified SEEK search (${result.searchVerification}): ${result.searchUrl}`);
    for (const [index, candidate] of result.candidates.entries()) console.log(`${index + 1}. ${candidate.title} — ${candidate.employer} (${candidate.jobId})`);
    if (result.candidates.length !== options.count)
      throw new WorkflowError('BATCH_INSUFFICIENT_CANDIDATES', `Found ${result.candidates.length} eligible jobs within the search-page limit; ${options.count} requested. Nothing was uploaded or submitted.`, 4, 'blocked');
    console.log(`Test defaults: first available options; N/A for text. Wait ${options.waitSeconds} second(s) after each confirmed submission before starting the next job.`);
    if (!await (options.confirm ?? confirmSubmissions)(discovery.candidates))
      throw new WorkflowError('BATCH_CANCELLED', 'Batch submission cancelled before any document upload.', 0, 'blocked');
    await page.close(); page = undefined;
    let waitBeforeNext = false;
    for (const [index, item] of result.candidates.entries()) {
      if (waitBeforeNext) {
        // Chunk long waits to avoid JavaScript timer overflow and show progress.
        for (let remaining = options.waitSeconds; remaining > 0;) {
          console.log(`Waiting ${remaining} second(s) before the next job.`);
          const seconds = Math.min(remaining, 30);
          await (options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(seconds * 1000);
          remaining -= seconds;
        }
      }
      waitBeforeNext = false;
      item.status = 'running'; await persist();
      console.log(`Application ${index + 1}/${options.count}: ${item.title} — ${item.employer}`);
      const outcome = await runWorkflow(submissionJob(loaded, adapter, item), 'apply', async (name, action) => { console.log(name); return action(); },
        { cdpEndpoint: endpoint, directJob: true, questionResponder: firstOptionTestAnswer });
      item.result = outcome; item.status = outcome.status;
      console.log(`${outcome.status} [${outcome.code}]. Result: ${outcome.artifacts.result}`);
      if (outcome.status === 'submitted') { result.submitted++; waitBeforeNext = true; }
      await persist();
      if (outcome.status === 'submission_uncertain' || ['AUTH_REQUIRED', 'ACCOUNT_MISMATCH', 'CDP_CONNECTION_FAILED', 'CDP_CONTEXT_MISSING'].includes(outcome.code)) {
        result.status = outcome.status === 'submission_uncertain' ? 'submission_uncertain' : 'failed';
        result.exitCode = outcome.exitCode; result.failure = { code: outcome.code, message: outcome.message };
        break;
      }
    }
    if (result.status === 'running') {
      result.status = 'completed';
      result.exitCode = result.submitted === options.count ? 0 : 4;
    }
  } catch (error) {
    const e = error instanceof WorkflowError ? error : new WorkflowError('BATCH_WORKFLOW_FAILED', 'Batch stopped unexpectedly. Inspect the saved job results and submission ledger before another run.');
    result.status = e.code === 'BATCH_CANCELLED' ? 'cancelled' : 'failed';
    result.exitCode = e.exitCode; result.failure = { code: e.code, message: e.message };
  } finally {
    await page?.close().catch(() => {});
    try { if (historyAcquired) await persist(); else await atomicJson(result.artifact, result); }
    finally { if (historyAcquired) await history.release(); }
  }
  return result;
}
