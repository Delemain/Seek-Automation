# Building the observed SEEK adapter

The public listing has been inspected in Chromium. `src/pages/seek-public-page.ts` records and tests the observed heading, employer button, location link, and exact Apply-link destination for job 94974243. Authenticated control snapshots from 8 October 2026 show document selection, the SEEK Profile step, and review. They show a preselected `Resume.docx` radio, the hidden `#coverLetter-fileFile` input, a cover-letter upload that produced a `Cover Letter.docx` choice, and a final Submit application button with test ID `review-submit-application`. A review screenshot shows the target title/employer and both filenames. The operator wants the existing SEEK Profile unchanged, Standard visibility retained, strong-interest switch left off, and Submit application as the final action. These observations do not establish upload completion markers, static review/account selectors, search behavior, submission confirmation, or application history. The only complete application profile remains the **local fixture** in `tests/fixtures/seek-fixture.ts`; do not relabel it as observed or describe passing fixture tests as a live application pass.

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
| Document step | Either an exact, already checked stored-résumé radio or a local résumé file input; plus a local cover-letter file input, a checked filename radio or completed-upload and filename markers, and optional upload-error marker |
| Form steps | Either continue through an unchanged, already populated SEEK Profile or use configured applicant input mappings; question region and optional locator for custom required controls; optional validation error marker |
| `review` | Readiness; exact account/job/title/employer; attachment names; applicant/answer value mappings; final submit control |
| `confirmation` | Reliable success marker, same-job identity and nonempty application reference |
| `history` | Read-only history URL/readiness, entries, job identity attribute and original application reference |

All identity/value markers currently read exact rendered text, normalized by Playwright. Search/history IDs currently use exact attribute values. Native selects match exact option labels; radio answers scope an exact option label to a unique group. Review boolean values use `Yes`/`No`; arrays use comma-space joining. These are **adapter interface constraints**, not statements about the SEEK UI. If observed UI uses job IDs embedded in link URLs, localized review values, async autocomplete, custom pickers, more complex controls or different navigation, extend the appropriate adapter method and local fixture tests before enabling production. Do not force unsupported markup through an inaccurate profile.

For a stored résumé, set `documents.existingResumeFilename` and provide `uploads.existingResume.option` as the observed radio locator. The runner verifies the radio has that exact accessible name and is already checked. It neither uploads a résumé nor changes the selection. For a local résumé, set `documents.resumePath` and provide `uploads.resume` with the observed file input and completion markers. Configure exactly one source. The cover letter still uses `documents.coverLetterPath` and `uploads.coverLetter`.

For the observed cover-letter flow, the hidden input has ID `coverLetter-fileFile`; after upload a radio with test ID `coverLetter-method-upload` and the uploaded filename appeared. A production adapter can set `uploads.coverLetter.input` to that exact file input and `uploads.coverLetter.selectedRadio` to a scoped radio locator. The runner then waits for the radio to have the local file's exact accessible filename and be checked. This is an observed completion candidate, not a live automated upload pass. The older `completed` plus `filename` adapter form remains available for UIs with separate markers.

For an unchanged SEEK Profile, omit `applicant` from the config and omit `fields` from the profile step; the runner only clicks that step's observed Continue control. The review still verifies the account, job and document identities. No profile edit or skill update is performed. Keep `applicant` and exact review mappings when the form actually requires those fields to be edited.

For search discovery, use `npm run inspect:seek -- --connect-cdp http://127.0.0.1:9222 --page search` with one signed-in SEEK search tab open. Capture before and after manually entering the configured query/location. The helper records visible controls plus job links with query/fragment removed. Do not treat a result title alone as the exact target ID; map the observed job URL or card ID to `94974243`.

The operator's four 8 October search captures now show this path: signed-in homepage → `/AI-Engineer-jobs` search results → a selected job-detail panel on the same results URL → `/job/94974243/apply`. The homepage and results expose `#keywords-input`, `#SearchBar__Where`, and a submit button with accessible name `Submit search` (`#searchButton`). Results contain `article[data-testid="job-card"][data-job-id="94974243"]` with a scoped `a[data-testid="job-card-title"][href^="/job/94974243"]`; the selected panel exposes an `Apply for AI Engineer at SustainRecruit` link to `/job/94974243/apply`. The exact target appears once in the captured results, despite other AI Engineer jobs. These are observed *structural* mappings, not a successful automated run. The operator confirmed they searched only for `AI Engineer` and did not enter a location. Both examples now use `"location": ""`; the runner clears any prefilled location with this value. Pagination and autocomplete behavior remain unverified. The former `AI Engineer SustainRecruit` query was not observed to return results.

Confirmation must be verified from sanctioned observed UI/evidence. If an application ID is unavailable, implement and test an approved history-based success check tied to the same job. Do not make up a success selector to unlock submission. Missing success evidence blocks live submit, even if prepare can later be verified.

After implementing observed mappings, run offline validation, all local tests, one headed live prepare, and (only when the designated account/job and reliable confirmation are ready) one explicitly enabled submit. Record each separately in `docs/VALIDATION.md`. Screenshots/traces stay in ignored private storage, not this documentation.
