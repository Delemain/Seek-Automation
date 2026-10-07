import { expect, type Page } from '@playwright/test';

// Observed in the live, unauthenticated page on 2026-10-07.
// This module does not implement authenticated account, upload or submission UI.
export const observedJob = {
  id: '94974243', title: 'AI Engineer', employer: 'SustainRecruit', location: 'Sydney NSW',
  url: 'https://au.seek.com/job/94974243',
} as const;

export async function verifyPublicJob(page: Page) {
  const response = await page.goto(observedJob.url, { waitUntil: 'domcontentloaded' });
  expect(response?.ok(), 'The requested job page must load successfully').toBe(true);
  expect(new URL(page.url()).origin).toBe('https://au.seek.com');
  expect(new URL(page.url()).pathname).toBe(`/job/${observedJob.id}`);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: observedJob.title, exact: true, level: 1 })).toBeVisible();
  await expect(main.getByRole('button', { name: observedJob.employer, exact: true })).toBeVisible();
  await expect(main.getByRole('link', { name: observedJob.location, exact: true })).toBeVisible();
  const apply = main.getByRole('link', { name: `Apply for ${observedJob.title} at ${observedJob.employer}`, exact: true });
  await expect(apply).toHaveCount(1);
  await expect(apply).toHaveAttribute('href', `/job/${observedJob.id}/apply`);
  // Deliberately do not click: this read-only check never enters or submits a form.
}
