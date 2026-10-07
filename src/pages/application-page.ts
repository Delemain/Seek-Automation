import type { Locator, Page } from '@playwright/test';
import type { Loaded, Config, DocumentInfo, Adapter } from '../config.js';
import { documentInfo } from '../config.js';
import { WorkflowError } from '../errors.js';
import { assertions, identity, locate, unique, visible, exact, type NavigationGuard } from './ui.js';

async function upload(page: Page, spec: NonNullable<Adapter['application']['steps'][number]['uploads']>['resume'], doc: DocumentInfo, c: Config) {
  const expect = assertions(page);
  const now = await documentInfo(doc.path, c.documents);
  if (now.sha256 !== doc.sha256) throw new WorkflowError('DOCUMENT_CHANGED', 'A document changed after preflight. Start a new run.', 2, 'blocked');
  await (await unique(page, spec.input)).setInputFiles(doc.path);
  await expect(await unique(page, spec.completed)).toBeVisible();
  await exact(page, spec.filename, doc.filename);
  if (await visible(page, spec.error)) throw new WorkflowError('UPLOAD_FAILED', 'Site reports an attachment upload error.');
}
async function fillAnswer(control: Locator, answer: Config['answers'][number]) {
  const expect = assertions(control);
  switch (answer.type) {
    case 'text': await control.fill(answer.value as string); await expect(control).toHaveValue(answer.value as string); break;
    case 'checkbox': await control.setChecked(answer.value as boolean); await expect(control).toBeChecked({ checked: answer.value as boolean }); break;
    case 'select': case 'multi-select': {
      const values = answer.type === 'select' ? [answer.value as string] : answer.value as string[];
      await control.selectOption(values.map(label => ({ label })));
      await expect.poll(() => control.locator('option:checked').allTextContents()).toEqual(values);
      break;
    }
    case 'radio': {
      const radio = control.getByRole('radio', { name: answer.value as string, exact: true });
      await expect(radio).toHaveCount(1); await radio.check(); await expect(radio).toBeChecked(); break;
    }
  }
}
export async function completeApplication(page: Page, loaded: Loaded, guard: NavigationGuard) {
  const expect = assertions(page);
  const { config: c, adapter: a, documents: docs } = loaded;
  const used = new Set<string>();
  const filled = new Set<string>();
  for (const step of a.application.steps) {
    guard.checkPage(page);
    await expect(locate(page, step.ready)).toBeVisible();
    if (step.uploads) {
      await upload(page, step.uploads.resume, docs.resume, c);
      await upload(page, step.uploads.coverLetter, docs.coverLetter, c);
    }
    for (const [key, spec] of Object.entries(step.fields ?? {})) {
      const value = c.applicant[key as keyof typeof c.applicant];
      if (value === undefined) throw new WorkflowError('UNKNOWN_APPLICANT_FIELD', 'Adapter requested an unconfigured applicant field.', 5, 'blocked');
      const control = await unique(page, spec);
      await control.fill(value); await expect(control).toHaveValue(value); filled.add(key);
    }
    if (step.questionRegion) {
      const region = await unique(page, step.questionRegion);
      const controls: Locator[] = [];
      for (const answer of c.answers) {
        const control = locate(region, answer.locator);
        const count = await control.count();
        if (count === 0) continue;
        if (count > 1) throw new WorkflowError('AMBIGUOUS_QUESTION', 'A configured question locator matched more than one control.', 5, 'blocked');
        if (used.has(answer.id)) throw new WorkflowError('AMBIGUOUS_QUESTION', 'A configured question appeared in multiple steps.', 5, 'blocked');
        await expect(control).toHaveCount(1);
        await fillAnswer(control, answer); controls.push(control); used.add(answer.id);
      }
      const required = step.requiredQuestions ? locate(region, step.requiredQuestions) : region.locator('input[required], select[required], textarea[required], [aria-required="true"]');
      for (const question of await required.all()) {
        if (!await question.isVisible()) continue;
        let known = false;
        for (const control of controls) {
          const handle = await control.elementHandle();
          if (handle && await question.evaluate((el, candidate) => el === candidate || candidate!.contains(el) || el.contains(candidate!), handle)) known = true;
          await handle?.dispose();
        }
        if (!known) throw new WorkflowError('UNKNOWN_REQUIRED_QUESTION', 'An unconfigured required screening question was found. Update exact question mappings; no answer was invented.', 5, 'blocked');
      }
    }
    if (await visible(page, step.validationErrors)) throw new WorkflowError('FORM_VALIDATION', 'Form validation errors are visible.');
    guard.check();
    await (await unique(page, step.next)).click();
    if (await visible(page, step.validationErrors)) throw new WorkflowError('FORM_VALIDATION', 'Form rejected configured inputs.');
  }
  if (used.size !== c.answers.length) throw new WorkflowError('QUESTION_NOT_FOUND', 'Not all configured screening questions were encountered.', 5, 'blocked');
  if (filled.size !== Object.keys(c.applicant).length) throw new WorkflowError('APPLICANT_FIELDS_MISSING', 'Adapter did not fill every configured applicant field.', 5, 'blocked');
  await assertReview(page, loaded, guard);
}
export function answerText(value: string | boolean | string[]) { return Array.isArray(value) ? value.join(', ') : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value; }
export async function assertReview(page: Page, { config: c, adapter: a, documents: d }: Loaded, guard: NavigationGuard) {
  const expect = assertions(page);
  guard.checkPage(page);
  await expect(locate(page, a.review.ready)).toBeVisible();
  await identity(page, c, a.review.identity);
  await exact(page, a.review.resume, d.resume.filename);
  await exact(page, a.review.coverLetter, d.coverLetter.filename);
  for (const answer of c.answers) await exact(page, a.review.answers[answer.id], answerText(answer.value));
  for (const [key, value] of Object.entries(c.applicant)) await exact(page, a.review.applicant[key], value);
}
