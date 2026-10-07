import { z } from 'zod';
import { readFile, stat, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { invalid, WorkflowError } from './errors.js';

export const locatorSchema = z.object({
  by: z.enum(['role', 'label', 'testId', 'text', 'css']), value: z.string().min(1),
  role: z.string().optional(),
}).strict().refine(x => x.by !== 'role' || !!x.role, 'Role locators need a role');
const identitySchema = z.object({ account: locatorSchema, jobId: locatorSchema, title: locatorSchema, employer: locatorSchema }).strict();
const uploadSchema = z.object({ input: locatorSchema, completed: locatorSchema, filename: locatorSchema, error: locatorSchema.optional() }).strict();
export const adapterSchema = z.object({
  kind: z.enum(['fixture', 'observed']),
  observedAt: z.string().min(1), evidence: z.string().min(1),
  auth: z.object({ url: z.string(), ready: locatorSchema, account: locatorSchema, loginRequired: locatorSchema, challenge: locatorSchema.optional() }).strict(),
  cookieAccept: locatorSchema.optional(),
  search: z.object({ ready: locatorSchema, query: locatorSchema, location: locatorSchema, submit: locatorSchema, results: locatorSchema,
    card: locatorSchema, cardJobIdAttribute: z.string().min(1), cardLink: locatorSchema, next: locatorSchema.optional() }).strict(),
  job: z.object({ ready: locatorSchema, identity: identitySchema, apply: locatorSchema, alreadyApplied: locatorSchema.optional() }).strict(),
  application: z.object({ ready: locatorSchema, jobId: locatorSchema, alreadyApplied: locatorSchema.optional(),
    steps: z.array(z.object({ name: z.string().min(1), ready: locatorSchema,
      uploads: z.object({ resume: uploadSchema, coverLetter: uploadSchema }).strict().optional(),
      fields: z.record(z.string(), locatorSchema).optional(),
      questionRegion: locatorSchema.optional(), requiredQuestions: locatorSchema.optional(),
      validationErrors: locatorSchema.optional(), next: locatorSchema,
    }).strict()).min(1),
  }).strict(),
  review: z.object({ ready: locatorSchema, identity: identitySchema, resume: locatorSchema, coverLetter: locatorSchema,
    answers: z.record(z.string(), locatorSchema), applicant: z.record(z.string(), locatorSchema), submit: locatorSchema }).strict(),
  confirmation: z.object({ ready: locatorSchema, jobId: locatorSchema, reference: locatorSchema }).strict(),
  history: z.object({ url: z.string(), ready: locatorSchema, entry: locatorSchema, jobIdAttribute: z.string(), reference: locatorSchema }).strict(),
}).strict();

const configSchema = z.object({
  environment: z.enum(['production', 'fixture']).default('production'),
  baseUrl: z.string().url().default('https://www.seek.com.au'),
  allowedOrigins: z.array(z.string().url()).min(1),
  authenticationOrigins: z.array(z.string().url()).default([]),
  adapterPath: z.string().min(1), query: z.string().min(1), location: z.string().min(1),
  target: z.object({ jobId: z.string().min(1), expectedTitle: z.string().min(1), expectedEmployer: z.string().min(1) }).strict(),
  account: z.object({ expectedIdentifier: z.string().min(1), storageStatePath: z.string().min(1) }).strict(),
  documents: z.object({ resumePath: z.string().min(1), coverLetterPath: z.string().min(1),
    allowedExtensions: z.array(z.enum(['.doc', '.docx', '.pdf'])).min(1).default(['.doc', '.docx', '.pdf']),
    maxBytes: z.number().int().positive().max(100_000_000).default(5_000_000),
  }).strict(),
  applicant: z.object({ firstName: z.string().min(1), lastName: z.string().min(1), email: z.string().email(), phone: z.string().min(1) }).strict(),
  answers: z.array(z.object({ id: z.string().min(1), locator: locatorSchema,
    type: z.enum(['text', 'radio', 'select', 'checkbox', 'multi-select']),
    value: z.union([z.string(), z.boolean(), z.array(z.string())]),
  }).strict().superRefine((a, ctx) => {
    const ok = a.type === 'checkbox' ? typeof a.value === 'boolean' : a.type === 'multi-select' ? Array.isArray(a.value) : typeof a.value === 'string';
    if (!ok) ctx.addIssue({ code: 'custom', message: 'Answer value does not match its control type' });
  })).default([]),
  mode: z.enum(['prepare', 'submit']).default('prepare'), headed: z.boolean().default(true),
  maxSearchPages: z.number().int().min(1).max(100).default(5),
  stepTimeoutMs: z.number().int().min(100).max(120000).default(15000),
  runTimeoutMs: z.number().int().min(1000).max(1800000).default(180000),
  artifactsDirectory: z.string().default('../artifacts'), ledgerPath: z.string().default('../private-state/submissions'),
  retainSuccessEvidence: z.boolean().default(false),
}).strict();
export type Config = z.infer<typeof configSchema>;
export type Adapter = z.infer<typeof adapterSchema>;
export type LocatorSpec = z.infer<typeof locatorSchema>;
export type DocumentInfo = { filename: string; sha256: string; bytes: number; path: string };
export type Loaded = { config: Config; adapter: Adapter; documents: { resume: DocumentInfo; coverLetter: DocumentInfo } };
export type Overrides = Partial<Pick<Config, 'query' | 'location' | 'mode' | 'headed'>>;

function resolveFile(base: string, value: string): string {
  if (process.platform !== 'win32' && path.win32.isAbsolute(value)) invalid('Windows file paths are only usable on Windows. Copy documents to this machine and configure their local paths.');
  return path.resolve(base, value);
}
export async function documentInfo(file: string, c: Config['documents']): Promise<DocumentInfo> {
  try {
    const s = await stat(file);
    if (!s.isFile()) invalid('A document path is not a regular file.');
    if (!c.allowedExtensions.includes(path.extname(file).toLowerCase() as '.doc')) invalid('Document extension is not permitted.');
    if (!s.size || s.size > c.maxBytes) invalid('Document is empty or exceeds the configured size limit.');
    await access(file, constants.R_OK);
    const content = await readFile(file);
    return { filename: path.basename(file), sha256: createHash('sha256').update(content).digest('hex'), bytes: content.length, path: file };
  } catch (e) {
    if (e instanceof WorkflowError) throw e;
    invalid(`Document preflight failed (${(e as NodeJS.ErrnoException).code ?? 'unreadable'}). Check file paths, type, size and permissions.`);
  }
}
export async function loadConfig(file: string, overrides: Overrides = {}): Promise<Loaded> {
  let raw: unknown;
  try { raw = JSON.parse(await readFile(file, 'utf8')); } catch { invalid('Cannot read configuration JSON.'); }
  const parsed = configSchema.safeParse({ ...(raw as object), ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined)) });
  if (!parsed.success) invalid('Invalid configuration fields: ' + parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  const c = parsed.data;
  if (c.environment === 'production' && /REPLACE|PLACEHOLDER|CHANGE_ME/i.test(JSON.stringify(c))) invalid('Replace all example values before a production run.');
  const origins = [...c.allowedOrigins, ...c.authenticationOrigins];
  for (const origin of origins) {
    const u = new URL(origin);
    if (u.origin !== origin || u.username || u.password) invalid('Allowed origins must be exact origins without paths, query strings or credentials.');
    if (c.environment === 'production' && u.protocol !== 'https:') invalid('Production requires HTTPS.');
    if (c.environment === 'fixture' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) invalid('Fixture mode is restricted to loopback hosts.');
  }
  const base = new URL(c.baseUrl);
  if (!c.allowedOrigins.includes(base.origin) || base.username || base.password) invalid('baseUrl must use an allowed application origin and no credentials.');
  if (c.environment === 'production' && !['www.seek.com.au', 'au.seek.com'].includes(base.hostname)) invalid('Production baseUrl must be a SEEK origin.');
  if (new Set(c.answers.map(a => a.id)).size !== c.answers.length) invalid('Answer IDs must be unique.');
  const dir = path.dirname(path.resolve(file));
  c.adapterPath = resolveFile(dir, c.adapterPath);
  c.account.storageStatePath = resolveFile(dir, c.account.storageStatePath);
  c.documents.resumePath = resolveFile(dir, c.documents.resumePath);
  c.documents.coverLetterPath = resolveFile(dir, c.documents.coverLetterPath);
  c.artifactsDirectory = resolveFile(dir, c.artifactsDirectory);
  c.ledgerPath = resolveFile(dir, c.ledgerPath);
  let a: Adapter;
  try { a = adapterSchema.parse(JSON.parse(await readFile(c.adapterPath, 'utf8'))); }
  catch { invalid('Missing or invalid UI adapter. Production requires a profile based on inspected SEEK UI; see docs/ADAPTERS.md.'); }
  if (c.environment === 'production' && a.kind !== 'observed') invalid('Fixture selectors cannot be used in production.');
  for (const [url, permitted] of [[a.auth.url, origins], [a.history.url, c.allowedOrigins]] as const) {
    if (!permitted.includes(new URL(url, c.baseUrl).origin)) invalid('Adapter URL is outside configured origins.');
  }
  if (a.application.steps.filter(s => s.uploads).length !== 1) invalid('Adapter must have one explicit upload step for both documents.');
  for (const answer of c.answers) if (!a.review.answers[answer.id]) invalid(`Missing review evidence for answer ${answer.id}.`);
  for (const key of Object.keys(c.applicant)) if (!a.review.applicant[key]) invalid(`Missing review evidence for applicant field ${key}.`);
  const [resume, coverLetter] = await Promise.all([documentInfo(c.documents.resumePath, c.documents), documentInfo(c.documents.coverLetterPath, c.documents)]);
  return { config: c, adapter: a, documents: { resume, coverLetter } };
}
