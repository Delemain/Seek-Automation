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
