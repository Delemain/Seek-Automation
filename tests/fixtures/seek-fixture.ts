import http from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Adapter, Config, LocatorSpec } from '../../src/config.js';

const id = (value: string): LocatorSpec => ({ by: 'testId', value });
const identity = { account: id('account'), jobId: id('job-id'), title: id('title'), employer: id('employer') };
export const fixtureAdapter: Adapter = {
  kind: 'fixture', observedAt: '2026-10-07', evidence: 'tests/fixtures/seek-fixture.ts only; never observed on SEEK.',
  auth: { url: '/account', ready: id('account'), account: id('account'), loginRequired: id('login'), challenge: id('challenge') },
  search: { ready: id('search'), query: { by: 'label', value: 'Keywords' }, location: { by: 'label', value: 'Location' }, submit: { by: 'role', role: 'button', value: 'Search' }, results: id('results'), card: id('job-card'), cardJobIdAttribute: 'data-job-id', cardLink: { by: 'role', role: 'link', value: 'QA Test Engineer' }, next: { by: 'role', role: 'link', value: 'Next page' } },
  job: { ready: id('job'), identity, apply: { by: 'role', role: 'button', value: 'Apply' }, alreadyApplied: id('already') },
  application: { ready: id('uploads'), jobId: id('job-id'), steps: [
    { name: 'Documents', ready: id('uploads'), uploads: {
      resume: { input: { by: 'label', value: 'Upload résumé' }, completed: id('resume-complete'), filename: id('resume-name'), error: id('upload-error') },
      coverLetter: { input: { by: 'label', value: 'Upload cover letter' }, completed: id('cover-complete'), filename: id('cover-name'), error: id('upload-error') },
    }, next: { by: 'role', role: 'button', value: 'Continue' } },
    { name: 'Applicant and screening', ready: id('questions'), fields: { firstName: { by: 'label', value: 'First name' }, lastName: { by: 'label', value: 'Last name' }, email: { by: 'label', value: 'Email' }, phone: { by: 'label', value: 'Phone' } }, questionRegion: id('screening'), next: { by: 'role', role: 'button', value: 'Review' } },
  ] },
  review: { ready: id('review'), identity, resume: id('review-resume'), coverLetter: id('review-cover'),
    answers: { experience: id('answer-experience'), eligible: id('answer-eligible'), notice: id('answer-notice'), consent: id('answer-consent'), skills: id('answer-skills') },
    applicant: Object.fromEntries(['firstName', 'lastName', 'email', 'phone'].map(k => [k, id('applicant-' + k)])),
    submit: { by: 'role', role: 'button', value: 'Submit application' } },
  confirmation: { ready: id('success'), jobId: id('confirmed-job'), reference: id('reference') },
  history: { url: '/history', ready: id('history'), entry: id('history-entry'), jobIdAttribute: 'data-job-id', reference: id('history-reference') },
};
export type Options = { expired?: boolean; unknownQuestion?: boolean; external?: boolean; popup?: boolean; loseConfirmation?: boolean; existingResume?: boolean; unselectedResume?: boolean; profileOnly?: boolean; radioCoverCompletion?: boolean; prefilledSearchLocation?: boolean; thirdPartyFrame?: boolean;
  missing?: boolean; ambiguous?: boolean; mismatch?: boolean; alreadyApplied?: boolean; uploadFailure?: boolean; pagination?: boolean; challenge?: boolean; inlineDetail?: boolean; wrongApplyHref?: boolean; wrongAccountOnApplication?: boolean; wrongAccountOnReview?: boolean };
function html(body: string) { return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Local workflow fixture</title></head><body>${body}</body></html>`; }
const account = '<div data-testid="account">test@example.invalid</div>';
const jobIdentity = `${account}<span data-testid="job-id">94974243</span><h1 data-testid="title">QA Test Engineer</h1><div data-testid="employer">Fixture Employer</div>`;

export async function startFixture(options: Options = {}) {
  const state = { submissions: 0, uploads: [] as { filename: string; body: string }[], searches: [] as { query: string; location: string }[], selectedJobs: [] as string[] };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (options.challenge) { res.end(html('<h1 data-testid="challenge">Human verification</h1>')); return; }
    if (options.expired || !req.headers.cookie?.includes('fixture_session=approved')) { res.end(html('<h1 data-testid="login">Sign in</h1>')); return; }
    if (url.pathname === '/account') { res.end(html(account)); return; }
    if (url.pathname === '/') {
      const measurement = options.thirdPartyFrame ? '<iframe src="http://127.0.0.1:9/measurement" title="measurement"></iframe>' : '';
      res.end(html(`${account}${measurement}<form data-testid="search" action="/search"><label>Keywords<input name="q"></label><label>Location<input name="location"${options.prefilledSearchLocation ? ' value="Melbourne VIC"' : ''}></label><button>Search</button></form>`)); return;
    }
    if (url.pathname === '/search') {
      state.searches.push({ query: url.searchParams.get('q') ?? '', location: url.searchParams.get('location') ?? '' });
      const target = `<article data-testid="job-card" data-job-id="94974243"><a href="/job/94974243"${options.inlineDetail ? ' onclick="event.preventDefault();document.getElementById(\'job-panel\').hidden=false"' : ''}>QA Test Engineer</a></article>`;
      const showTarget = !options.missing && (!options.pagination || url.searchParams.has('page'));
      const panel = options.inlineDetail ? `<section id="job-panel" hidden><a href="/job/${options.wrongApplyHref ? '99999999' : '94974243'}/apply" aria-label="Apply for QA Test Engineer at Fixture Employer" onclick="event.preventDefault();location.href='/apply'">Quick apply</a></section>` : '';
      res.end(html(`${account}<section data-testid="results"><article data-testid="job-card" data-job-id="99999999"><a href="/job/99999999">QA Test Engineer</a></article>${showTarget ? target + (options.ambiguous ? target : '') : ''}</section>${panel}${options.pagination && !url.searchParams.has('page') ? '<a href="/search?page=2">Next page</a>' : ''}`)); return;
    }
    if (url.pathname.startsWith('/job/')) {
      state.selectedJobs.push(url.pathname.split('/').at(-1)!);
      const dest = options.external ? 'http://127.0.0.1:9/external' : '/apply';
      const go = options.popup ? `window.open('${dest}')` : `location.href='${dest}'`;
      res.end(html(`<section data-testid="job">${options.mismatch ? jobIdentity.replace('Fixture Employer', 'Different Employer') : jobIdentity}${options.alreadyApplied ? '<p data-testid="already">Already applied</p>' : ''}<button onclick="${go}">Apply</button></section>`)); return;
    }
    if (url.pathname === '/apply') {
      // Cover letter intentionally comes first. No positional upload locators can pass.
      const resumeControl = options.existingResume
        ? `<fieldset aria-label="Resumé"><label><input type="radio" name="resume" ${options.unselectedResume ? '' : 'checked'}>Resume.docx</label></fieldset>`
        : '<label>Upload résumé<input type="file" id="resume"></label><div data-testid="resume-name"></div><p hidden data-testid="resume-complete">Uploaded</p>';
      res.end(html(`${options.wrongAccountOnApplication ? jobIdentity.replace('test@example.invalid', 'other@example.invalid') : jobIdentity}<section data-testid="uploads"><label>Upload cover letter<input type="file" id="cover"></label><div data-testid="cover-name"></div><div id="cover-choices"></div><p hidden data-testid="cover-complete">Uploaded</p>${resumeControl}<p data-testid="upload-error" hidden>Upload failed</p><button id="continue" disabled>Continue</button></section><script>
        let count = 0;
        ${options.existingResume ? "sessionStorage.setItem('resume','Resume.docx');" : ''}
        for (const id of ${options.existingResume ? "['cover']" : "['cover','resume']"}) document.getElementById(id).onchange = async e => {
          const file=e.target.files[0]; const body=new FormData(); body.append('document',file);
          const response=await fetch('/upload',{method:'POST',body});
          if (!response.ok) { document.querySelector('[data-testid="upload-error"]').hidden=false; return; }
          sessionStorage.setItem(id,file.name); document.querySelector('[data-testid="'+id+'-name"]').textContent=file.name;
          document.querySelector('[data-testid="'+id+'-complete"]').hidden=false;
          if (id==='cover' && ${!!options.radioCoverCompletion}) {
            const label=document.createElement('label'); label.textContent=file.name;
            const radio=document.createElement('input'); radio.type='radio'; radio.dataset.testid='cover-choice'; radio.checked=true;
            label.prepend(radio); document.getElementById('cover-choices').append(label);
          }
          if (++count===${options.existingResume ? 1 : 2}) document.getElementById('continue').disabled=false;
        };
        document.getElementById('continue').onclick=()=>location.href='/questions';
      </script>`)); return;
    }
    if (url.pathname === '/upload') {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString();
      state.uploads.push({ filename: /filename="([^"]+)"/.exec(body)?.[1] ?? '', body });
      setTimeout(() => { res.statusCode = options.uploadFailure ? 400 : 200; res.end('upload processed'); }, 120); return;
    }
    if (url.pathname === '/questions') {
      if (options.profileOnly) {
        res.end(html(`${jobIdentity}<section data-testid="profile"><h2>SEEK Profile</h2><button onclick="location.href='/review'">Continue</button></section>`)); return;
      }
      const fields = [['firstName', 'First name'], ['lastName', 'Last name'], ['email', 'Email'], ['phone', 'Phone']].map(([name, label]) => `<label>${label}<input name="${name}" required></label>`).join('');
      res.end(html(`${jobIdentity}<form data-testid="questions" id="form">${fields}<section data-testid="screening">
        <label>Experience<input name="experience" required></label>
        <fieldset aria-label="Work eligibility"><legend>Work eligibility</legend><label><input type="radio" name="eligible" value="Yes" required>Yes</label><label><input type="radio" name="eligible" value="No">No</label></fieldset>
        <label for="notice">Notice period</label><select id="notice" name="notice" required><option value="">Choose</option><option>Two weeks</option></select>
        <label><input type="checkbox" name="consent" required>Test consent</label>
        <label for="skills">Skills</label><select id="skills" name="skills" multiple required><option>TypeScript</option><option>Testing</option></select>
        ${options.unknownQuestion ? '<label>Unexpected required question<input required name="unknown"></label>' : ''}
        </section><button>Review</button></form><script>
        document.getElementById('form').onsubmit=e=>{e.preventDefault();const d=new FormData(e.target);
          for(const k of ['firstName','lastName','email','phone','experience','eligible','notice']) sessionStorage.setItem(k,d.get(k));
          sessionStorage.setItem('consent',d.has('consent')?'Yes':'No');sessionStorage.setItem('skills',d.getAll('skills').join(', '));location.href='/review';};
      </script>`)); return;
    }
    if (url.pathname === '/review') {
      const items = ['resume', 'cover'].map(k => `<div data-testid="review-${k}" data-value="${k}"></div>`).join('') +
        ['experience', 'eligible', 'notice', 'consent', 'skills'].map(k => `<div data-testid="answer-${k}" data-value="${k}"></div>`).join('') +
        ['firstName', 'lastName', 'email', 'phone'].map(k => `<div data-testid="applicant-${k}" data-value="${k}"></div>`).join('');
      res.end(html(`${options.wrongAccountOnReview ? jobIdentity.replace('test@example.invalid', 'other@example.invalid') : jobIdentity}<section data-testid="review">${items}<button id="submit">Submit application</button></section><script>
        for(const el of document.querySelectorAll('[data-value]')) el.textContent=sessionStorage.getItem(el.dataset.value);
        document.getElementById('submit').onclick=async()=>{const r=await fetch('/submit',{method:'POST'});const d=await r.json();
          ${options.loseConfirmation ? 'document.body.textContent="Waiting for confirmation";' : 'const panel=document.createElement("section");panel.dataset.testid="success";panel.innerHTML=\'<span data-testid="confirmed-job">94974243</span><span data-testid="reference"></span>\';panel.querySelector(\'[data-testid="reference"]\').textContent=d.reference;document.body.append(panel);'}
        };
      </script>`)); return;
    }
    if (url.pathname === '/submit' && req.method === 'POST') { state.submissions++; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ reference: 'fixture-application-1' })); return; }
    if (url.pathname === '/history') { res.end(html(`${account}<section data-testid="history">${state.submissions ? '<article data-testid="history-entry" data-job-id="94974243"><span data-testid="history-reference">fixture-application-1</span></article>' : ''}</section>`)); return; }
    res.statusCode = 404; res.end('Not found');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  return { origin, state, close: () => new Promise<void>((resolve, reject) => { server.close(e => e ? reject(e) : resolve()); server.closeAllConnections(); }) };
}

export async function fixtureConfig(origin: string, overrides: Partial<Config> = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'seek-test-'));
  const config = {
    environment: 'fixture', baseUrl: origin, allowedOrigins: [origin], adapterPath: './adapter.json',
    query: 'QA test', location: 'Sydney NSW', target: { jobId: '94974243', expectedTitle: 'QA Test Engineer', expectedEmployer: 'Fixture Employer' },
    account: { expectedIdentifier: 'test@example.invalid', storageStatePath: './session.json' },
    documents: { resumePath: './Resume.docx', coverLetterPath: './Cover Letter.docx' },
    applicant: { firstName: 'Test', lastName: 'Applicant', email: 'test@example.invalid', phone: '0400000000' },
    answers: [
      { id: 'experience', locator: { by: 'label', value: 'Experience' }, type: 'text', value: 'Test experience' },
      { id: 'eligible', locator: { by: 'role', role: 'group', value: 'Work eligibility' }, type: 'radio', value: 'Yes' },
      { id: 'notice', locator: { by: 'label', value: 'Notice period' }, type: 'select', value: 'Two weeks' },
      { id: 'consent', locator: { by: 'label', value: 'Test consent' }, type: 'checkbox', value: true },
      { id: 'skills', locator: { by: 'label', value: 'Skills' }, type: 'multi-select', value: ['TypeScript', 'Testing'] },
    ],
    mode: 'prepare', headed: false, stepTimeoutMs: 2000, runTimeoutMs: 30000,
    artifactsDirectory: './artifacts', ledgerPath: './ledger', ...overrides,
  };
  await writeFile(path.join(dir, 'config.json'), JSON.stringify(config));
  await writeFile(path.join(dir, 'adapter.json'), JSON.stringify(fixtureAdapter));
  await writeFile(path.join(dir, 'session.json'), JSON.stringify({ cookies: [{ name: 'fixture_session', value: 'approved', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [] }));
  // Synthetic bytes exercise transport only; these are not user documents or Word-format validation fixtures.
  await writeFile(path.join(dir, 'Resume.docx'), 'Synthetic resume fixture bytes');
  await writeFile(path.join(dir, 'Cover Letter.docx'), 'Synthetic cover letter fixture bytes');
  return { file: path.join(dir, 'config.json'), dir, raw: config };
}
