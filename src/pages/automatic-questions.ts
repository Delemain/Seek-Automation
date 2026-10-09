import type { Locator, Page } from '@playwright/test';
import type { LocatorSpec } from '../config.js';
import { WorkflowError } from '../errors.js';
import { locate, visible } from './ui.js';

const unsupported = () => new WorkflowError('UNSUPPORTED_SCREENING_QUESTION', 'A screening control could not be answered with the configured deterministic rules.', 5, 'blocked');
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();

async function shown(locator: Locator) {
  return await locator.isVisible() && await locator.isEnabled();
}

async function choose(control: Locator) {
  if (await control.evaluate(element => element.tagName === 'INPUT')) await control.check();
  else await control.click();
}

async function radioGroup(control: Locator) {
  return control.evaluate(element => (element as HTMLInputElement).name ||
    element.closest('fieldset, [role="radiogroup"]')?.getAttribute('id') ||
    element.closest('fieldset, [role="radiogroup"]')?.textContent?.trim() || element.outerHTML);
}

async function selectValues(control: Locator, count: number) {
  const options = await control.locator('option').evaluateAll(items => items
    .filter(item => !(item as HTMLOptionElement).disabled && (item as HTMLOptionElement).value.trim() !== '')
    .map(item => (item as HTMLOptionElement).value));
  if (options.length < count) throw unsupported();
  await control.selectOption(options.slice(0, count));
  return options.length;
}

async function required(control: Locator) {
  return await control.evaluate(element => element.hasAttribute('required') || element.getAttribute('aria-required') === 'true' ||
    element.closest('fieldset[required], [role="group"][aria-required="true"]') !== null);
}

async function questionSignature(root: Locator) {
  return root.locator('input, textarea, select, [role="combobox"], [role="radio"], [role="checkbox"]').evaluateAll(elements => elements
    .filter(element => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    })
    .map(element => `${element.tagName}:${element.getAttribute('name')}:${element.getAttribute('id')}:${element.getAttribute('aria-label')}:${element.closest('label')?.textContent?.trim() ?? ''}`)
    .join('|'));
}

async function continueButton(page: Page, next: LocatorSpec) {
  let control = locate(page, next);
  if (await control.count() === 0) control = page.getByRole('button', { name: /^(continue|next)(?:\s|$)/i });
  return control;
}

/** Wait until either the next known step appears or a distinct screening page is ready. */
export async function waitForDestinationOrQuestions(page: Page, destination: LocatorSpec, next: LocatorSpec,
  check: () => void, timeoutMs: number, previousStep?: LocatorSpec, previousSignature?: string, requirePreviousAbsent = false) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    check();
    if (await visible(page, destination)) return 'destination' as const;
    const previousGone = !previousStep || (requirePreviousAbsent
      ? await locate(page, previousStep).count() === 0
      : !await visible(page, previousStep));
    if (previousGone && await page.locator('main').count() === 1) {
      const current = await questionSignature(page.locator('main'));
      const button = await continueButton(page, next);
      if (current && current !== previousSignature && await button.count() === 1 && await button.isVisible()) return 'questions' as const;
    }
    await page.waitForTimeout(100);
  }
  throw new WorkflowError('APPLICATION_STEP_UNKNOWN', 'Continue did not reach the next verified application step or a screening page before the step timeout.', 5, 'blocked');
}

async function fillInitial(root: Locator, page: Page) {
  let found = 0;
  const fields = root.locator('input, textarea, select, [role="combobox"]');
  for (const control of await fields.all()) {
    if (!await shown(control)) continue;
    const kind = await control.evaluate(element => ({ tag: element.tagName.toLowerCase(), type: (element as HTMLInputElement).type?.toLowerCase(), role: element.getAttribute('role'), multiple: (element as HTMLSelectElement).multiple }));
    if (kind.tag === 'select') {
      await selectValues(control, 1); found++; continue;
    }
    if (kind.role === 'combobox') {
      await control.click();
      const choices = page.getByRole('option').filter({ visible: true });
      let selected = false;
      for (const option of await choices.all()) {
        if (!await option.isEnabled()) continue;
        await option.click(); selected = true; break;
      }
      if (!selected) throw unsupported();
      found++; continue;
    }
    if (kind.tag === 'textarea' || (kind.tag === 'input' && (kind.type === 'text' || kind.type === 'search'))) {
      await control.fill('N/A'); found++; continue;
    }
    if (kind.tag === 'input' && ['radio', 'checkbox', 'hidden', 'submit', 'button'].includes(kind.type ?? '')) continue;
    throw unsupported();
  }
  const radios = root.getByRole('radio');
  const groups = new Map<string, Locator[]>();
  for (const radio of await radios.all()) {
    if (!await shown(radio)) continue;
    const key = await radioGroup(radio);
    groups.set(key, [...(groups.get(key) ?? []), radio]);
  }
  for (const choices of groups.values()) {
    if ((await Promise.all(choices.map(required))).some(Boolean)) { await choose(choices[0]); found++; }
  }
  const checkboxes = root.getByRole('checkbox');
  for (const checkbox of await checkboxes.all()) {
    if (!await shown(checkbox) || !await required(checkbox)) continue;
    const grouped = await checkbox.evaluate(element => element.closest('fieldset, [role="group"]')?.querySelectorAll('input[type="checkbox"], [role="checkbox"]').length ?? 0);
    if (grouped < 2) { await choose(checkbox); found++; }
  }
  // A group of checkboxes is a multi-select question, even when every choice is optional.
  for (const group of await root.locator('fieldset, [role="group"]').all()) {
    if (!await group.isVisible()) continue;
    const choices = group.getByRole('checkbox');
    if (await choices.count() < 2) continue;
    if ((await Promise.all((await choices.all()).map(choice => choice.isChecked()))).some(Boolean)) continue;
    const first = choices.first();
    if (await shown(first)) { await choose(first); found++; }
  }
  return found;
}

async function addOneChoice(root: Locator) {
  for (const select of await root.locator('select[multiple]').all()) {
    if (!await shown(select)) continue;
    const selected = await select.locator('option:checked').count();
    const options = await select.locator('option').evaluateAll(items => items.filter(item => !(item as HTMLOptionElement).disabled && (item as HTMLOptionElement).value.trim() !== '').length);
    if (selected < options) { await selectValues(select, selected + 1); return true; }
  }
  for (const group of await root.locator('fieldset, [role="group"]').all()) {
    if (!await group.isVisible()) continue;
    const choices = group.getByRole('checkbox');
    if (await choices.count() < 2) continue;
    for (const checkbox of await choices.all()) {
      if (await shown(checkbox) && !await checkbox.isChecked()) { await choose(checkbox); return true; }
    }
  }
  const groups = new Map<string, Locator[]>();
  for (const radio of await root.getByRole('radio').all()) {
    if (!await shown(radio)) continue;
    const key = await radioGroup(radio);
    groups.set(key, [...(groups.get(key) ?? []), radio]);
  }
  for (const choices of groups.values()) {
    if (!(await Promise.all(choices.map(choice => choice.isChecked()))).some(Boolean)) { await choose(choices[0]); return true; }
  }
  for (const checkbox of await root.getByRole('checkbox').all()) {
    if (await shown(checkbox) && !await checkbox.isChecked()) { await choose(checkbox); return true; }
  }
  return false;
}

/** Prepare-only screening handler. Stops at the next known step; never clicks Submit. */
export async function completeAutomaticQuestions(page: Page, destination: LocatorSpec, next: LocatorSpec, check: () => void, maxPages = 8, stepTimeoutMs = 15000) {
  let priorSignature: string | undefined;
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
    check();
    if (await visible(page, destination)) return;
    if (priorSignature) {
      const stage = await waitForDestinationOrQuestions(page, destination, next, check, stepTimeoutMs, undefined, priorSignature);
      if (stage === 'destination') return;
    }
    if (await page.locator('main').count() !== 1) throw unsupported();
    const rootSelector = 'main';
    const root = page.locator(rootSelector);
    const continueControl = await continueButton(page, next);
    if (await continueControl.count() !== 1 || !await continueControl.isVisible()) throw unsupported();
    const signature = await questionSignature(root);
    if (!signature) throw unsupported();
    await fillInitial(root, page);
    let advanced = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      check();
      const beforeUrl = page.url();
      const beforeSignature = await questionSignature(root);
      await continueControl.click({ noWaitAfter: true });
      try {
        await page.waitForFunction(({ previous, url, destinationSelector, rootSelector }) => {
          const target = document.querySelector(destinationSelector);
          if (target && target.getBoundingClientRect().width > 0) return true;
          if (location.href !== url) return true;
          const current = Array.from(document.querySelectorAll(`${rootSelector} input, ${rootSelector} textarea, ${rootSelector} select, ${rootSelector} [role="combobox"], ${rootSelector} [role="radio"], ${rootSelector} [role="checkbox"]`))
            .filter(element => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0; })
            .map(element => `${element.tagName}:${element.getAttribute('name')}:${element.getAttribute('id')}:${element.getAttribute('aria-label')}:${element.closest('label')?.textContent?.trim() ?? ''}`).join('|');
          return current !== previous;
        }, { previous: beforeSignature, url: beforeUrl, rootSelector, destinationSelector: destination.by === 'testId' ? `[data-testid="${destination.value}"]` : '___no_destination___' }, { timeout: 1200 });
      } catch { /* The page did not advance; add one more answer below. */ }
      check();
      if (await visible(page, destination)) return;
      if (page.url() !== beforeUrl || normalize(await questionSignature(root)) !== normalize(beforeSignature)) { priorSignature = beforeSignature; advanced = true; break; }
      if (!await addOneChoice(root)) throw new WorkflowError('SCREENING_VALIDATION', 'The screening page did not advance after all supported answer choices were tried.', 5, 'blocked');
    }
    if (!advanced) throw new WorkflowError('SCREENING_VALIDATION', 'The screening page did not advance after the bounded answer attempts.', 5, 'blocked');
  }
  throw new WorkflowError('SCREENING_PAGE_LIMIT', 'The Quick Apply flow exceeded eight question pages.', 5, 'blocked');
}
