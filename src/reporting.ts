import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { mkdir, chmod } from 'node:fs/promises';
import { chromium, type BrowserContext, type Browser } from '@playwright/test';
import type { Loaded, DocumentInfo, ExistingResumeInfo } from './config.js';
import { WorkflowError, type TerminalStatus } from './errors.js';
import { Ledger, atomicJson, accountReference } from './submission-ledger.js';
import { configureContext, NavigationGuard, visible } from './pages/ui.js';
import { applyFlow, reconcileFlow, type Step, type FlowState, type ApplyOptions } from './flows/apply.js';
import { captureControls } from './inspection.js';
import type { ScreeningPageAudit } from './pages/screening-audit.js';
import { RunHistory, type RunHistoryEntry } from './run-history.js';

export type BrowserConnection = { cdpEndpoint?: string } & ApplyOptions;
export function validateCdpEndpoint(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new WorkflowError('INVALID_CDP_ENDPOINT', 'The CDP endpoint must be an HTTP URL such as http://127.0.0.1:9222.', 2, 'blocked'); }
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new WorkflowError('INVALID_CDP_ENDPOINT', 'CDP may connect only to a local HTTP endpoint with no path, query or credentials.', 2, 'blocked');
  return url.href.slice(0, -1);
}

export type Result = {
  runId: string; startedAt: string; finishedAt: string; operation: 'apply' | 'reconcile';
  mode: string; query: string; location: string; target: Loaded['config']['target']; accountReference: string;
  documents: { resume: Omit<DocumentInfo, 'path'> | ExistingResumeInfo; coverLetter: Omit<DocumentInfo, 'path'> };
  screeningAudit: ScreeningPageAudit[]; history?: string;
  phase: string; status: TerminalStatus; code: string; message: string; exitCode: number; confirmation?: string;
  artifacts: { result: string; screenshot?: string; trace?: string; controls?: string };
};
export function launchOptions(headed: boolean) {
  return { headless: !headed, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, timeout: 30000 };
}
export async function runWorkflow(loaded: Loaded, operation: 'apply' | 'reconcile' = 'apply', step: Step = async (_name, fn) => fn(), connection: BrowserConnection = {}): Promise<Result> {
  const { config: c, documents: d, adapter: a } = loaded;
  const runId = randomUUID();
  const directory = path.join(c.artifactsDirectory, runId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const strip = ({ path: _path, ...rest }: DocumentInfo) => rest;
  const result: Result = { runId, startedAt: new Date().toISOString(), finishedAt: '', operation, mode: c.mode,
    query: c.query, location: c.location, target: c.target, accountReference: accountReference(c),
    documents: { resume: d.resume.source === 'local' ? strip(d.resume) : d.resume, coverLetter: strip(d.coverLetter) }, screeningAudit: [],
    phase: 'preflight', status: 'failed', code: 'WORKFLOW_FAILED', message: '', exitCode: 6,
    artifacts: { result: path.join(directory, 'result.json') } };
  const ledger = new Ledger(c);
  const history = operation === 'apply' && connection.directJob ? new RunHistory(c.runHistoryPath) : undefined;
  const guard = new NavigationGuard(c);
  const cdpEndpoint = connection.cdpEndpoint ? validateCdpEndpoint(connection.cdpEndpoint) : undefined;
  let browser: Browser | undefined, context: BrowserContext | undefined, state: FlowState | undefined, timer: NodeJS.Timeout | undefined;
  let evidenceCapture: Promise<void> | undefined;
  let deadlineCleanup: Promise<void> | undefined;
  const captureEvidence = () => evidenceCapture ??= (async () => {
    const screenshot = path.join(directory, 'evidence.png');
    if (state && !state.page.isClosed()) await state.page.screenshot({ path: screenshot, fullPage: true, timeout: 2000 }).then(async () => { await chmod(screenshot, 0o600); result.artifacts.screenshot = screenshot; }).catch(() => {});
    if (result.exitCode !== 0 && state && !state.page.isClosed()) {
      const controls = path.join(directory, 'controls.json');
      await captureControls(state.page).then(snapshot => atomicJson(controls, snapshot)).then(() => { result.artifacts.controls = controls; }).catch(() => {});
    }
    if (!cdpEndpoint) {
      const trace = path.join(directory, 'trace.zip');
      await context?.tracing.stop({ path: trace }).then(async () => { await chmod(trace, 0o600); result.artifacts.trace = trace; }).catch(() => {});
    }
  })();
  try {
    if (history) {
      await history.acquire();
      const entry: RunHistoryEntry = { runId, requestedAt: result.startedAt,
        request: { command: 'prepare-one', jobId: c.target.jobId, title: c.target.expectedTitle, employer: c.target.expectedEmployer },
        foundJobs: [{ jobId: c.target.jobId, title: c.target.expectedTitle, employer: c.target.expectedEmployer, seekUrl: new URL(`/job/${encodeURIComponent(c.target.jobId)}`, c.baseUrl).href }],
        jobs: [], status: 'running' };
      await history.append(entry);
      result.history = history.path;
    }
    await ledger.acquire(runId);
    if (operation === 'apply') await ledger.ensureUnused();
    if (cdpEndpoint) {
      try { browser = await chromium.connectOverCDP(cdpEndpoint); }
      catch { throw new WorkflowError('CDP_CONNECTION_FAILED', 'Cannot connect to the dedicated local Chrome profile. Start Chrome with its remote-debugging port, sign in, then retry.', 3, 'blocked'); }
      context = browser.contexts()[0];
      if (!context) throw new WorkflowError('CDP_CONTEXT_MISSING', 'The local Chrome profile has no available browser context. Restart the dedicated Chrome profile and retry.', 3, 'blocked');
    } else {
      try { browser = await chromium.launch(launchOptions(c.headed)); }
      catch { throw new WorkflowError('BROWSER_LAUNCH_FAILED', 'Chromium could not launch. Install it with npx playwright install chromium; use --headless on machines without a display, or configure PLAYWRIGHT_EXECUTABLE_PATH.'); }
      try { context = await browser.newContext({ storageState: c.account.storageStatePath, serviceWorkers: 'block', acceptDownloads: false }); }
      catch { throw new WorkflowError('AUTH_STATE_MISSING', 'Cannot load isolated authentication state. Run npm run auth first.', 3, 'blocked'); }
    }
    configureContext(context, c.stepTimeoutMs);
    state = { phase: 'preflight', page: await context.newPage(), attempted: false, screeningAudit: result.screeningAudit };
    if (cdpEndpoint) await guard.installPage(state.page);
    else { await guard.install(context); await context.tracing.start({ screenshots: true, snapshots: true, sources: true }); }
    timer = setTimeout(() => {
      guard.expired = true;
      // Preserve first-failure evidence before closing the context to interrupt pending actions.
      deadlineCleanup = (async () => { await captureEvidence(); await state?.page.close().catch(() => {}); if (!cdpEndpoint) await context?.close().catch(() => {}); })();
    }, c.runTimeoutMs);
    if ((connection.directJob || connection.autoQuestions) && c.mode !== 'prepare')
      throw new WorkflowError('PREPARE_ONLY', 'Direct job preparation and automatic screening are available only in prepare mode.', 2, 'blocked');
    result.status = operation === 'apply' ? await applyFlow(loaded, state, ledger, runId, guard, step, connection) : await reconcileFlow(loaded, state, ledger, guard, step);
    guard.check();
    result.code = result.status === 'prepared' ? 'PREPARED' : result.status === 'submitted' ? 'SUBMITTED' : 'RECONCILED';
    result.exitCode = result.status === 'already_applied' ? 8 : 0;
    result.message = result.status === 'prepared' ? 'Review verified; final submit was not activated.' : result.status === 'submitted' ? 'Application confirmation verified and recorded.' : 'Existing application reconciled; nothing was submitted.';
  } catch (error) {
    let e = error instanceof WorkflowError ? error : guard.fault;
    if (!e && state && !state.page.isClosed()) {
      const needsLogin = await visible(state.page, a.auth.loginRequired).catch(() => false) || await visible(state.page, a.auth.challenge).catch(() => false);
      if (needsLogin) e = new WorkflowError('AUTH_REQUIRED', 'Login or human verification is required. Run npm run auth.', 3, 'blocked');
    }
    if (state?.attempted && e?.status !== 'submission_uncertain') e = new WorkflowError('SUBMISSION_UNCERTAIN', 'Submission confirmation is uncertain. Reconcile before another run.', 7, 'submission_uncertain');
    e ??= new WorkflowError(guard.expired ? 'RUN_TIMEOUT' : 'WORKFLOW_FAILED', 'Workflow failed. Inspect private screenshot and trace; raw page data is omitted from console output.');
    result.status = e.status; result.code = e.code; result.message = e.message; result.exitCode = e.exitCode;
  } finally {
    clearTimeout(timer);
    await deadlineCleanup;
    result.phase = state?.phase ?? result.phase; result.confirmation = state?.confirmation;
    if (context) {
      const retain = result.exitCode !== 0 || c.retainSuccessEvidence || result.status === 'prepared';
      if (retain) {
        await captureEvidence();
      } else if (!cdpEndpoint) { await context.tracing.stop().catch(() => {}); }
      await state?.page.close().catch(() => {});
      if (!cdpEndpoint) await context.close().catch(() => {});
    }
    // Closing a browser connected over CDP can close the operator's Chrome profile.
    if (!cdpEndpoint) await browser?.close().catch(() => {});
    try { await ledger.release(); } catch { result.message += ' Lock cleanup failed; inspect stale-lock instructions.'; }
    result.finishedAt = new Date().toISOString();
    if (history && result.history) {
      await history.update(runId, record => {
        record.jobs = [{ jobId: c.target.jobId, title: c.target.expectedTitle, employer: c.target.expectedEmployer,
          seekUrl: new URL(`/job/${encodeURIComponent(c.target.jobId)}`, c.baseUrl).href,
          status: result.status === 'prepared' ? 'ready_to_submit' : 'skipped', screeningAudit: result.screeningAudit,
          submissionPlan: null, submitted: false,
          ...(result.status === 'prepared' ? {} : { reason: { code: result.code, message: result.message } }) }];
        record.status = result.status === 'prepared' ? 'completed' : 'failed';
        if (result.status !== 'prepared') record.failure = { code: result.code, message: result.message };
        record.completedAt = result.finishedAt;
      }).catch(() => { result.message += ' Private run history could not be updated; result.json retains this run.'; });
    }
    await history?.release().catch(() => { result.message += ' Run history lock cleanup failed; check the private lock file before retrying.'; });
    await atomicJson(result.artifacts.result, result);
  }
  return result;
}
