import { Command } from 'commander';
import { loadConfig } from './config.js';
import { runWorkflow } from './reporting.js';
import { authenticate } from './auth.js';
import { WorkflowError, invalid } from './errors.js';
import { validateCdpEndpoint } from './reporting.js';
import { loadBatchAdapter, runBatchPrepare } from './batch.js';
import path from 'node:path';

const cli = new Command().name('seek-test').description('Single-job SEEK production UI test runner. Prepare mode is the default.').version('0.1.0');
for (const command of ['validate', 'auth', 'apply', 'reconcile'] as const) {
  cli.command(command)
    .description({ validate: 'Validate config, adapter and documents without opening a browser or using the network.', auth: 'Interactively log in and verify the designated account.', apply: 'Search, prepare or submit one configured test application.', reconcile: 'Read application history and reconcile a previous attempt; never submit.' }[command])
    .requiredOption('-c, --config <path>', 'Configuration JSON file')
    .option('--query <keywords>', 'Override search keywords')
    .option('--location <location>', 'Override search location')
    .option('--mode <mode>', 'prepare or submit')
    .option('--headless', 'Run Chromium headlessly (auth always uses a headed browser)')
    .option('--connect-cdp <url>', 'Attach to a manually signed-in dedicated local Chrome profile')
    .action(async (options) => {
      if (options.mode && !['prepare', 'submit'].includes(options.mode)) invalid('--mode must be prepare or submit');
      if (options.connectCdp) validateCdpEndpoint(options.connectCdp);
      const loaded = await loadConfig(options.config, { query: options.query, location: options.location, mode: options.mode, headed: options.headless ? false : undefined });
      if (command === 'validate') { console.log('Configuration, observed adapter and both document files passed offline preflight. No browser or network was used.'); return; }
      if (command === 'auth') { await authenticate(loaded, { cdpEndpoint: options.connectCdp }); return; }
      const result = await runWorkflow(loaded, command === 'reconcile' ? 'reconcile' : 'apply', async (name, action) => { console.log(name); return action(); }, { cdpEndpoint: options.connectCdp });
      console.log(`${result.status} [${result.code}]: ${result.message}\nResult: ${result.artifacts.result}`);
      process.exitCode = result.exitCode;
    });
}
cli.command('batch-prepare [search]')
  .description('Search for the supplied text, find five visible SEEK jobs without an explicit Applied marker, ask for terminal confirmation, then prepare each without submitting.')
  .requiredOption('-c, --config <path>', 'Configuration JSON file')
  .requiredOption('--connect-cdp <url>', 'Attach to a manually signed-in dedicated local Chrome profile')
  .option('--query <keywords>', 'Override search keywords')
  .option('--location <location>', 'Override search location')
  .option('--batch-adapter <path>', 'Observed batch adapter', 'config/seek.batch.prepare.candidate.json')
  .action(async (search, options) => {
    validateCdpEndpoint(options.connectCdp);
    const loaded = await loadConfig(options.config, { query: search ?? options.query, location: options.location, mode: 'prepare' });
    const adapter = await loadBatchAdapter(path.resolve(options.batchAdapter));
    const result = await runBatchPrepare(loaded, adapter, options.connectCdp);
    console.log(`Batch result: ${result.artifact}`);
  });
cli.command('prepare-one <jobId>')
  .description('Prepare one exact SEEK Quick Apply job, including supported screening pages; never submit.')
  .requiredOption('-c, --config <path>', 'Configuration JSON file')
  .requiredOption('--connect-cdp <url>', 'Attach to a manually signed-in dedicated local Chrome profile')
  .requiredOption('--title <title>', 'Exact job title shown on SEEK')
  .requiredOption('--employer <employer>', 'Exact employer shown on SEEK')
  .option('--adapter <path>', 'Observed generic Quick Apply adapter', 'config/seek.batch.prepare.candidate.json')
  .action(async (jobId, options) => {
    if (!/^\d+$/.test(jobId)) invalid('prepare-one requires a numeric SEEK job ID.');
    if (!options.title.trim() || !options.employer.trim()) invalid('Exact title and employer are required.');
    validateCdpEndpoint(options.connectCdp);
    const loaded = await loadConfig(options.config, { mode: 'prepare' });
    loaded.adapter = await loadBatchAdapter(path.resolve(options.adapter));
    loaded.config.target = { jobId, expectedTitle: options.title.trim(), expectedEmployer: options.employer.trim() };
    if (loaded.config.answers.length || loaded.config.applicant) invalid('prepare-one uses automatic screening; remove preconfigured applicant fields and answer mappings from this config.');
    const result = await runWorkflow(loaded, 'apply', async (name, action) => { console.log(name); return action(); },
      { cdpEndpoint: options.connectCdp, directJob: true, autoQuestions: true });
    console.log(`${result.status} [${result.code}]: ${result.message}\nResult: ${result.artifacts.result}`);
    process.exitCode = result.exitCode;
  });
try { await cli.parseAsync(); }
catch (e) {
  console.error(e instanceof WorkflowError ? `${e.code}: ${e.message}` : 'Execution failed. Check configuration, local permissions and browser installation.');
  process.exitCode = e instanceof WorkflowError ? e.exitCode : 6;
}
