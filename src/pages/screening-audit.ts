import type { Locator } from '@playwright/test';
import { safePageAddress } from '../inspection.js';

export type ScreeningValue = string | string[] | boolean | null;
export type ScreeningOption = { label: string; value: string; disabled: boolean };
export type ScreeningField = {
  key: string; kind: 'text' | 'select' | 'multi-select' | 'combobox' | 'radio' | 'checkbox';
  question?: string; label?: string; name?: string; id?: string; testId?: string;
  required: boolean; optionValue?: string; options?: ScreeningOption[];
  selectedBefore: ScreeningValue; selectedAtContinue: ScreeningValue; changedByAutomation: boolean;
};
export type ScreeningPageAudit = { pageNumber: number; pageAddress: string; attempts: number; fields: ScreeningField[] };
type Snapshot = Omit<ScreeningField, 'selectedBefore' | 'selectedAtContinue' | 'changedByAutomation'> & { selected: ScreeningValue };

/** Read question controls only; never read passwords, file paths, cookies or browser storage. */
export async function snapshotScreening(root: Locator): Promise<Snapshot[]> {
  return root.locator('input, textarea, select, [role="combobox"], [role="radio"], [role="checkbox"]').evaluateAll(elements =>
    elements.flatMap((element, index) => {
      const box = element.getBoundingClientRect();
      if (!box.width || !box.height || getComputedStyle(element).visibility === 'hidden') return [];
      const tag = element.tagName.toLowerCase();
      const type = (element as HTMLInputElement).type?.toLowerCase();
      const role = element.getAttribute('role');
      if (element.closest('[role="combobox"]') !== element && element.closest('[role="combobox"]')) return [];
      let kind: Snapshot['kind'];
      if (tag === 'select') kind = (element as HTMLSelectElement).multiple ? 'multi-select' : 'select';
      else if (role === 'combobox') kind = 'combobox';
      else if (tag === 'textarea' || (tag === 'input' && ['text', 'search'].includes(type))) kind = 'text';
      else if (role === 'radio' || type === 'radio') kind = 'radio';
      else if (role === 'checkbox' || type === 'checkbox') kind = 'checkbox';
      else return [];
      const native = element as HTMLInputElement;
      const labelElement = native.labels?.[0];
      const labelCopy = labelElement?.cloneNode(true) as Element | undefined;
      for (const editable of labelCopy?.querySelectorAll('input, textarea, select, [role="combobox"]') ?? []) editable.remove();
      const label = labelCopy?.textContent?.replace(/\s+/g, ' ').trim() || element.getAttribute('aria-label')?.trim() || undefined;
      const legend = element.closest('fieldset')?.querySelector('legend')?.textContent?.replace(/\s+/g, ' ').trim();
      const labelledBy = element.getAttribute('aria-labelledby')?.split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ');
      const question = legend || labelledBy || (kind === 'radio' || kind === 'checkbox' ? undefined : label);
      const options = tag === 'select' ? Array.from((element as HTMLSelectElement).options).slice(0, 40).map(option => ({
        label: option.textContent?.replace(/\s+/g, ' ').trim() ?? '', value: option.value, disabled: option.disabled,
      })) : undefined;
      let selected: Snapshot['selected'];
      if (kind === 'select' || kind === 'multi-select') selected = Array.from((element as HTMLSelectElement).selectedOptions).map(option => option.textContent?.replace(/\s+/g, ' ').trim() ?? '');
      else if (kind === 'radio' || kind === 'checkbox') selected = role && tag !== 'input' ? element.getAttribute('aria-checked') === 'true' : native.checked;
      else if (kind === 'combobox') selected = tag === 'input' ? native.value : element.getAttribute('aria-valuetext') || element.textContent?.replace(/\s+/g, ' ').trim() || null;
      else selected = native.value;
      return [{
        key: `${index}:${tag}:${type ?? ''}:${native.name ?? ''}:${element.id}`,
        kind, question: question?.slice(0, 500), label: label?.slice(0, 500),
        name: native.name || undefined, id: element.id || undefined,
        testId: element.getAttribute('data-testid') || undefined,
        required: element.hasAttribute('required') || element.getAttribute('aria-required') === 'true' || element.closest('fieldset[required], [role="group"][aria-required="true"]') !== null,
        optionValue: kind === 'radio' || kind === 'checkbox' ? native.value || undefined : undefined,
        options, selected,
      }];
    }));
}

export function beginScreeningPage(pageNumber: number, pageUrl: string, initial: Snapshot[]): ScreeningPageAudit {
  return { pageNumber, pageAddress: safePageAddress(pageUrl), attempts: 0,
    fields: initial.map(({ selected, ...field }) => ({ ...field, selectedBefore: selected, selectedAtContinue: selected, changedByAutomation: false })) };
}

export function updateScreeningPage(audit: ScreeningPageAudit, current: Snapshot[]) {
  audit.attempts++;
  for (const { selected, ...field } of current) {
    let entry = audit.fields.find(item => item.key === field.key);
    if (!entry) {
      entry = { ...field, selectedBefore: null, selectedAtContinue: selected, changedByAutomation: true };
      audit.fields.push(entry);
    } else {
      entry.selectedAtContinue = selected;
      entry.changedByAutomation = JSON.stringify(entry.selectedBefore) !== JSON.stringify(selected);
    }
  }
}
