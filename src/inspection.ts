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
  const controls = await page.locator('input, textarea, select, button, [role="button"], [role="combobox"], [role="radio"], [role="checkbox"], fieldset').evaluateAll(elements => {
    const normalize = (value: string | null | undefined) => value?.replace(/\s+/g, ' ').trim().slice(0,300) || undefined;
    const getStaticLabel = (label: Element) => {
      const copy = label.cloneNode(true) as Element;
      // A wrapping label may contain textareas, options or custom editable values.
      for (const el of copy.querySelectorAll('input, textarea, select, [contenteditable], [role="textbox"], [role="combobox"]')) el.remove();
      return normalize(copy.textContent);
    };
    return elements.filter(el => {
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden' && el.getAttribute('type') !== 'password';
    }).map(el => {
      const typed = el as HTMLInputElement;
      const labels = 'labels' in el ? Array.from(typed.labels ?? []).map(getStaticLabel).filter(Boolean) : [];
      const buttonText = el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' ? normalize(el.textContent) : undefined;
      return {
        tag: el.tagName.toLowerCase(), type: el.getAttribute('type') ?? undefined,
        id: el.id || undefined, name: el.getAttribute('name') ?? undefined,
        role: el.getAttribute('role') ?? undefined, ariaLabel: normalize(el.getAttribute('aria-label')),
        testId: el.getAttribute('data-testid') ?? undefined, automation: el.getAttribute('data-automation') ?? undefined,
        labels, buttonText,
        legend: el.tagName === 'FIELDSET' ? normalize(el.querySelector('legend')?.textContent) : undefined,
        required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
        multiple: el.hasAttribute('multiple'),
        options: el.tagName === 'SELECT' ? Array.from((el as HTMLSelectElement).options).map(option => normalize(option.textContent)) : undefined,
      };
    });
  });
  return { capturedAt: new Date().toISOString(), page: safePageAddress(page.url()),
    scope: 'Visible control structure only; no field values, cookies, storage, network bodies or screenshots.', controls };
}
