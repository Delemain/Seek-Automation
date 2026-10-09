import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { createInterface } from 'node:readline/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import { adapterSchema, type Adapter, type Loaded } from './config.js';
import { WorkflowError } from './errors.js';
import { atomicJson } from './submission-ledger.js';
import { RunHistory, type RunHistoryEntry } from './run-history.js';
import { validateCdpEndpoint } from './reporting.js';
import { checkAuthentication, configureContext, locate, unique, visible, NavigationGuard } from './pages/ui.js';
import { startApplication } from './pages/job-page.js';
import { completeApplication } from './pages/application-page.js';

export type BatchCandidate = { jobId: string; title: string; employer: string; url: string };
export type BatchItem = BatchCandidate & { status: 'ready' | 'skipped'; code?: string; message?: string };
export type BatchResult = { runId: string; query: string; location: string; candidates: BatchItem[]; artifact: string; history: string };

export async function loadBatchAdapter(file: string): Promise<Adapter> {
  try {
    const adapter = adapterSchema.parse(JSON.parse(await readFile(file, 'utf8')));
    if (adapter.kind !== 'observed' || !adapter.search.cardTitle || !adapter.search.cardEmployer)
      throw Error('not a batch adapter');
    return adapter;
  } catch {
    throw new WorkflowError('INVALID_BATCH_ADAPTER', 'Batch adapter is missing observed title/employer card mappings.', 2, 'blocked');
  }
}

/** A card is skipped only when SEEK visibly marks that card as Applied. */
export function hasExplicitAppliedMarker(text: string) { return /\bapplied\b/i.test(text); }

export async function discoverBatchCandidates(page: Page, loaded: Loaded, adapter: Adapter, guard: NavigationGuard, limit: number): Promise<BatchCandidate[]> {
  const { config: c } = loaded;
  await page.goto(c.baseUrl, { waitUntil: 'domcontentloaded' });
  guard.checkPage(page);
  await checkAuthentication(page, c, adapter);
  await (await unique(page, adapter.search.query)).fill(c.query);
  await (await unique(page, adapter.search.location)).fill(c.location);
  await (await unique(page, adapter.search.submit)).click();
  await locate(page, adapter.search.results).first().waitFor({ state: 'visible' });
  const candidates: BatchCandidate[] = [];
  for (const card of await locate(page, adapter.search.card).all()) {
    if (candidates.length === limit) break;
    const jobId = await card.getAttribute(adapter.search.cardJobIdAttribute);
    if (!jobId || candidates.some(candidate => candidate.jobId === jobId)) continue;
    if (hasExplicitAppliedMarker(await card.innerText())) continue;
    const link = await unique(card, adapter.search.cardLink);
    const href = await link.getAttribute('href');
    if (!href) continue;
    const url = new URL(href, page.url());
    if (!c.allowedOrigins.includes(url.origin) || url.pathname !== `/job/${encodeURIComponent(jobId)}`) continue;
    const title = (await (await unique(card, adapter.search.cardTitle!)).innerText()).trim();
    const employer = (await (await unique(card, adapter.search.cardEmployer!)).innerText()).trim();
    if (title && employer) candidates.push({ jobId, title, employer, url: url.origin + url.pathname });
  }
  return candidates;
}

function jobLoaded(loaded: Loaded, adapter: Adapter, candidate: BatchCandidate): Loaded {
  return { ...loaded, adapter, config: { ...loaded.config, mode: 'prepare', target: { jobId: candidate.jobId, expectedTitle: candidate.title, expectedEmployer: candidate.employer } } };
}

export async function confirmBatch(candidates: BatchCandidate[]): Promise<boolean> {
  if (!process.stdin.isTTY) throw new WorkflowError('INTERACTIVE_CONFIRMATION_REQUIRED', 'Batch prepare requires an interactive terminal confirmation.', 3, 'blocked');
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await terminal.question(`Type PREPARE ${candidates.length} to prepare these jobs without submitting: `);
    return answer.trim() === `PREPARE ${candidates.length}`;
  } finally { terminal.close(); }
}

export async function runBatchPrepare(loaded: Loaded, batchAdapter: Adapter, cdpEndpoint: string, confirm: (candidates: BatchCandidate[]) => Promise<boolean> = confirmBatch): Promise<BatchResult> {
  if (loaded.config.mode !== 'prepare') throw new WorkflowError('BATCH_PREPARE_ONLY', 'Batch workflow supports prepare mode only; it never submits.', 2, 'blocked');
  const runId = randomUUID();
  const directory = path.join(loaded.config.artifactsDirectory, `batch-${runId}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const artifact = path.join(directory, 'batch-result.json');
  const history = new RunHistory(loaded.config.runHistoryPath);
  const result: BatchResult = { runId, query: loaded.config.query, location: loaded.config.location, candidates: [], artifact, history: history.path };
  const entry: RunHistoryEntry = { runId, requestedAt: new Date().toISOString(), request: { command: 'batch-prepare', searchText: loaded.config.query, location: loaded.config.location, limit: 5 }, foundJobs: [], jobs: [], status: 'running' };
  let discoveryPage: Page | undefined;
  const pages: Array<{ candidate: BatchCandidate; page: Page }> = [];
  try {
    await history.acquire();
    await history.append(entry);
    const endpoint = validateCdpEndpoint(cdpEndpoint);
    let browser;
    try { browser = await chromium.connectOverCDP(endpoint); }
    catch { throw new WorkflowError('CDP_CONNECTION_FAILED', 'Cannot connect to the dedicated local Chrome profile. Start it with port 9222 and sign in first.', 3, 'blocked'); }
    const context = browser.contexts()[0] as BrowserContext | undefined;
    if (!context) throw new WorkflowError('CDP_CONTEXT_MISSING', 'The dedicated Chrome profile has no browser context.', 3, 'blocked');
    configureContext(context, loaded.config.stepTimeoutMs);
    const guard = new NavigationGuard(loaded.config);
    discoveryPage = await context.newPage();
    await guard.installPage(discoveryPage);
    const candidates = await discoverBatchCandidates(discoveryPage, loaded, batchAdapter, guard, 5);
    console.log('Found jobs without an explicit Applied marker:');
    for (const [index, candidate] of candidates.entries()) console.log(`${index + 1}. ${candidate.title} — ${candidate.employer} (${candidate.jobId})`);
    await history.update(runId, record => { record.foundJobs = candidates.map(candidate => ({ jobId: candidate.jobId, title: candidate.title, employer: candidate.employer, seekUrl: candidate.url })); });
    if (candidates.length !== 5) throw new WorkflowError('BATCH_INSUFFICIENT_CANDIDATES', `Found ${candidates.length} eligible visible jobs; five are required before batch prepare starts.`, 4, 'blocked');
    if (!await confirm(candidates)) throw new WorkflowError('BATCH_CANCELLED', 'Batch preparation was cancelled. No documents were uploaded.', 0, 'blocked');
    for (const candidate of candidates) {
      const page = await context.newPage();
      await guard.installPage(page);
      await page.goto(candidate.url, { waitUntil: 'commit' });
      guard.checkPage(page);
      pages.push({ candidate, page });
    }
    await discoveryPage.close(); discoveryPage = undefined;
    for (const entry of pages) {
      let active = entry.page;
      try {
        const job = jobLoaded(loaded, batchAdapter, entry.candidate);
        await checkAuthentication(active, job.config, job.adapter);
        active = await startApplication(active, job, guard);
        await completeApplication(active, job, guard, true);
        result.candidates.push({ ...entry.candidate, status: 'ready' });
      } catch (error) {
        const e = error instanceof WorkflowError ? error : new WorkflowError('WORKFLOW_FAILED', 'Form did not match the observed batch workflow.');
        result.candidates.push({ ...entry.candidate, status: 'skipped', code: e.code, message: e.message });
      } finally {
        if (active !== entry.page) await entry.page.close().catch(() => {});
        await active.close().catch(() => {});
      }
      await history.update(runId, record => { record.jobs = result.candidates.map(item => ({ jobId: item.jobId, title: item.title, employer: item.employer, seekUrl: item.url, status: item.status === 'ready' ? 'ready_to_submit' : 'skipped', ...(item.code ? { reason: { code: item.code, message: item.message! } } : {}) })); });
    }
    await history.update(runId, record => { record.status = 'completed'; record.completedAt = new Date().toISOString(); });
  } catch (error) {
    const e = error instanceof WorkflowError ? error : new WorkflowError('WORKFLOW_FAILED', 'Batch workflow failed before completion.');
    await history.update(runId, record => {
      record.jobs = result.candidates.map(item => ({ jobId: item.jobId, title: item.title, employer: item.employer, seekUrl: item.url, status: item.status === 'ready' ? 'ready_to_submit' : 'skipped', ...(item.code ? { reason: { code: item.code, message: item.message! } } : {}) }));
      record.status = e.code === 'BATCH_CANCELLED' ? 'cancelled' : 'failed';
      record.failure = { code: e.code, message: e.message };
      record.completedAt = new Date().toISOString();
    }).catch(() => {});
    throw e;
  } finally {
    await discoveryPage?.close().catch(() => {});
    for (const { page } of pages) await page.close().catch(() => {});
    await atomicJson(artifact, result);
    await history.release().catch(() => {});
  }
  console.log('Ready to submit for jobs:');
  for (const item of result.candidates.filter(item => item.status === 'ready')) console.log(`- ${item.title} — ${item.employer} (${item.jobId})`);
  const skipped = result.candidates.filter(item => item.status === 'skipped');
  if (skipped.length) console.log(`Skipped ${skipped.length} job(s); review ${artifact} before any further action.`);
  return result;
}
