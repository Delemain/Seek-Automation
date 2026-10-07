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
    await expect(locate(page, a.search.results)).toBeVisible();
    const cards = locate(page, a.search.card);
    const matches = [];
    for (const card of await cards.all()) if (await card.getAttribute(a.search.cardJobIdAttribute) === c.target.jobId) matches.push(card);
    if (matches.length > 1) throw new WorkflowError('AMBIGUOUS_TARGET', 'Multiple results have the approved job ID.', 4, 'blocked');
    if (matches.length === 1) { await (await unique(matches[0], a.search.cardLink)).click(); return; }
    if (n + 1 === c.maxSearchPages || !await visible(page, a.search.next)) break;
    const next = await unique(page, a.search.next!);
    if (await next.isDisabled()) break;
    const before = await cards.evaluateAll((els, attribute) => els.map(el => el.getAttribute(attribute)), a.search.cardJobIdAttribute);
    await next.click();
    await expect.poll(() => cards.evaluateAll((els, attribute) => els.map(el => el.getAttribute(attribute)), a.search.cardJobIdAttribute)).not.toEqual(before);
  }
  throw new WorkflowError('TARGET_NOT_FOUND', 'Exact approved job ID was not found within the configured search-page limit.', 4, 'not_found');
}
