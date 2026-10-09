import type { Page } from '@playwright/test';
import type { Loaded } from '../config.js';
import { WorkflowError } from '../errors.js';
import { assertions, exactConfiguredAccount, identity, jobIdFromSeekPath, locate, unique, visible, type NavigationGuard } from './ui.js';

export async function startApplication(page: Page, { config: c, adapter: a }: Loaded, guard: NavigationGuard): Promise<Page> {
  const expect = assertions(page);
  try { await expect(locate(page, a.job.ready)).toBeVisible(); }
  catch {
    guard.check();
    throw new WorkflowError('JOB_UI_CHANGED', 'The observed SEEK job-detail Apply control was not visible. Capture the job detail structure before retrying.', 5, 'blocked');
  }
  guard.checkPage(page);
  await identity(page, c, a.job.identity);
  if (await visible(page, a.job.alreadyApplied)) throw new WorkflowError('ALREADY_APPLIED', 'Site reports this job was already applied for.', 8, 'already_applied');
  // Listen before clicking, then poll readiness in either the existing tab or a popup.
  const candidates: Page[] = [page];
  const onPopup = (popup: Page) => candidates.push(popup);
  page.on('popup', onPopup);
  try {
    await (await unique(page, a.job.apply)).click();
    let application: Page | undefined;
    try {
      await expect.poll(async () => {
        guard.check();
        for (const candidate of candidates) {
          if (candidate.isClosed()) continue;
          if (await visible(candidate, a.auth.loginRequired) || await visible(candidate, a.auth.challenge))
            throw new WorkflowError('AUTH_REQUIRED', 'Authentication or verification is required.', 3, 'blocked');
          if (await visible(candidate, a.application.ready)) { application = candidate; return true; }
        }
        return false;
      }, { timeout: c.stepTimeoutMs }).toBe(true);
    } catch (error) {
      if (error instanceof WorkflowError) throw error;
      guard.check();
      throw new WorkflowError('NOT_QUICK_APPLY', 'The job did not reach the observed SEEK Quick Apply form. It was stopped before any document upload.', 5, 'blocked');
    }
    guard.checkPage(application!);
    if (a.application.jobIdFromUrl) jobIdFromSeekPath(application!, c.target.jobId);
    else await expect(await unique(application!, a.application.jobId!)).toHaveText(c.target.jobId);
    if (await visible(application!, a.application.alreadyApplied)) throw new WorkflowError('ALREADY_APPLIED', 'Site reports an existing application.', 8, 'already_applied');
    // This is before setInputFiles or any other form mutation.
    if (a.application.accountFromConfigText) await exactConfiguredAccount(application!, c);
    return application!;
  } finally { page.off('popup', onPopup); }
}
