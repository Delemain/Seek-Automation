import { Command } from 'commander';
import { loadConfig } from './config.js';
import { runWorkflow } from './reporting.js';
import { authenticate } from './auth.js';
import { WorkflowError, invalid } from './errors.js';
import { validateCdpEndpoint } from './reporting.js';

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
try { await cli.parseAsync(); }
catch (e) {
  console.error(e instanceof WorkflowError ? `${e.code}: ${e.message}` : 'Execution failed. Check configuration, local permissions and browser installation.');
  process.exitCode = e instanceof WorkflowError ? e.exitCode : 6;
}
