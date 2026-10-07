import { Command } from 'commander';
import { chromium } from '@playwright/test';
import { createInterface } from 'node:readline/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { WorkflowError, invalid } from './errors.js';
import { atomicJson } from './submission-ledger.js';
import { launchOptions } from './reporting.js';
import { observedJob } from './pages/seek-public-page.js';
import { captureControls } from './inspection.js';

const cli = new Command().name('inspect-seek')
  .description('Open an isolated SEEK browser for operator login and manual UI inspection. This is setup, not an automated application test.')
  .option('--allow-origin <origin>', 'Additional exact HTTPS origin for an observed login redirect (repeatable)', (v, previous: string[]) => [...previous, v], [])
  .option('--output <directory>', 'Private structural snapshot directory', '.inspection')
  .action(async options => {
    if (!process.stdin.isTTY) throw new WorkflowError('INTERACTIVE_LOGIN_REQUIRED', 'Run npm run inspect:seek in PowerShell or a graphical terminal on your PC.', 3, 'blocked');
    const allowed = new Set(['https://au.seek.com','https://www.seek.com.au','https://login.seek.com']);
    for (const value of options.allowOrigin as string[]) {
      let url: URL;
      try { url = new URL(value); } catch { invalid('--allow-origin must be an exact HTTPS origin.'); }
      if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) invalid('--allow-origin must be an exact HTTPS origin.');
      allowed.add(value);
    }
    const browser = await chromium.launch(launchOptions(true));
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    const runDirectory = path.resolve(options.output, randomUUID());
    let activePage;
    try {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      const reported = new Set<string>();
      await context.route('**/*', async route => {
        const origin = new URL(route.request().url()).origin;
        if (route.request().isNavigationRequest() && !allowed.has(origin)) {
          if (!reported.has(origin)) { console.log(`Navigation stopped at ${origin}. Only add --allow-origin if this is an approved login destination.`); reported.add(origin); }
          return route.abort('blockedbyclient');
        }
        await route.continue();
      });
      const page = await context.newPage(); activePage = page;
      context.on('page', popup => { activePage = popup; });
      await page.goto(observedJob.url, { waitUntil: 'domcontentloaded' });
      console.log(`Opened ${observedJob.title} at ${observedJob.employer} (${observedJob.id}).`);
      console.log('Sign into SEEK in this browser, then open Quick apply. Do not click final Submit.');
      console.log('This helper never fills fields, uploads documents, or clicks buttons. Your manual actions can still save a draft or upload files.');
      console.log('When an application step is visible, return here and press Enter to capture its field labels. Repeat for other steps; type q to close.');
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
          console.log(`Saved control labels to ${file}. Review the file before sharing; labels or button text can contain account names.`);
        } catch(e) {
          if (e instanceof WorkflowError) console.log(e.message);
          else console.log('Could not capture this page. Wait until the application step is visible, then try again.');
        }
      }
      console.log('Inspection ended. No authenticated session file was saved. This was not a prepared or submitted application result.');
    } finally { terminal.close(); await browser.close(); }
  });
try { await cli.parseAsync(); }
catch(e) {
  console.error(e instanceof WorkflowError ? e.message : 'Inspection could not start. Install Chromium with npx playwright install chromium and run from a graphical terminal.');
  process.exitCode = e instanceof WorkflowError ? e.exitCode : 6;
}
