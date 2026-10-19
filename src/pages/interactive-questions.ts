import type { Locator, Page } from '@playwright/test';
import type { LocatorSpec } from '../config.js';
import { WorkflowError } from '../errors.js';
import { locate, visible } from './ui.js';
import { questionSignature, waitForDestinationOrQuestions } from './automatic-questions.js';
import { beginScreeningPage, snapshotScreening, updateScreeningPage, type ScreeningPageAudit } from './screening-audit.js';

export type InteractiveQuestion = { prompt: string; kind: 'select' | 'radio' | 'checkbox' | 'text'; options?: string[]; multiple?: boolean };
export type QuestionResponder = (question: InteractiveQuestion) => Promise<string>;

const cancel = (message: string) => new WorkflowError('INTERACTIVE_SCREENING_CANCELLED', message, 0, 'blocked');
const unsupported = () => new WorkflowError('UNSUPPORTED_SCREENING_QUESTION', 'The application contains a screening control that this interactive assistant cannot safely present. No Submit click was made.', 5, 'blocked');

async function rootFor(page: Page) {
  if (await page.locator('main').count() === 1 && await page.locator('main').isVisible()) return page.locator('main');
  if (await page.locator('form').count() === 1 && await page.locator('form').isVisible()) return page.locator('form');
  return page.locator('body');
}

async function shown(control: Locator) { return await control.isVisible() && await control.isEnabled(); }

async function labelFor(control: Locator, fallback: string, group = false) {
  return control.evaluate((element, { fallbackText, group }) => {
    const input = element as HTMLInputElement;
    const direct = Array.from(input.labels ?? []).map(label => {
      const copy = label.cloneNode(true) as Element;
      for (const editable of copy.querySelectorAll('input, textarea, select')) editable.remove();
      return copy.textContent?.replace(/\s+/g, ' ').trim();
    }).find(Boolean);
    const byAria = element.getAttribute('aria-label')?.trim();
    const fieldset = element.closest('fieldset, [role="group"], [role="radiogroup"]');
    const groupLabel = fieldset?.getAttribute('aria-labelledby')?.split(/\s+/)
      .map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ');
    const labelledBy = element.getAttribute('aria-labelledby')?.split(/\s+/)
      .map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ');
    const legend = fieldset?.querySelector('legend')?.textContent?.replace(/\s+/g, ' ').trim() || fieldset?.getAttribute('aria-label') || groupLabel;
    if (group) return legend || fallbackText;
    return direct || byAria || labelledBy || legend || fallbackText;
  }, { fallbackText: fallback, group });
}

async function optionsFor(controls: Locator[]) { return Promise.all(controls.map(control => labelFor(control, 'Unlabelled choice'))); }

function selection(answer: string, options: string[], multiple: boolean) {
  const value = answer.trim();
  if (/^(q|quit|cancel)$/i.test(value)) throw cancel('Interactive screening was cancelled before Submit.');
  const pieces = multiple ? value.split(',').map(part => part.trim()).filter(Boolean) : [value];
  if (!pieces.length) return [];
  const values = pieces.map(piece => {
    const number = Number(piece);
    if (!Number.isSafeInteger(number) || number < 1 || number > options.length) throw new WorkflowError('INVALID_SCREENING_ANSWER', 'Choose a displayed option number, separated by commas for multiple choices.', 2, 'blocked');
    return number - 1;
  });
  if (!multiple && values.length !== 1) throw new WorkflowError('INVALID_SCREENING_ANSWER', 'Choose exactly one displayed option number.', 2, 'blocked');
  if (new Set(values).size !== values.length) throw new WorkflowError('INVALID_SCREENING_ANSWER', 'Do not repeat option numbers.', 2, 'blocked');
  return values;
}

async function askChoice(responder: QuestionResponder, prompt: string, kind: 'select' | 'radio' | 'checkbox', options: string[], multiple: boolean) {
  const answer = await responder({ prompt, kind, options, multiple });
  return selection(answer, options, multiple);
}

async function completeOnePage(page: Page, next: LocatorSpec, responder: QuestionResponder, audit: ScreeningPageAudit[]) {
  const root = await rootFor(page);
  const pageAudit = beginScreeningPage(audit.length + 1, page.url(), await snapshotScreening(root));
  audit.push(pageAudit);
  // Fail before changing answers if a visible control cannot be presented.
  for (const control of await root.locator('input, textarea, select, [role="combobox"]').all()) {
    if (!await shown(control)) continue;
    const supported = await control.evaluate(element => element.tagName === 'SELECT' || element.tagName === 'TEXTAREA' ||
      (element.tagName === 'INPUT' && ['text', 'search', 'radio', 'checkbox', 'submit', 'button'].includes((element as HTMLInputElement).type)));
    if (!supported) throw unsupported();
  }
  for (const control of await root.locator('select').all()) {
    if (!await shown(control)) continue;
    const options = await control.locator('option').evaluateAll(items => items
      .filter(item => !(item as HTMLOptionElement).disabled && (item as HTMLOptionElement).value.trim() !== '')
      .map(item => ({ label: item.textContent?.trim() ?? '', value: (item as HTMLOptionElement).value })));
    if (!options.length) throw unsupported();
    const labels = options.map(option => option.label);
    const prompt = await labelFor(control, 'Select an answer');
    const picks = await askChoice(responder, prompt, 'select', labels, await control.evaluate(element => (element as HTMLSelectElement).multiple));
    if (!picks.length) throw new WorkflowError('INVALID_SCREENING_ANSWER', 'A select answer cannot be left blank.', 2, 'blocked');
    await control.selectOption(picks.map(pick => ({ value: options[pick].value })));
  }
  const radioGroups = new Map<string, Locator[]>();
  for (const radio of await root.getByRole('radio').all()) {
    if (!await shown(radio)) continue;
    const key = await radio.getAttribute('name') || await radio.getAttribute('id');
    if (!key) throw unsupported();
    radioGroups.set(key, [...(radioGroups.get(key) ?? []), radio]);
  }
  for (const choices of radioGroups.values()) {
    const options = await optionsFor(choices);
    const prompt = await labelFor(choices[0], 'Choose one answer', true);
    const [pick] = await askChoice(responder, prompt, 'radio', options, false);
    await choices[pick].check();
  }
  const checkboxGroups = new Map<string, Locator[]>();
  for (const checkbox of await root.getByRole('checkbox').all()) {
    if (!await shown(checkbox)) continue;
    const key = await checkbox.getAttribute('name') || await checkbox.getAttribute('id');
    if (!key) throw unsupported();
    checkboxGroups.set(key, [...(checkboxGroups.get(key) ?? []), checkbox]);
  }
  for (const choices of checkboxGroups.values()) {
    const options = await optionsFor(choices);
    const prompt = await labelFor(choices[0], 'Choose all that apply', true);
    const picks = await askChoice(responder, prompt, 'checkbox', options, true);
    for (const [index, choice] of choices.entries()) await choice.setChecked(picks.includes(index));
  }
  for (const control of await root.locator('textarea, input:not([type]), input[type="text"], input[type="search"]').all()) {
    if (!await shown(control)) continue;
    const prompt = await labelFor(control, 'Enter an answer');
    const answer = (await responder({ prompt, kind: 'text' })).trim();
    if (/^(q|quit|cancel)$/i.test(answer)) throw cancel('Interactive screening was cancelled before Submit.');
    if (!answer) throw new WorkflowError('INVALID_SCREENING_ANSWER', 'A text answer cannot be blank.', 2, 'blocked');
    await control.fill(answer);
  }
  updateScreeningPage(pageAudit, await snapshotScreening(root));
  const button = locate(page, next);
  const continueControl = await button.count() === 0 ? page.getByRole('button', { name: /^(continue|next)(?:\s|$)/i }) : button;
  if (await continueControl.count() !== 1 || !await continueControl.isVisible()) throw unsupported();
  await continueControl.click();
}

/** Presents visible native question controls to the operator; it never invents an answer or clicks Submit. */
export async function completeInteractiveQuestions(page: Page, destination: LocatorSpec, next: LocatorSpec, check: () => void,
  responder: QuestionResponder, maxPages = 8, stepTimeoutMs = 15000, audit: ScreeningPageAudit[] = []) {
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
    check();
    if (await visible(page, destination)) return;
    const signature = await questionSignature(await rootFor(page));
    if (!signature) throw unsupported();
    await completeOnePage(page, next, responder, audit);
    const stage = await waitForDestinationOrQuestions(page, destination, next, check, stepTimeoutMs, undefined, signature);
    if (stage === 'destination') return;
  }
  throw new WorkflowError('SCREENING_PAGE_LIMIT', 'The Quick Apply flow exceeded eight interactive question pages.', 5, 'blocked');
}
