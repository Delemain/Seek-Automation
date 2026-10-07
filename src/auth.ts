import { chromium } from '@playwright/test';
import { createInterface } from 'node:readline/promises';
import type { Loaded } from './config.js';
import { launchOptions } from './reporting.js';
import { assertions, configureContext, NavigationGuard, unique } from './pages/ui.js';
import { atomicJson } from './submission-ledger.js';
import { WorkflowError } from './errors.js';

export async function authenticate({ config: c, adapter: a }: Loaded) {
  if (!process.stdin.isTTY) throw new WorkflowError('INTERACTIVE_LOGIN_REQUIRED', 'Run auth in an interactive terminal with a graphical browser. Passwords/MFA are entered only into SEEK.', 3, 'blocked');
  const browser = await chromium.launch(launchOptions(true));
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    configureContext(context, c.stepTimeoutMs);
    const guard = new NavigationGuard(c, true); await guard.install(context);
    const page = await context.newPage();
    const expect = assertions(page);
    await page.goto(new URL(a.auth.url, c.baseUrl).href, { waitUntil: 'domcontentloaded' });
    await terminal.question('Complete SEEK login/MFA in the isolated browser, then press Enter here. ');
    guard.checkPage(page);
    try {
      await expect(await unique(page, a.auth.ready)).toBeVisible();
      await expect(await unique(page, a.auth.account)).toHaveText(c.account.expectedIdentifier);
    } catch { throw new WorkflowError('ACCOUNT_MISMATCH', 'Expected account was not verified. No session state was saved.', 3, 'blocked'); }
    await atomicJson(c.account.storageStatePath, await context.storageState({ indexedDB: true }));
    console.log('Verified isolated session saved privately.');
  } finally { terminal.close(); await browser.close(); }
}
