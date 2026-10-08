# Building the observed SEEK adapter

The public listing has been inspected in Chromium. `src/pages/seek-public-page.ts` records and tests the observed heading, employer button, location link, and exact Apply-link destination for job 94974243. Five authenticated control snapshots from 8 October 2026 show document selection, the SEEK Profile step, and review. They show a preselected `Resume.docx` radio, a cover-letter upload that produced a `Cover Letter.docx` choice, and a final Submit application button. The last two snapshots are the same review screen. They do not show hidden file inputs, upload completion markers, static review values, search, account identity, submission confirmation, or application history. The only complete application profile remains the **local fixture** in `tests/fixtures/seek-fixture.ts`; do not relabel it as observed or describe passing fixture tests as a live application pass.

The configured `au.seek.com` and `www.seek.com.au` hosts now respond successfully. Opening Apply was observed to redirect to `https://login.seek.com/authorize`; that additional authentication host is required. The application also requests a stylesheet from `cdnjs.cloudflare.com` and site imagery from `image-service-cdn.seek.com.au`. These observed hosts are included in the updated draft. Review/save and publish to activate additional settings; draft persistence alone does not enable access. Other observed blocked destinations were analytics or optional login widgets; they were not automatically allowed. The browser navigation guard separately requires exact application origins and explicit authentication origins.

## Inspect without submitting

Use a machine that can access SEEK and supports a headed browser. The provided `npm run inspect:seek` command opens the actual listing and supports manual login without a completed adapter. It saves visible control metadata, omitting input values, screenshots, request bodies and browser storage. Review output before sharing: labels/button captions can still contain personal information. Do not share credentials or session files. Inspect search, the exact approved job, applicant steps, upload completion, final review, and the read-only history UI. Preparing a form may upload files/save drafts. Stop at review during discovery; do not click final submit.

The job title/employer/location have been observed as AI Engineer / SustainRecruit / Sydney NSW. Still record and verify search results, the visible unique account identifier, supported attachment formats/sizes, all required questions, review value representations, and exact origin redirects. The requested job ID is `94974243`.

The profile contract is the exported `adapterSchema` in `src/config.ts`. Save a completed profile as ignored `config/seek.verified.json`, with `kind: "observed"`, inspection date in `observedAt`, and a non-sensitive description of what was inspected in `evidence`. These metadata are operator assertions, not automatic proof of verification. All JSON objects use strict validation, so misspelled keys fail preflight.

Locator forms:

```json
{ "by": "role", "role": "button", "value": "EXACT OBSERVED NAME" }
{ "by": "label", "value": "EXACT OBSERVED LABEL" }
{ "by": "testId", "value": "OBSERVED STABLE TEST ID" }
{ "by": "text", "value": "EXACT OBSERVED TEXT" }
{ "by": "css", "value": "OBSERVED STABLE ATTRIBUTE SELECTOR" }
```

Use role/label/test-ID where possible. CSS is reserved for inspected stable attributes/structural scoping, not generated classes or guessed element positions. Required locators must resolve uniquely. Collection locators (search cards/history entries/required questions) intentionally resolve to multiple items.

## Profile sections

| Section | Observed behavior it must describe |
| --- | --- |
| `auth` | Inspection/login landing URL, authenticated readiness/account text, login-required marker and optional human-verification marker |
| `cookieAccept` | Optional known cookie dialog button |
| `search` | Search readiness, keywords/location inputs, submit, rendered results, cards, card ID attribute, card link, optional next-page control |
| `job` | Detail readiness, exact account/job ID/title/employer markers, Apply control, optional already-applied marker |
| `application` | Initial form readiness/job ID, optional already-applied marker, ordered steps with ready/next controls |
| Document step | Either an exact, already checked stored-résumé radio or a local résumé file input; plus a local cover-letter file input, completed-upload marker, exact displayed filename, and optional upload-error marker |
| Form steps | Configured applicant input mappings; question region and optional locator for custom required controls; optional validation error marker |
| `review` | Readiness; exact account/job/title/employer; attachment names; applicant/answer value mappings; final submit control |
| `confirmation` | Reliable success marker, same-job identity and nonempty application reference |
| `history` | Read-only history URL/readiness, entries, job identity attribute and original application reference |

All identity/value markers currently read exact rendered text, normalized by Playwright. Search/history IDs currently use exact attribute values. Native selects match exact option labels; radio answers scope an exact option label to a unique group. Review boolean values use `Yes`/`No`; arrays use comma-space joining. These are **adapter interface constraints**, not statements about the SEEK UI. If observed UI uses job IDs embedded in link URLs, localized review values, async autocomplete, custom pickers, more complex controls or different navigation, extend the appropriate adapter method and local fixture tests before enabling production. Do not force unsupported markup through an inaccurate profile.

For a stored résumé, set `documents.existingResumeFilename` and provide `uploads.existingResume.option` as the observed radio locator. The runner verifies the radio has that exact accessible name and is already checked. It neither uploads a résumé nor changes the selection. For a local résumé, set `documents.resumePath` and provide `uploads.resume` with the observed file input and completion markers. Configure exactly one source. The cover letter still uses `documents.coverLetterPath` and `uploads.coverLetter`.

Confirmation must be verified from sanctioned observed UI/evidence. If an application ID is unavailable, implement and test an approved history-based success check tied to the same job. Do not make up a success selector to unlock submission. Missing success evidence blocks live submit, even if prepare can later be verified.

After implementing observed mappings, run offline validation, all local tests, one headed live prepare, and (only when the designated account/job and reliable confirmation are ready) one explicitly enabled submit. Record each separately in `docs/VALIDATION.md`. Screenshots/traces stay in ignored private storage, not this documentation.
