import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { mkdir, chmod } from 'node:fs/promises';
import { chromium, type BrowserContext, type Browser } from '@playwright/test';
import type { Loaded } from './config.js';
import { WorkflowError, type TerminalStatus } from './errors.js';
import { Ledger, atomicJson, accountReference } from './submission-ledger.js';
import { configureContext, NavigationGuard, visible } from './pages/ui.js';
import { applyFlow, reconcileFlow, type Step, type FlowState } from './flows/apply.js';

export type Result = {
  runId: string; startedAt: string; finishedAt: string; operation: 'apply' | 'reconcile';
  mode: string; query: string; location: string; target: Loaded['config']['target']; accountReference: string;
  documents: { resume: { filename: string; sha256: string; bytes: number }; coverLetter: { filename: string; sha256: string; bytes: number } };
  phase: string; status: TerminalStatus; code: string; message: string; exitCode: number; confirmation?: string;
  artifacts: { result: string; screenshot?: string; trace?: string };
};
export function launchOptions(headed: boolean) {
  return { headless: !headed, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, timeout: 30000 };
}
export async function runWorkflow(loaded: Loaded, operation: 'apply' | 'reconcile' = 'apply', step: Step = async (_name, fn) => fn()): Promise<Result> {
  const { config: c, documents: d, adapter: a } = loaded;
  const runId = randomUUID();
  const directory = path.join(c.artifactsDirectory, runId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const strip = ({ path: _path, ...rest }: typeof d.resume) => rest;
  const result: Result = { runId, startedAt: new Date().toISOString(), finishedAt: '', operation, mode: c.mode,
    query: c.query, location: c.location, target: c.target, accountReference: accountReference(c),
    documents: { resume: strip(d.resume), coverLetter: strip(d.coverLetter) },
    phase: 'preflight', status: 'failed', code: 'WORKFLOW_FAILED', message: '', exitCode: 6,
    artifacts: { result: path.join(directory, 'result.json') } };
  const ledger = new Ledger(c);
  const guard = new NavigationGuard(c);
  let browser: Browser | undefined, context: BrowserContext | undefined, state: FlowState | undefined, timer: NodeJS.Timeout | undefined;
  let evidenceCapture: Promise<void> | undefined;
  let deadlineCleanup: Promise<void> | undefined;
  const captureEvidence = () => evidenceCapture ??= (async () => {
    const screenshot = path.join(directory, 'evidence.png');
    if (state && !state.page.isClosed()) await state.page.screenshot({ path: screenshot, fullPage: true, timeout: 2000 }).then(async () => { await chmod(screenshot, 0o600); result.artifacts.screenshot = screenshot; }).catch(() => {});
    const trace = path.join(directory, 'trace.zip');
    await context?.tracing.stop({ path: trace }).then(async () => { await chmod(trace, 0o600); result.artifacts.trace = trace; }).catch(() => {});
  })();
  try {
    await ledger.acquire(runId);
    if (operation === 'apply') await ledger.ensureUnused();
    try { browser = await chromium.launch(launchOptions(c.headed)); }
    catch { throw new WorkflowError('BROWSER_LAUNCH_FAILED', 'Chromium could not launch. Install it with npx playwright install chromium; use --headless on machines without a display, or configure PLAYWRIGHT_EXECUTABLE_PATH.'); }
    try {
      context = await browser.newContext({ storageState: c.account.storageStatePath, serviceWorkers: 'block', acceptDownloads: false });
    } catch { throw new WorkflowError('AUTH_STATE_MISSING', 'Cannot load isolated authentication state. Run npm run auth first.', 3, 'blocked'); }
    configureContext(context, c.stepTimeoutMs);
    await guard.install(context);
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    state = { phase: 'preflight', page: await context.newPage(), attempted: false };
    timer = setTimeout(() => {
      guard.expired = true;
      // Preserve first-failure evidence before closing the context to interrupt pending actions.
      deadlineCleanup = (async () => { await captureEvidence(); await context?.close().catch(() => {}); })();
    }, c.runTimeoutMs);
    result.status = operation === 'apply' ? await applyFlow(loaded, state, ledger, runId, guard, step) : await reconcileFlow(loaded, state, ledger, guard, step);
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
      } else { await context.tracing.stop().catch(() => {}); }
      await context.close().catch(() => {});
    }
    await browser?.close().catch(() => {});
    try { await ledger.release(); } catch { result.message += ' Lock cleanup failed; inspect stale-lock instructions.'; }
    result.finishedAt = new Date().toISOString();
    await atomicJson(result.artifacts.result, result);
  }
  return result;
}
