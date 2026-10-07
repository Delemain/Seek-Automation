import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { WorkflowError } from './errors.js';
import type { Config } from './config.js';

export type Entry = { key: string; runId: string; state: 'submission_attempted' | 'submission_uncertain' | 'confirmed';
  createdAt: string; updatedAt: string; documentHashes: string[]; confirmation?: string; reconciledAt?: string };
export function accountReference(c: Config): string { return createHash('sha256').update(c.account.expectedIdentifier.trim().toLowerCase()).digest('hex'); }
export function ledgerKey(c: Config): string {
  return createHash('sha256').update(JSON.stringify([c.environment, accountReference(c), c.target.jobId])).digest('hex');
}
export async function atomicJson(file: string, data: unknown) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomUUID()}.tmp`;
  const handle = await open(tmp, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(data, null, 2)); await handle.sync(); }
  finally { await handle.close(); }
  try { await rename(tmp, file); } finally { await rm(tmp, { force: true }); }
}
export class Ledger {
  readonly key: string;
  readonly entryPath: string;
  readonly lockPath: string;
  private locked = false;
  constructor(readonly config: Config) {
    this.key = ledgerKey(config);
    this.entryPath = path.join(config.ledgerPath, this.key + '.json');
    this.lockPath = path.join(config.ledgerPath, this.key + '.lock');
  }
  async acquire(runId: string) {
    await mkdir(this.config.ledgerPath, { recursive: true, mode: 0o700 });
    try {
      const f = await open(this.lockPath, 'wx', 0o600);
      this.locked = true;
      try { await f.writeFile(JSON.stringify({ runId, pid: process.pid, createdAt: new Date().toISOString() })); await f.sync(); }
      finally { await f.close(); }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new WorkflowError('LOCKED', 'Account/job is locked. See stale-lock recovery in README; do not delete a live lock.', 8, 'blocked');
      throw e;
    }
  }
  async read(): Promise<Entry | undefined> {
    try {
      const e = JSON.parse(await readFile(this.entryPath, 'utf8')) as Entry;
      if (e.key !== this.key || !['submission_attempted', 'submission_uncertain', 'confirmed'].includes(e.state) || !e.runId) throw Error('Invalid ledger');
      return e;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new WorkflowError('LEDGER_INVALID', 'Ledger is unreadable or corrupt; reconcile it before continuing.', 8, 'blocked');
    }
  }
  async ensureUnused() {
    const e = await this.read();
    if (e) throw new WorkflowError('DUPLICATE_REFUSED', `Existing ${e.state} record. Reconcile application history; no new submission is allowed.`, 8, e.state === 'confirmed' ? 'already_applied' : 'blocked');
  }
  async write(entry: Entry) {
    if (!this.locked) throw Error('Ledger writes require its lock');
    await atomicJson(this.entryPath, entry);
  }
  async release() { if (this.locked) { await rm(this.lockPath); this.locked = false; } }
}
