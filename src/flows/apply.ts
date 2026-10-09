import type { Page } from '@playwright/test';
import type { Loaded } from '../config.js';
import { WorkflowError, type TerminalStatus } from '../errors.js';
import { Ledger, type Entry } from '../submission-ledger.js';
import { assertions, checkAuthentication, locate, unique, exact, NavigationGuard } from '../pages/ui.js';
import { search } from '../pages/search-page.js';
import { startApplication } from '../pages/job-page.js';
import { completeApplication, assertReview } from '../pages/application-page.js';

export type Step = <T>(name: string, action: () => Promise<T>) => Promise<T>;
export type FlowState = { phase: string; page: Page; attempted: boolean; confirmation?: string };
export type ApplyOptions = { directJob?: boolean; autoQuestions?: boolean };
export async function applyFlow(loaded: Loaded, state: FlowState, ledger: Ledger, runId: string, guard: NavigationGuard, step: Step, options: ApplyOptions = {}): Promise<TerminalStatus> {
  const expect = assertions(state.page);
  const { config: c, adapter: a } = loaded;
  await ledger.ensureUnused();
  await step('Verify isolated account session', async () => {
    state.phase = 'authentication';
    await state.page.goto(new URL(a.auth.url, c.baseUrl).href, { waitUntil: 'domcontentloaded' });
    guard.checkPage(state.page);
    await checkAuthentication(state.page, c, a);
  });
  if (options.directJob) {
    await step('Open the exact approved job', async () => {
      state.phase = 'job';
      const destination = new URL(`/job/${encodeURIComponent(c.target.jobId)}`, c.baseUrl);
      await state.page.goto(destination.href, { waitUntil: 'commit' });
      guard.checkPage(state.page);
    });
  } else {
    await step('Search and select the exact approved job', async () => {
      state.phase = 'search'; state.page = await search(state.page, loaded, guard);
    });
  }
  await step('Verify job and open application', async () => {
    state.phase = 'job'; state.page = await startApplication(state.page, loaded, guard); state.phase = 'application';
  });
  await step('Upload documents, complete questions and verify review', async () => {
    state.phase = 'form'; await completeApplication(state.page, loaded, guard, options.autoQuestions); state.phase = 'review';
  });
  if (c.mode === 'prepare') return 'prepared';
  return step<TerminalStatus>('Record intent, submit once and verify confirmation', async () => {
    guard.check();
    await assertReview(state.page, loaded, guard);
    await ledger.ensureUnused();
    const now = new Date().toISOString();
    const entry: Entry = { key: ledger.key, runId, state: 'submission_attempted', createdAt: now, updatedAt: now,
      documentHashes: [...(loaded.documents.resume.source === 'local' ? [loaded.documents.resume.sha256] : []), loaded.documents.coverLetter.sha256] };
    await ledger.write(entry);
    state.attempted = true; state.phase = 'submission';
    try {
      guard.check();
      await (await unique(state.page, a.review.submit)).click(); // Exactly one call. Never retried.
      await expect(locate(state.page, a.confirmation!.ready)).toBeVisible();
      guard.checkPage(state.page);
      await exact(state.page, a.confirmation!.jobId, c.target.jobId);
      const confirmation = (await (await unique(state.page, a.confirmation!.reference)).innerText()).trim();
      if (!confirmation) throw Error('No confirmation reference');
      await ledger.write({ ...entry, state: 'confirmed', confirmation, updatedAt: new Date().toISOString() });
      state.confirmation = confirmation; state.phase = 'confirmation';
      return 'submitted';
    } catch {
      // If writing uncertainty fails, the durable attempted record still blocks retries.
      await ledger.write({ ...entry, state: 'submission_uncertain', updatedAt: new Date().toISOString() }).catch(() => {});
      throw new WorkflowError('SUBMISSION_UNCERTAIN', 'A submission was attempted but reliable confirmation could not be recorded. Reconcile application history; do not rerun submit.', 7, 'submission_uncertain');
    }
  });
}
export async function reconcileFlow(loaded: Loaded, state: FlowState, ledger: Ledger, guard: NavigationGuard, step: Step): Promise<TerminalStatus> {
  const expect = assertions(state.page);
  const { config: c, adapter: a } = loaded;
  if (!a.history) throw new WorkflowError('HISTORY_UNAVAILABLE', 'This prepare-only adapter has no verified application-history mapping.', 5, 'blocked');
  const history = a.history;
  const existing = await ledger.read();
  if (!existing) throw new WorkflowError('NO_ATTEMPT', 'There is no local submission attempt to reconcile.', 8, 'blocked');
  return step<TerminalStatus>('Read application history without submitting', async () => {
    state.phase = 'reconciliation';
    await state.page.goto(new URL(history.url, c.baseUrl).href, { waitUntil: 'domcontentloaded' });
    guard.checkPage(state.page);
    await checkAuthentication(state.page, c, a);
    await expect(locate(state.page, history.ready)).toBeVisible();
    const matches = [];
    for (const entry of await locate(state.page, history.entry).all())
      if (await entry.getAttribute(history.jobIdAttribute) === c.target.jobId) matches.push(entry);
    if (matches.length !== 1) throw new WorkflowError('RECONCILIATION_UNRESOLVED', 'History did not show exactly one application for the approved job. Ledger remains blocked.', 7, 'submission_uncertain');
    const confirmation = (await (await unique(matches[0], history.reference)).innerText()).trim();
    if (!confirmation) throw new WorkflowError('RECONCILIATION_UNRESOLVED', 'History reference is missing. Ledger remains blocked.', 7, 'submission_uncertain');
    const now = new Date().toISOString();
    await ledger.write({ ...existing, state: 'confirmed', confirmation, updatedAt: now, reconciledAt: now });
    state.confirmation = confirmation;
    return 'already_applied';
  });
}
