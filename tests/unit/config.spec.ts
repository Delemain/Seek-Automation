import { test, expect } from '@playwright/test';
import { mkdtemp, rm, writeFile, mkdir, chmod } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { loadConfig, documentInfo } from '../../src/config.js';
import { validateCdpEndpoint } from '../../src/reporting.js';
import { fixtureConfig } from '../fixtures/seek-fixture.js';

test('paths are relative to configuration, hashes match content, CLI values override file defaults', async () => {
  const f = await fixtureConfig('http://127.0.0.1:12345');
  try {
    const l = await loadConfig(f.file, { query: 'new query', location: 'Melbourne VIC', mode: 'submit', headed: true });
    expect(l.config.query).toBe('new query'); expect(l.config.location).toBe('Melbourne VIC');
    expect(l.config.mode).toBe('submit'); expect(l.config.headed).toBe(true);
    expect(l.config.documents.resumePath).toBe(path.join(f.dir, 'Resume.docx'));
    if (l.documents.resume.source !== 'local') throw new Error('Fixture résumé should be a local file');
    expect(l.documents.resume.sha256).toHaveLength(64);
    expect(l.documents.resume.sha256).not.toBe(l.documents.coverLetter.sha256);
    expect(l.config.maxSearchPages).toBe(5);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
test('an empty search location is valid for a name-only search', async () => {
  const f = await fixtureConfig('http://127.0.0.1:12345');
  try { expect((await loadConfig(f.file, { location: '' })).config.location).toBe(''); }
  finally { await rm(f.dir, { recursive: true, force: true }); }
});
test('validation CLI works from another directory, without a browser or reachable server', async () => {
  const f = await fixtureConfig('http://127.0.0.1:1');
  try {
    const cli = path.resolve('src/cli.ts');
    const tsx = path.resolve('node_modules/tsx/dist/cli.mjs');
    const result = await promisify(execFile)(process.execPath, [tsx, cli, 'validate', '--config', f.file], { cwd: os.tmpdir(), env: { ...process.env, PLAYWRIGHT_EXECUTABLE_PATH: '/does-not-exist' } });
    expect(result.stdout).toContain('No browser or network was used');
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
test('invalid configuration exits 2 and does not open a browser', async () => {
  const result = await promisify(execFile)(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/cli.ts', 'validate', '--config', 'missing.json']).catch(e => e);
  expect(result.code).toBe(2); expect(result.stderr).toContain('INVALID_CONFIG');
});
for (const [name, mutate] of [
  ['missing document', (c: any) => { c.documents.resumePath = './missing.docx'; }],
  ['placeholder production values', (c: any) => { c.environment = 'production'; c.query = 'REPLACE_WITH_QUERY'; }],
  ['fixture host escape', (c: any) => { c.baseUrl = 'https://www.seek.com.au'; c.allowedOrigins = ['https://www.seek.com.au']; }],
  ['origin with path', (c: any) => { c.allowedOrigins = ['http://127.0.0.1:12345/path']; }],
  ['answer type mismatch', (c: any) => { c.answers[0].value = true; }],
  ['duplicate question ID', (c: any) => { c.answers.push(c.answers[0]); }],
  ['unobserved production adapter', (c: any) => { c.environment = 'production'; c.baseUrl = 'https://www.seek.com.au'; c.allowedOrigins = ['https://www.seek.com.au']; }],
] as const) {
  test(`preflight rejects ${name}`, async () => {
    const f = await fixtureConfig('http://127.0.0.1:12345');
    try { mutate(f.raw); await writeFile(f.file, JSON.stringify(f.raw)); await expect(loadConfig(f.file)).rejects.toMatchObject({ exitCode: 2 }); }
    finally { await rm(f.dir, { recursive: true, force: true }); }
  });
}
test('document preflight rejects directories, empty, oversized, unsupported and unreadable files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'seek-docs-'));
  const limits = { allowedExtensions: ['.docx' as const], maxBytes: 10, resumePath: '', coverLetterPath: '' };
  try {
    const directory = path.join(dir, 'folder.docx'); await mkdir(directory);
    const empty = path.join(dir, 'empty.docx'); await writeFile(empty, '');
    const big = path.join(dir, 'big.docx'); await writeFile(big, 'more than ten bytes');
    const unsupported = path.join(dir, 'program.exe'); await writeFile(unsupported, 'x');
    for (const file of [directory, empty, big, unsupported]) await expect(documentInfo(file, limits)).rejects.toMatchObject({ exitCode: 2 });
    if (process.platform !== 'win32' && process.getuid?.() !== 0) {
      const unreadable = path.join(dir, 'private.docx'); await writeFile(unreadable, 'x'); await chmod(unreadable, 0o000);
      await expect(documentInfo(unreadable, limits)).rejects.toMatchObject({ exitCode: 2 }); await chmod(unreadable, 0o600);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('manual browser connection is limited to a local CDP endpoint', () => {
  expect(validateCdpEndpoint('http://127.0.0.1:9222')).toBe('http://127.0.0.1:9222');
  expect(validateCdpEndpoint('http://localhost:9222')).toBe('http://localhost:9222');
  for (const endpoint of ['ws://127.0.0.1:9222', 'https://remote.example', 'http://127.0.0.1:9222/json', 'http://user:secret@127.0.0.1:9222', 'not-a-url'])
    expect(() => validateCdpEndpoint(endpoint)).toThrow(/CDP/);
});
