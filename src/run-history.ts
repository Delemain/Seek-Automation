import { mkdir, open, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { atomicJson } from './submission-ledger.js';
import { WorkflowError } from './errors.js';
import type { ScreeningPageAudit } from './pages/screening-audit.js';

export type RunHistoryJob = { jobId: string; title: string; employer: string; seekUrl: string; status: 'ready_to_submit' | 'skipped'; reason?: { code: string; message: string }; screeningAudit?: ScreeningPageAudit[] };
export type RunHistoryEntry = {
  runId: string; requestedAt: string; completedAt?: string;
  request: { command: 'batch-prepare'; searchText: string; location: string; limit: number }
    | { command: 'prepare-one'; jobId: string; title: string; employer: string };
  foundJobs: Array<{ jobId: string; title: string; employer: string; seekUrl: string }>;
  jobs: RunHistoryJob[];
  status: 'running' | 'completed' | 'cancelled' | 'failed'; failure?: { code: string; message: string };
};
type HistoryFile = { version: 1; runs: RunHistoryEntry[] };

export class RunHistory {
  private lock?: string;
  constructor(private file: string) {}
  private async read(): Promise<HistoryFile> {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as HistoryFile;
      if (parsed.version !== 1 || !Array.isArray(parsed.runs)) throw Error('invalid');
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, runs: [] };
      throw new WorkflowError('RUN_HISTORY_INVALID', 'Run history is unreadable or corrupt; preserve it and choose a new private history path.', 2, 'blocked');
    }
  }
  async acquire() {
    this.lock = this.file + '.lock';
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    try { await open(this.lock, 'wx', 0o600).then(handle => handle.close()); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new WorkflowError('RUN_HISTORY_LOCKED', 'Another batch run is updating the private run history.', 8, 'blocked');
      throw error;
    }
  }
  async append(entry: RunHistoryEntry) {
    const history = await this.read();
    history.runs.push(entry);
    await atomicJson(this.file, history);
  }
  async update(runId: string, update: (entry: RunHistoryEntry) => void) {
    const history = await this.read();
    const entry = history.runs.find(item => item.runId === runId);
    if (!entry) throw new WorkflowError('RUN_HISTORY_MISSING', 'The active batch run is missing from private history.', 6, 'failed');
    update(entry);
    await atomicJson(this.file, history);
  }
  async release() { if (this.lock) { await rm(this.lock, { force: true }); this.lock = undefined; } }
  get path() { return path.resolve(this.file); }
}
