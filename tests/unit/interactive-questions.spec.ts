import { expect, test } from '@playwright/test';
import { completeInteractiveQuestions, type InteractiveQuestion } from '../../src/pages/interactive-questions.js';
import type { ScreeningPageAudit } from '../../src/pages/screening-audit.js';

const review = { by: 'testId' as const, value: 'review' };
const next = { by: 'testId' as const, value: 'continue-button' };

test('interactive screening uses operator choices, waits for delayed pages and stops at review', async ({ page }) => {
  await page.setContent(`<main>
    <label>Work rights<select name="rights"><option value="" disabled>Choose</option><option value="first">Citizen</option><option value="second">Visa</option></select></label>
    <fieldset><legend>Test automation experience?</legend><label><input type="radio" name="experience" value="yes">Yes</label><label><input type="radio" name="experience" value="no">No</label></fieldset>
    <fieldset><legend>Skills</legend><label><input type="checkbox" name="skills" value="js" checked>JavaScript</label><label><input type="checkbox" name="skills" value="py">Python</label><label><input type="checkbox" name="skills" value="ts">TypeScript</label></fieldset>
    <button data-testid="continue-button" onclick="advance()">Continue</button>
    </main><script>
    window.probe = { submitted: 0 };
    function advance() {
      probe.rights = document.querySelector('select').value;
      probe.experience = document.querySelector('input[type=radio]:checked').value;
      probe.skills = Array.from(document.querySelectorAll('input[type=checkbox]:checked')).map(x => x.value);
      setTimeout(() => {
        document.querySelector('main').innerHTML = '<label>Details<input name="details"></label><button data-testid="continue-button" onclick="finish()">Continue</button>';
      }, 350);
    }
    function finish() {
      probe.details = document.querySelector('input').value;
      document.querySelector('main').innerHTML = '<button data-testid="review" onclick="probe.submitted++">Submit application</button>';
    }
    </script>`);
  const questions: InteractiveQuestion[] = [];
  const answers = ['2', '2', '2,3', 'Operator supplied answer'];
  const audit: ScreeningPageAudit[] = [];
  await completeInteractiveQuestions(page, review, next, () => {}, async question => {
    questions.push(question);
    return answers.shift()!;
  }, 8, 2000, audit);
  expect(questions.map(question => question.prompt)).toEqual(['Work rights', 'Test automation experience?', 'Skills', 'Details']);
  expect(questions[0].options).toEqual(['Citizen', 'Visa']);
  expect(await page.evaluate(() => (window as any).probe)).toEqual({ rights: 'second', experience: 'no', skills: ['py', 'ts'], details: 'Operator supplied answer', submitted: 0 });
  expect(audit).toHaveLength(2);
  expect(audit[0].fields.find(field => field.name === 'rights')?.selectedAtContinue).toEqual(['Visa']);
});

test('cancelled or invalid interactive answers never advance', async ({ page }) => {
  for (const answer of ['q', '99']) {
    await page.setContent('<main><label>Salary<select><option>First</option></select></label><button data-testid="continue-button" onclick="window.advanced=true">Continue</button></main>');
    await expect(completeInteractiveQuestions(page, review, next, () => {}, async () => answer)).rejects.toMatchObject({
      code: answer === 'q' ? 'INTERACTIVE_SCREENING_CANCELLED' : 'INVALID_SCREENING_ANSWER',
    });
    expect(await page.evaluate(() => (window as any).advanced)).toBeUndefined();
  }
});

test('unsupported interactive controls stop before answering or advancing', async ({ page }) => {
  await page.setContent('<main><input type="number"><button data-testid="continue-button" onclick="window.advanced=true">Continue</button></main>');
  await expect(completeInteractiveQuestions(page, review, next, () => {}, async () => { throw Error('Must not prompt'); })).rejects.toMatchObject({ code: 'UNSUPPORTED_SCREENING_QUESTION' });
  expect(await page.evaluate(() => (window as any).advanced)).toBeUndefined();
});
