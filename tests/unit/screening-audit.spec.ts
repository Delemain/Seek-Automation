import { expect, test } from '@playwright/test';
import { beginScreeningPage, snapshotScreening, updateScreeningPage } from '../../src/pages/screening-audit.js';

test('screening audit records exact selections and preselected values without unrelated secrets', async ({ page }) => {
  await page.setContent(`<main>
    <label>Experience<select id="experience"><option value="">Choose</option><option value="first">First</option></select></label>
    <fieldset><legend>Licence</legend><label><input type="radio" name="licence" value="yes">Yes</label><label><input type="radio" name="licence" value="no" checked>No</label></fieldset>
    <fieldset><legend>Forklift</legend><label><input type="checkbox" name="forklift" value="lf">LF</label><label><input type="checkbox" name="forklift" value="lo">LO</label></fieldset>
    <label>Explanation<textarea id="explanation"></textarea></label>
    <input type="password" value="SECRET_PASSWORD"><input type="file" value="">
  </main>`);
  const initial = await snapshotScreening(page.locator('main'));
  const audit = beginScreeningPage(1, 'https://au.seek.com/job/94851397/apply/questions?secret=PRIVATE#fragment', initial);
  await page.locator('#experience').selectOption('first');
  await page.locator('input[value="lf"]').check();
  await page.locator('#explanation').fill('N/A');
  updateScreeningPage(audit, await snapshotScreening(page.locator('main')));
  expect(audit.pageAddress).toBe('https://au.seek.com/job/94851397/apply/questions');
  expect(audit.attempts).toBe(1);
  expect(audit.fields.find(field => field.id === 'experience')).toMatchObject({
    question: 'Experience', selectedBefore: ['Choose'], selectedAtContinue: ['First'], changedByAutomation: true,
    options: [{ label: 'Choose', value: '', disabled: false }, { label: 'First', value: 'first', disabled: false }],
  });
  expect(audit.fields.find(field => field.optionValue === 'no')).toMatchObject({ selectedBefore: true, selectedAtContinue: true, changedByAutomation: false });
  expect(audit.fields.find(field => field.optionValue === 'lf')).toMatchObject({ selectedBefore: false, selectedAtContinue: true, changedByAutomation: true });
  expect(audit.fields.find(field => field.id === 'explanation')).toMatchObject({ selectedBefore: '', selectedAtContinue: 'N/A', changedByAutomation: true });
  expect(JSON.stringify(audit)).not.toContain('SECRET_PASSWORD');
  expect(JSON.stringify(audit)).not.toContain('PRIVATE');
});
