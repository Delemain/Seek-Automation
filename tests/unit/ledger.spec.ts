import { test, expect } from '@playwright/test';
import { rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fixtureConfig } from '../fixtures/seek-fixture.js';
import { loadConfig } from '../../src/config.js';
import { Ledger, ledgerKey } from '../../src/submission-ledger.js';

test('exclusive lock rejects another OS process and unlock permits later work', async () => {
  const f = await fixtureConfig('http://127.0.0.1:1');
  const loaded = await loadConfig(f.file); const first = new Ledger(loaded.config);
  try {
    await first.acquire('first');
    const code = `import {loadConfig} from './src/config.ts'; import {Ledger} from './src/submission-ledger.ts'; const c=await loadConfig(process.argv[1]); const l=new Ledger(c.config); try {await l.acquire('second'); await l.release(); process.exitCode=1;} catch(e) {process.exitCode=e.exitCode;}`;
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code, f.file], { cwd: path.resolve('.'), stdio: 'ignore' });
      child.on('error', reject); child.on('exit', resolve);
    });
    expect(exitCode).toBe(8);
    await first.release();
    const next = new Ledger(loaded.config); await next.acquire('third'); await next.release();
  } finally { await first.release(); await rm(f.dir, { recursive: true, force: true }); }
});
test('attempted entries block new run IDs and corrupt ledgers fail closed', async () => {
  const f = await fixtureConfig('http://127.0.0.1:1');
  const loaded = await loadConfig(f.file); const ledger = new Ledger(loaded.config);
  try {
    await ledger.acquire('one');
    await ledger.write({ key: ledger.key, runId: 'one', state: 'submission_attempted', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), documentHashes: ['abc'] });
    await expect(ledger.ensureUnused()).rejects.toMatchObject({ code: 'DUPLICATE_REFUSED', exitCode: 8 });
    await writeFile(ledger.entryPath, '{invalid');
    await expect(ledger.ensureUnused()).rejects.toMatchObject({ code: 'LEDGER_INVALID', exitCode: 8 });
  } finally { await ledger.release(); await rm(f.dir, { recursive: true, force: true }); }
});
test('ledger key is stable across origin aliases and run inputs but separates environment/account/job', async () => {
  const f = await fixtureConfig('http://127.0.0.1:1');
  try {
    const { config: c } = await loadConfig(f.file); const key = ledgerKey(c);
    expect(ledgerKey({ ...c, query: 'other', baseUrl: 'http://localhost:2', mode: 'submit' })).toBe(key);
    expect(ledgerKey({ ...c, target: { ...c.target, jobId: 'other' } })).not.toBe(key);
    expect(ledgerKey({ ...c, environment: 'production' })).not.toBe(key);
    expect(ledgerKey({ ...c, account: { ...c.account, expectedIdentifier: 'other' } })).not.toBe(key);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
