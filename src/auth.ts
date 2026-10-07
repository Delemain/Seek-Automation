import { chromium } from '@playwright/test';
import { createInterface } from 'node:readline/promises';
import type { Loaded } from './config.js';
import { launchOptions, validateCdpEndpoint, type BrowserConnection } from './reporting.js';
import { assertions, configureContext, NavigationGuard, unique } from './pages/ui.js';
import { atomicJson } from './submission-ledger.js';
import { WorkflowError } from './errors.js';

export async function authenticate({ config: c, adapter: a }: Loaded, connection: BrowserConnection = {}) {
  const cdpEndpoint = connection.cdpEndpoint ? validateCdpEndpoint(connection.cdpEndpoint) : undefined;
  if (!cdpEndpoint && !process.stdin.isTTY) throw new WorkflowError('INTERACTIVE_LOGIN_REQUIRED', 'Run auth in an interactive terminal with a graphical browser. Passwords/MFA are entered only into SEEK.', 3, 'blocked');
  let browser;
  try { browser = cdpEndpoint ? await chromium.connectOverCDP(cdpEndpoint) : await chromium.launch(launchOptions(true)); }
  catch { throw new WorkflowError(cdpEndpoint ? 'CDP_CONNECTION_FAILED' : 'BROWSER_LAUNCH_FAILED', cdpEndpoint ? 'Cannot connect to the dedicated local Chrome profile. Start it, sign in, then retry.' : 'Cannot launch Chromium for interactive authentication.', 3, 'blocked'); }
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  let runnerPage;
  try {
    const context = cdpEndpoint ? browser.contexts()[0] : await browser.newContext({ serviceWorkers: 'block' });
    if (!context) throw new WorkflowError('CDP_CONTEXT_MISSING', 'The local Chrome profile has no available browser context.', 3, 'blocked');
    configureContext(context, c.stepTimeoutMs);
    const guard = new NavigationGuard(c, true);
    if (!cdpEndpoint) await guard.install(context);
    const page = await context.newPage();
    runnerPage = page;
    if (cdpEndpoint) await guard.installPage(page);
    const expect = assertions(page);
    await page.goto(new URL(a.auth.url, c.baseUrl).href, { waitUntil: 'domcontentloaded' });
    if (!cdpEndpoint) await terminal.question('Complete SEEK login/MFA in the isolated browser, then press Enter here. ');
    guard.checkPage(page);
    try {
      await expect(await unique(page, a.auth.ready)).toBeVisible();
      await expect(await unique(page, a.auth.account)).toHaveText(c.account.expectedIdentifier);
    } catch { throw new WorkflowError('ACCOUNT_MISMATCH', 'Expected account was not verified. No session state was saved.', 3, 'blocked'); }
    if (cdpEndpoint) console.log('Verified session in the dedicated Chrome profile. No cookies or storage state were copied or saved by this runner.');
    else { await atomicJson(c.account.storageStatePath, await context.storageState({ indexedDB: true })); console.log('Verified isolated session saved privately.'); }
  } finally { terminal.close(); await runnerPage?.close().catch(() => {}); if (!cdpEndpoint) await browser.close(); }
}
