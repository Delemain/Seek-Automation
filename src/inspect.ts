import { Command } from 'commander';
import { chromium } from '@playwright/test';
import { createInterface } from 'node:readline/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { WorkflowError, invalid } from './errors.js';
import { atomicJson } from './submission-ledger.js';
import { launchOptions, validateCdpEndpoint } from './reporting.js';
import { observedJob } from './pages/seek-public-page.js';
import { captureControls } from './inspection.js';

const cli = new Command().name('inspect-seek')
  .description('Open an isolated SEEK browser for operator login and manual UI inspection. This is setup, not an automated application test.')
  .option('--allow-origin <origin>', 'Additional exact HTTPS origin for an observed login redirect (repeatable)', (v, previous: string[]) => [...previous, v], [])
  .option('--output <directory>', 'Private structural snapshot directory', '.inspection')
  .option('--connect-cdp <url>', 'Use the current SEEK tab in a manually signed-in dedicated local Chrome profile')
  .option('--page <kind>', 'Attach to the Quick apply or search tab (application|search)', 'application')
  .action(async options => {
    if (!process.stdin.isTTY) throw new WorkflowError('INTERACTIVE_LOGIN_REQUIRED', 'Run npm run inspect:seek in PowerShell or a graphical terminal on your PC.', 3, 'blocked');
    if (!['application', 'search'].includes(options.page)) invalid('--page must be application or search.');
    if (options.page === 'search' && !options.connectCdp) invalid('--page search requires --connect-cdp.');
    const allowed = new Set(['https://au.seek.com','https://www.seek.com.au','https://login.seek.com']);
    for (const value of options.allowOrigin as string[]) {
      let url: URL;
      try { url = new URL(value); } catch { invalid('--allow-origin must be an exact HTTPS origin.'); }
      if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) invalid('--allow-origin must be an exact HTTPS origin.');
      allowed.add(value);
    }
    const cdpEndpoint = options.connectCdp ? validateCdpEndpoint(options.connectCdp) : undefined;
    let browser;
    try { browser = cdpEndpoint ? await chromium.connectOverCDP(cdpEndpoint) : await chromium.launch(launchOptions(true)); }
    catch { throw new WorkflowError(cdpEndpoint ? 'CDP_CONNECTION_FAILED' : 'BROWSER_LAUNCH_FAILED', cdpEndpoint ? 'Cannot connect to the dedicated local Chrome profile. Start it with its remote-debugging port and sign in first.' : 'Cannot launch Chromium for inspection.', 3, 'blocked'); }
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    const runDirectory = path.resolve(options.output, randomUUID());
    let activePage;
    try {
      const context = cdpEndpoint ? browser.contexts()[0] : await browser.newContext({ serviceWorkers: 'block' });
      if (!context) throw new WorkflowError('CDP_CONTEXT_MISSING', 'The local Chrome profile has no available browser context.', 3, 'blocked');
      const reported = new Set<string>();
      if (!cdpEndpoint) await context.route('**/*', async route => {
          const origin = new URL(route.request().url()).origin;
          if (route.request().isNavigationRequest() && !allowed.has(origin)) {
            if (!reported.has(origin)) { console.log(`Navigation stopped at ${origin}. Only add --allow-origin if this is an approved login destination.`); reported.add(origin); }
            return route.abort('blockedbyclient');
          }
          await route.continue();
        });
      const candidates = cdpEndpoint ? context.pages().filter(candidate => {
            try {
              const location = new URL(candidate.url());
              if (!['https://au.seek.com', 'https://www.seek.com.au'].includes(location.origin)) return false;
              return options.page === 'search'
                ? location.pathname === '/' || location.pathname === '/jobs' || location.pathname.startsWith('/jobs/') || /-jobs(?:\/|$)/i.test(location.pathname)
                : location.pathname === `/job/${observedJob.id}/apply` || location.pathname.startsWith(`/job/${observedJob.id}/apply/`);
            }
            catch { return false; }
          }) : [];
      if (candidates.length > 1) throw new WorkflowError('AMBIGUOUS_INSPECTION_TAB', 'Close other matching SEEK tabs in the dedicated Chrome profile and retry.', 3, 'blocked');
      const page = cdpEndpoint ? candidates[0] : await context.newPage();
      activePage = page;
      context.on('page', popup => { activePage = popup; });
      if (cdpEndpoint) {
        if (!activePage) throw new WorkflowError('INSPECTION_TAB_NOT_FOUND', options.page === 'search'
          ? 'Open one SEEK search tab in the dedicated Chrome window, then run this command again.'
          : `Open Quick apply for job ${observedJob.id} in the dedicated Chrome window, then run this command again.`, 3, 'blocked');
        console.log(options.page === 'search' ? 'Attached to the existing SEEK search tab.' : `Attached to the existing Quick apply tab for ${observedJob.title} at ${observedJob.employer}.`);
      } else {
        const inspectionPage = activePage!;
        await inspectionPage.goto(observedJob.url, { waitUntil: 'domcontentloaded' });
        console.log(`Opened ${observedJob.title} at ${observedJob.employer} (${observedJob.id}).`);
        console.log('Sign into SEEK in this browser, then open Quick apply. Do not click final Submit.');
      }
      console.log('This helper never fills fields, uploads documents, or clicks buttons. Your manual actions can still save a draft or upload files.');
      console.log(options.page === 'search'
        ? 'Press Enter on the search form, then search manually and press Enter again on the results. Type q to close.'
        : 'When an application step is visible, return here and press Enter to capture its field labels. Repeat for other steps; type q to close.');
      let index = 0;
      while (true) {
        const answer = await terminal.question('Enter = capture current application step; q = finish: ');
        if (answer.trim().toLowerCase() === 'q') break;
        if (!activePage || activePage.isClosed()) { console.log('The browser page is closed. Restart inspection.'); break; }
        if (!['https://au.seek.com', 'https://www.seek.com.au'].includes(new URL(activePage.url()).origin)) {
          console.log('Finish login and return to SEEK before capturing.'); continue;
        }
        try {
          const snapshot = await captureControls(activePage);
          const file = path.join(runDirectory, `step-${String(++index).padStart(2,'0')}.json`);
          await atomicJson(file, snapshot);
          console.log(`Saved control labels and structural landmarks to ${file}. Review the file before sharing; labels or button text can contain account names.`);
        } catch(e) {
          if (e instanceof WorkflowError) console.log(e.message);
          else console.log('Could not capture this page. Wait until the application step is visible, then try again.');
        }
      }
      console.log('Inspection ended. No authenticated session file was saved. This was not a prepared or submitted application result.');
    } finally { terminal.close(); if (!cdpEndpoint) await browser.close(); }
  });
try { await cli.parseAsync(); }
catch(e) {
  console.error(e instanceof WorkflowError ? e.message : 'Inspection could not start. Install Chromium with npx playwright install chromium and run from a graphical terminal.');
  process.exitCode = e instanceof WorkflowError ? e.exitCode : 6;
}
