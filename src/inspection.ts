import type { Page } from '@playwright/test';
import { WorkflowError } from './errors.js';

export function safePageAddress(raw: string) {
  const url = new URL(raw);
  return url.origin + url.pathname; // No OAuth queries, fragments, state or tokens.
}

/** Capture only structural field metadata, never input values or browser storage. */
export async function captureControls(page: Page) {
  const url = new URL(page.url());
  if (/\/oauth(?:\/|$)|\/login(?:\/|$)|\/authorize(?:\/|$)/i.test(url.pathname) || url.hostname === 'login.seek.com')
    throw new WorkflowError('INSPECTION_LOGIN_PAGE', 'Finish sign-in in the browser first. Login pages are not captured.', 3, 'blocked');
  if (await page.locator('input[type="password"]:visible, input[autocomplete="one-time-code"]:visible').count())
    throw new WorkflowError('INSPECTION_LOGIN_PAGE', 'Password and verification pages are not captured. Complete login first.', 3, 'blocked');
  // Keep this callback self-contained: tsx helpers for named local functions do not exist in the page.
  const controls = await page.locator('input, textarea, select, button, [role="button"], [role="combobox"], [role="radio"], [role="checkbox"], fieldset, a[href*="/job/"], [data-job-id]').evaluateAll(elements => {
    return elements.filter(el => {
      const box = el.getBoundingClientRect();
      const fileInput = el.tagName === 'INPUT' && el.getAttribute('type') === 'file';
      return fileInput || (box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden' && el.getAttribute('type') !== 'password');
    }).map(el => {
      const typed = el as HTMLInputElement;
      const href = el.tagName === 'A' && el.getAttribute('href') ? new URL(el.getAttribute('href')!, location.href) : undefined;
      const labels = 'labels' in el ? Array.from(typed.labels ?? []).map(label => {
        const copy = label.cloneNode(true) as Element;
        // A wrapping label may contain textareas, options or custom editable values.
        for (const editable of copy.querySelectorAll('input, textarea, select, [contenteditable], [role="textbox"], [role="combobox"]')) editable.remove();
        return copy.textContent?.replace(/\s+/g, ' ').trim().slice(0,300) || undefined;
      }).filter(Boolean) : [];
      const buttonText = el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' ? el.textContent?.replace(/\s+/g, ' ').trim().slice(0,300) || undefined : undefined;
      return {
        tag: el.tagName.toLowerCase(), type: el.getAttribute('type') ?? undefined,
        accept: el.getAttribute('type') === 'file' ? el.getAttribute('accept') ?? undefined : undefined,
        href: href ? href.origin + href.pathname : undefined,
        linkText: el.tagName === 'A' ? el.textContent?.replace(/\s+/g, ' ').trim().slice(0,300) || undefined : undefined,
        jobId: el.getAttribute('data-job-id') ?? undefined,
        id: el.id || undefined, name: el.getAttribute('name') ?? undefined,
        role: el.getAttribute('role') ?? undefined, ariaLabel: el.getAttribute('aria-label')?.replace(/\s+/g, ' ').trim().slice(0,300) || undefined,
        testId: el.getAttribute('data-testid') ?? undefined, automation: el.getAttribute('data-automation') ?? undefined,
        labels, buttonText,
        legend: el.tagName === 'FIELDSET' ? el.querySelector('legend')?.textContent?.replace(/\s+/g, ' ').trim().slice(0,300) || undefined : undefined,
        required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
        multiple: el.hasAttribute('multiple'),
        options: el.tagName === 'SELECT' ? Array.from((el as HTMLSelectElement).options).map(option => option.textContent?.replace(/\s+/g, ' ').trim().slice(0,300) || undefined) : undefined,
      };
    });
  });
  // Named, read-only landmarks help map exact identity and document selectors.
  // Never include their text: an account landmark may contain a private email.
  const landmarks = await page.locator('h1,h2,h3,p,span,div,a,dd,strong').evaluateAll(elements => {
    const known = [
      ['jobTitle', 'AI Engineer'], ['employer', 'SustainRecruit'],
      ['resume', 'Resume.docx'], ['coverLetter', 'Cover Letter.docx'], ['jobId', '94974243'],
    ];
    return elements.flatMap(el => {
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height || getComputedStyle(el).visibility === 'hidden') return [];
      const full = el.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      const direct = Array.from(el.childNodes).filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim();
      const kinds = known.filter(([, value]) => full === value || direct === value).map(([kind]) => kind);
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(full) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(direct)) kinds.push('accountEmail');
      return kinds.map(kind => ({
        kind,
        element: {
          tag: el.tagName.toLowerCase(), id: el.id || undefined,
          testId: el.getAttribute('data-testid') ?? undefined,
          automation: el.getAttribute('data-automation') ?? undefined,
          role: el.getAttribute('role') ?? undefined,
        },
        parent: el.parentElement ? {
          tag: el.parentElement.tagName.toLowerCase(), id: el.parentElement.id || undefined,
          testId: el.parentElement.getAttribute('data-testid') ?? undefined,
          automation: el.parentElement.getAttribute('data-automation') ?? undefined,
          role: el.parentElement.getAttribute('role') ?? undefined,
        } : undefined,
      }));
    }).slice(0, 80);
  });
  return { capturedAt: new Date().toISOString(), page: safePageAddress(page.url()),
    scope: 'Visible control and named-landmark structure only; no field values, landmark text, cookies, storage, network bodies or screenshots.', controls, landmarks };
}
