import { expect, test } from '@playwright/test';
import { completeAutomaticQuestions, waitForDestinationOrQuestions } from '../../src/pages/automatic-questions.js';

const review = { by: 'testId' as const, value: 'review-submit-application' };
const next = { by: 'testId' as const, value: 'continue-button' };

test('a delayed no-questions review is not mistaken for screening', async ({ page }) => {
  await page.setContent(`<main><div data-testid="add-skills">SEEK Profile</div>
    <label><input type="radio" name="visibility" value="standard" checked>Standard</label>
    <button data-testid="continue-button">Continue</button></main>`);
  await page.evaluate(() => setTimeout(() => {
    document.querySelector('main')!.innerHTML = '<button data-testid="review-submit-application">Submit application</button>';
  }, 350));
  expect(await waitForDestinationOrQuestions(page, review, next, () => {}, 2000, { by: 'testId', value: 'add-skills' })).toBe('destination');
  await expect(page.getByTestId('review-submit-application')).toBeVisible();
});

test('screening starts only after the profile marker disappears', async ({ page }) => {
  await page.setContent(`<main><div data-testid="add-skills">SEEK Profile</div>
    <label><input type="radio" name="visibility" value="standard" checked>Standard</label>
    <button data-testid="continue-button">Continue</button></main>`);
  await page.evaluate(() => setTimeout(() => {
    document.querySelector('main')!.innerHTML = '<label>Question<input type="text" id="question"></label><button data-testid="continue-button">Continue</button>';
  }, 350));
  expect(await waitForDestinationOrQuestions(page, review, next, () => {}, 2000, { by: 'testId', value: 'add-skills' })).toBe('questions');
  await expect(page.locator('#question')).toBeVisible();
});

test('batch questions use deterministic answers and stop before Submit', async ({ page }) => {
  await page.setContent(`
    <main>
      <select id="single"><option value="">Choose</option><option value="first">First</option><option value="second">Second</option></select>
      <select id="many" multiple><option value="one">One</option><option value="two">Two</option><option value="three">Three</option></select>
      <textarea id="detail"></textarea>
      <label><input type="radio" name="optional" value="a">A</label>
      <label><input type="radio" name="optional" value="b">B</label>
      <button data-testid="continue-button" onclick="advance()">Continue</button>
    </main>
    <script>
      window.probe = { pages: [], submitted: 0 };
      function advance() {
        const main = document.querySelector('main');
        if (document.querySelector('#many')) {
          if (document.querySelector('#many').selectedOptions.length < 2) return;
          probe.pages.push({ single: document.querySelector('#single').value, many: Array.from(document.querySelector('#many').selectedOptions).map(x => x.value), detail: document.querySelector('#detail').value, optional: !!document.querySelector('input[name=optional]:checked') });
          main.innerHTML = '<input id="why" type="text"><label><input type="radio" name="required" value="first" required>First</label><label><input type="radio" name="required" value="second">Second</label><label><input id="extra" type="checkbox">Extra</label><button data-testid="continue-button" onclick="advance()">Continue</button>';
        } else {
          probe.pages.push({ why: document.querySelector('#why').value, required: document.querySelector('input[name=required]:checked')?.value, extra: document.querySelector('#extra').checked });
          main.innerHTML = '<button data-testid="review-submit-application" onclick="probe.submitted++">Submit application</button>';
        }
      }
    </script>`);
  await completeAutomaticQuestions(page, review, next, () => {});
  expect(await page.evaluate(() => (window as any).probe)).toEqual({
    pages: [
      { single: 'first', many: ['one', 'two'], detail: 'N/A', optional: false },
      { why: 'N/A', required: 'first', extra: false },
    ], submitted: 0,
  });
  await expect(page.getByTestId('review-submit-application')).toBeVisible();
});

test('unsupported screening input stops without advancing', async ({ page }) => {
  await page.setContent('<main><input type="number" id="unsupported"><button data-testid="continue-button">Continue</button></main>');
  await expect(completeAutomaticQuestions(page, review, next, () => {})).rejects.toMatchObject({ code: 'UNSUPPORTED_SCREENING_QUESTION' });
});

test('unmarked required choice falls back to first radio after validation', async ({ page }) => {
  await page.setContent(`
    <main>
      <label><input type="radio" name="choice" value="first">First</label>
      <label><input type="radio" name="choice" value="second">Second</label>
      <button data-testid="continue-button" onclick="if(document.querySelector('input:checked')) { window.chosen = document.querySelector('input:checked').value; document.querySelector('main').innerHTML='<button data-testid=&quot;review-submit-application&quot;>Submit</button>'; }">Continue</button>
    </main>`);
  await completeAutomaticQuestions(page, review, next, () => {});
  await expect(page.getByTestId('review-submit-application')).toBeVisible();
  expect(await page.evaluate(() => (window as any).chosen)).toBe('first');
});

test('checkbox multi-select starts with first option and adds only one more when required', async ({ page }) => {
  await page.setContent(`
    <main><fieldset><legend>Skills</legend>
      <label><input type="checkbox" value="first">First</label>
      <label><input type="checkbox" value="second">Second</label>
      <label><input type="checkbox" value="third">Third</label>
    </fieldset><button data-testid="continue-button" onclick="if(document.querySelectorAll('input:checked').length >= 2) { window.chosen = Array.from(document.querySelectorAll('input:checked')).map(x => x.value); document.querySelector('main').innerHTML='<button data-testid=&quot;review-submit-application&quot;>Submit</button>'; }">Continue</button></main>`);
  await completeAutomaticQuestions(page, review, next, () => {});
  await expect(page.getByTestId('review-submit-application')).toBeVisible();
  expect(await page.evaluate(() => (window as any).chosen)).toEqual(['first', 'second']);
});
