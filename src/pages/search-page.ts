import type { Page } from '@playwright/test';
import type { Loaded } from '../config.js';
import { WorkflowError } from '../errors.js';
import { assertions, locate, unique, visible, type NavigationGuard } from './ui.js';

export async function search(page: Page, { config: c, adapter: a }: Loaded, guard: NavigationGuard) {
  const expect = assertions(page);
  await page.goto(c.baseUrl, { waitUntil: 'domcontentloaded' });
  guard.checkPage(page);
  if (await visible(page, a.cookieAccept)) await (await unique(page, a.cookieAccept!)).click();
  await expect(locate(page, a.search.ready)).toBeVisible();
  await (await unique(page, a.search.query)).fill(c.query);
  await (await unique(page, a.search.location)).fill(c.location);
  await (await unique(page, a.search.submit)).click();
  for (let n = 0; n < c.maxSearchPages; n++) {
    guard.checkPage(page);
    // SEEK's observed results are a collection of job cards, not one results wrapper.
    await expect(locate(page, a.search.results).first()).toBeVisible();
    const cards = locate(page, a.search.card);
    const matches = [];
    for (const card of await cards.all()) if (await card.getAttribute(a.search.cardJobIdAttribute) === c.target.jobId) matches.push(card);
    if (matches.length > 1) throw new WorkflowError('AMBIGUOUS_TARGET', 'Multiple results have the approved job ID.', 4, 'blocked');
    if (matches.length === 1) {
      const link = await unique(matches[0], a.search.cardLink);
      const href = await link.getAttribute('href');
      if (!href) throw new WorkflowError('TARGET_MISMATCH', 'The selected job card has no job destination.', 4, 'blocked');
      const destination = new URL(href, page.url());
      if (!c.allowedOrigins.includes(destination.origin) || destination.pathname !== `/job/${encodeURIComponent(c.target.jobId)}`)
        throw new WorkflowError('TARGET_MISMATCH', 'The selected job card does not link to the approved job.', 4, 'blocked');
      await link.click();
      try {
        // SEEK can either reveal the job in the results view or navigate to its
        // detail page. Give either observed result a chance before the fallback.
        await expect.poll(async () => {
          guard.check();
          return new URL(page.url()).pathname === destination.pathname || await visible(page, a.job.ready);
        }, { timeout: Math.min(c.stepTimeoutMs, 3000) }).toBe(true);
      } catch {
        guard.check();
        // The exact result was selected, but its client-side activation did not
        // complete. Follow only the already verified exact job destination.
        await page.goto(destination.href, { waitUntil: 'domcontentloaded' });
        guard.checkPage(page);
      }
      return;
    }
    if (n + 1 === c.maxSearchPages || !await visible(page, a.search.next)) break;
    const next = await unique(page, a.search.next!);
    if (await next.isDisabled()) break;
    const before = await cards.evaluateAll((els, attribute) => els.map(el => el.getAttribute(attribute)), a.search.cardJobIdAttribute);
    await next.click();
    await expect.poll(() => cards.evaluateAll((els, attribute) => els.map(el => el.getAttribute(attribute)), a.search.cardJobIdAttribute)).not.toEqual(before);
  }
  throw new WorkflowError('TARGET_NOT_FOUND', 'Exact approved job ID was not found within the configured search-page limit.', 4, 'not_found');
}
