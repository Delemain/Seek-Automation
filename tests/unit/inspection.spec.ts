import { test, expect } from '@playwright/test';
import { captureControls, safePageAddress } from '../../src/inspection.js';

test('inspection strips OAuth queries and fragments from page addresses', () => {
  expect(safePageAddress('https://au.seek.com/profile?token=secret#private')).toBe('https://au.seek.com/profile');
});
test('inspection captures labels and control structure without user-entered values', async ({ page }) => {
  await page.setContent('<label>Name<input name="name" required value="PRIVATE_NAME"></label><label>Experience<textarea>PRIVATE_RESUME</textarea></label><label for="s">Choice</label><select id="s"><option>First choice</option></select><button data-automation="continue">Continue</button><input type="hidden" value="SECRET_CSRF"><input type="file" data-testid="cover-file" style="display:none" accept=".docx,.pdf">');
  const result = await captureControls(page);
  const json = JSON.stringify(result);
  expect(json).not.toContain('PRIVATE_NAME'); expect(json).not.toContain('PRIVATE_RESUME'); expect(json).not.toContain('SECRET_CSRF');
  expect(result.controls.find(c => c.name === 'name')).toMatchObject({ labels: ['Name'], required: true });
  expect(result.controls.find(c => c.tag === 'textarea')?.labels).toEqual(['Experience']);
  expect(result.controls.find(c => c.tag === 'button')?.automation).toBe('continue');
  expect(result.controls.find(c => c.testId === 'cover-file')).toMatchObject({ type: 'file', accept: '.docx,.pdf' });
});
test('inspection refuses password and MFA pages', async ({ page }) => {
  await page.setContent('<input type="password" value="SECRET_PASSWORD">');
  await expect(captureControls(page)).rejects.toMatchObject({ code: 'INSPECTION_LOGIN_PAGE' });
  await page.setContent('<input autocomplete="one-time-code" value="123456">');
  await expect(captureControls(page)).rejects.toMatchObject({ code: 'INSPECTION_LOGIN_PAGE' });
});
test('inspection captures job links without tracking parameters', async ({ page }) => {
  await page.setContent('<article data-job-id="94974243"><a href="https://www.seek.com.au/job/94974243?tracking=PRIVATE_TOKEN#private">AI Engineer</a></article>');
  const result = await captureControls(page);
  expect(result.controls.find(c => c.jobId === '94974243')).toBeTruthy();
  expect(result.controls.find(c => c.tag === 'a')).toMatchObject({ href: 'https://www.seek.com.au/job/94974243', linkText: 'AI Engineer' });
  expect(JSON.stringify(result)).not.toContain('PRIVATE_TOKEN');
});
test('inspection records identity landmark structure without exposing email text', async ({ page }) => {
  await page.setContent('<section data-testid="profile-card"><span>private@example.invalid</span></section><h1>AI Engineer</h1><p data-testid="resume-name">Resume.docx</p>');
  const result = await captureControls(page);
  expect(result.landmarks).toContainEqual(expect.objectContaining({ kind: 'accountEmail', parent: expect.objectContaining({ testId: 'profile-card' }) }));
  expect(result.landmarks).toContainEqual(expect.objectContaining({ kind: 'resume', element: expect.objectContaining({ testId: 'resume-name' }) }));
  expect(JSON.stringify(result)).not.toContain('private@example.invalid');
});
