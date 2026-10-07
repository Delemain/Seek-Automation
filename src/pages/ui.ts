import { expect as baseExpect, type Page, type Locator, type BrowserContext } from '@playwright/test';
import type { Config, Adapter, LocatorSpec } from '../config.js';
import { WorkflowError } from '../errors.js';

type Root = Page | Locator;
const timeouts = new WeakMap<BrowserContext, number>();
export function configureContext(context: BrowserContext, timeout: number) {
  timeouts.set(context, timeout);
  context.setDefaultTimeout(timeout);
  context.setDefaultNavigationTimeout(timeout);
}
export function assertions(root: Root) {
  const page = 'page' in root ? root.page() : root;
  return baseExpect.configure({ timeout: timeouts.get(page.context()) ?? 15000 });
}
export function locate(root: Root, spec: LocatorSpec): Locator {
  switch (spec.by) {
    case 'role': return root.getByRole(spec.role as Parameters<Page['getByRole']>[0], { name: spec.value, exact: true });
    case 'label': return root.getByLabel(spec.value, { exact: true });
    case 'text': return root.getByText(spec.value, { exact: true });
    case 'testId': return root.getByTestId(spec.value);
    case 'css': return root.locator(spec.value);
  }
}
export async function unique(root: Root, spec: LocatorSpec): Promise<Locator> {
  const expect = assertions(root);
  const l = locate(root, spec);
  await expect(l, 'Observed locator must match exactly one element').toHaveCount(1);
  return l;
}
export async function visible(root: Root, spec?: LocatorSpec): Promise<boolean> {
  if (!spec) return false;
  const l = locate(root, spec);
  if (await l.count() > 1) throw new WorkflowError('AMBIGUOUS_UI', 'An observed optional UI locator matched multiple elements.');
  return await l.isVisible();
}
export async function exact(root: Root, spec: LocatorSpec, text: string) {
  const expect = assertions(root);
  await expect(await unique(root, spec)).toHaveText(text, { useInnerText: true });
}
export async function checkAuthentication(page: Page, c: Config, a: Adapter) {
  if (await visible(page, a.auth.loginRequired) || await visible(page, a.auth.challenge))
    throw new WorkflowError('AUTH_REQUIRED', 'Login, MFA or human verification is required. Run npm run auth locally.', 3, 'blocked');
  try { await exact(page, a.auth.account, c.account.expectedIdentifier); }
  catch { throw new WorkflowError('ACCOUNT_MISMATCH', 'Expected account could not be verified. Refresh the isolated login state.', 3, 'blocked'); }
}
export async function identity(page: Page, c: Config, specs: Adapter['review']['identity']) {
  try {
    await exact(page, specs.account, c.account.expectedIdentifier);
  } catch { throw new WorkflowError('ACCOUNT_MISMATCH', 'Account identity changed or could not be verified.', 3, 'blocked'); }
  try {
    await exact(page, specs.jobId, c.target.jobId);
    await exact(page, specs.title, c.target.expectedTitle);
    await exact(page, specs.employer, c.target.expectedEmployer);
  } catch { throw new WorkflowError('TARGET_MISMATCH', 'Job ID, title or employer does not match the approved target.', 4, 'blocked'); }
}
export class NavigationGuard {
  fault?: WorkflowError;
  expired = false;
  constructor(private c: Config, private allowLogin = false) {}
  async install(context: BrowserContext) {
    await context.route('**/*', async route => {
      if (route.request().isNavigationRequest()) {
        const origin = new URL(route.request().url()).origin;
        if (!this.c.allowedOrigins.includes(origin)) {
          if (this.c.authenticationOrigins.includes(origin)) {
            if (this.allowLogin) return route.continue();
            this.fault = new WorkflowError('AUTH_REQUIRED', 'Session redirected to login. Refresh authentication.', 3, 'blocked');
          } else {
            this.fault = new WorkflowError('EXTERNAL_FLOW', `Unsupported navigation to origin ${origin}.`, 5, 'blocked');
          }
          return route.abort('blockedbyclient');
        }
      }
      await route.continue();
    });
  }
  check() {
    if (this.fault) throw this.fault;
    if (this.expired) throw new WorkflowError('RUN_TIMEOUT', 'Run time limit reached. Inspect retained diagnostics.');
  }
  checkPage(page: Page) {
    this.check();
    if (!this.c.allowedOrigins.includes(new URL(page.url()).origin)) throw new WorkflowError('EXTERNAL_FLOW', 'Application page is outside allowed origins.', 5, 'blocked');
  }
}
