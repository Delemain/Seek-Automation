# Validation record

Date: 7 October 2026. Current cloud machine, Linux x86_64.

## Executed

- Node.js 24.19.0, npm 11.9.0, Playwright Test 1.63.0, TypeScript 7.0.2.
- Managed system Chromium 151.0.7922.173 via `PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium`.
- Dependency installation with exact versions and package-lock v3; reproducible cloud installation is `bash scripts/cloud-install.sh`.
- `npm run typecheck`: passed.
- `PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium npm test`: **33 passed**, 0 failed, 0 skipped. Seventeen unit/CLI/locking/inspection checks and sixteen real-browser local workflow checks. One worker, no retries.
- `PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium npm run test:live-public`: **1 passed** against the actual unauthenticated SEEK listing. Verified title, employer, location, exact job URL and Apply-link target; did not click Apply or submit. This does not validate the application scenario. Report: ignored `artifacts/public-report/`.
- `npm run inspect:seek -- --help`: passed. The capture function was tested in Chromium for field-label extraction, omission of input/textarea/hidden values, removal of query/fragment parameters, and refusal to capture password/MFA pages. The interactive headed Windows flow itself has not been executed in this Linux cloud session.
- CLI help and offline configuration validation exercised. Validation works from a different working directory and with an unreachable origin/no browser executable.

Browser checks cover exact-ID selection over a same-title decoy; query/location entry; pagination; same-origin popup; reversed document-input order; real multipart uploads with delayed completion; text/radio/select/checkbox/multi-select values and review; prepare without final submit; confirmed submit; persistent duplicate refusal; lost confirmation and read-only reconciliation retaining the original run; unknown required questions; missing/expired authentication; human verification; external navigation and popup; missing/ambiguous/mismatched targets; already-applied state; upload failure; and a run deadline retaining trace evidence. The lock suite tests contention from a separate OS process.

The fixtures use synthetic applicant data and synthetic document bytes in temporary directories. They do not demonstrate that genuine DOCX documents are accepted by SEEK or that the SEEK UI matches the adapter interface. Reports are in ignored `playwright-report/` and `test-results/`; runner result/evidence copies are attached to the test report before temporary fixtures are removed.

## Not executed / remaining prerequisites

- The earlier network denial for `www.seek.com.au` and `au.seek.com` is resolved; both now return HTTP 200. Chromium initially reported `ERR_CERT_AUTHORITY_INVALID` under the filesystem sandbox. The platform CA was already present in NSS under `OpenAI-nebula-dns`; importing the same certificate did not add a new trust anchor. Granting Chromium write access to its existing `/home/agent/.pki/nssdb` allowed verified HTTPS to work. Certificate/TLS verification was never disabled. This filesystem permission was scoped to the turn and may need to be granted again in future tasks.
- The initial cloud inspection reached only the public listing; its Apply link redirected to `https://login.seek.com/authorize`. Later operator captures supplied authenticated form and review structure, recorded below. There is still no live automated prepare, submission confirmation, or application-history evidence.
- An unsigned-in search readiness check failed because the keyword field remained disabled; the dashboard displayed a sign-in prompt. Whether authenticated access and additional resources resolve this has not been tested. Search has not passed live validation. The separate public listing check does not replace it.
- Headed live prepare and live submit: **unrun**. No live application was submitted.
- Job ID `94974243` came from the user's link. The title/employer/location were subsequently observed as AI Engineer / SustainRecruit / Sydney NSW and added to the examples. Suggested search keywords are included but their results are unverified. Account identifier, applicant details, screening answers and cleanup process remain missing.
- The cloud machine has neither an authenticated SEEK session nor the two documents on the user's PC. The Windows example contains their supplied paths and filenames, not their contents.
- Windows/macOS execution and a freshly published cloud task have not been tested. npm scripts are portable, but this record establishes Linux current-instance behavior only.

The environment configuration contains the two working SEEK hosts and installation/startup instructions. The updated draft additionally requests the observed login host, application stylesheet host and image host. Review/save and publish to activate additions; a draft save does not itself apply network changes or validate production behavior. The Windows inspection helper is the next operator step toward the authenticated adapter. It does not save session credentials and is not a live prepare/submit pass.

## 8 October 2026 follow-up

The operator supplied five structural captures from an authenticated Quick Apply tab for job 94974243. They show document selection, a SEEK Profile step, and a review screen. The résumé was already selected from the operator's SEEK account. The operator uploaded `Cover Letter.docx` from their PC between the first two captures. The final two captures are the same review screen, not two different steps. No final submit or confirmation was captured.

The runner now has a separate stored-résumé path: it verifies that the exact configured filename is the already checked radio and uploads only the local cover letter. It stops before upload when that résumé is not selected. The existing two-local-file path remains available. `npm run typecheck` passed; the local Chromium fixture run reached review with the stored résumé, uploaded only the cover letter, and did not submit. `PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium npm test` passed all 36 tests with no failures. These are local fixture results. The production adapter still lacks verified file-input and upload-completion selectors, static review/account/job values, search, confirmation, and history mappings. No live automated prepare or submit was run.

The inspection helper was then extended to include hidden file-input metadata without reading file values. Typecheck, all 18 unit tests, and the `tsx` browser-callback self-containment check passed. The operator has not yet supplied a new capture from this helper version.

## Further 8 October 2026 observations

The operator supplied another five captures from the updated helper. The document stage contains a stored `Resume.docx` radio, hidden `#resume-fileFile` and `#coverLetter-fileFile` inputs, and an unrelated avatar file input. The cover-letter file input accepts DOC/DOCX/PDF and other advertised types; a specific upload-size limit remains unobserved. After the operator's manual cover-letter upload, a `Cover Letter.docx` radio appeared. The profile step exposed edit controls but no editable applicant fields in its normal view. The review screenshot shows the approved title and employer, both document filenames, Standard profile visibility selected, a strong-interest switch off, and the Submit application button. The user wants the existing profile and skills left unchanged and Submit application as the eventual final automated action. No confirmation screen or application-history entry was observed, and no live submit was executed.

The runner now allows `applicant` to be omitted and the profile step to continue without editing fields. It can also wait for a checked, exact-filename cover-letter radio as the upload completion signal. Local Chromium fixture tests passed for prepare, one confirmed submit, and mismatch refusal with the stored résumé, checked cover-letter radio, and unchanged profile. These fixture tests do not establish that the current SEEK UI can be submitted safely; the remaining production adapter and confirmation evidence are still required.

The inspection helper now supports `--page search` with a dedicated Chrome search tab and captures job-link paths without tracking parameters. `npm run typecheck` passed and the full local Chromium suite passed **38 tests**, 0 failed. The updated search inspector has not yet been run against authenticated SEEK search results.

## Search inspection, 8 October 2026

The operator supplied four read-only structural snapshots from their signed-in Windows browser. They show homepage search controls, search results containing one card with the approved `data-job-id="94974243"`, the selected job's Quick apply link, and arrival at the same job's document-selection page. The operator separately confirmed a name-only `AI Engineer` search with no location entered. The runner now accepts an empty location and clears any prefilled location before searching. This does not establish that the runner's programmatic input sequence works on SEEK. No automated prepare or submit was run, and no application was submitted by this inspection.

`npm run typecheck` passed. The full local Chromium fixture suite passed **40 tests**, 0 failed, including a name-only search from a page whose location field was prefilled. The first test attempt was denied local socket binding by the default sandbox (`listen EPERM`); rerunning with permission for the fixture's localhost listener passed. No test contacted SEEK.

## Observed adapter draft

A non-runnable `config/seek.observed.draft.json` captures the observed search, in-page job panel, document selection, profile continuation, and review Submit control. It deliberately omits unobserved account, review value, confirmation and history selectors. The adapter schema rejects this draft in production, so it cannot be mistaken for a verified live adapter. The read-only inspector now emits masked structural landmarks to help finish those mappings. The runner additionally supports exact job identity from an observed Apply link when a result opens in a same-URL detail panel, and from the job URL on application/review screens. No live automated prepare or submit was run by these changes.

`npm run typecheck` passed. `PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium npm test` passed **45 tests**, 0 failed, including a local in-place job panel, wrong-Apply-destination refusal, and job-ID URL segment verification. These are fixture checks only, not live SEEK validation.

## Windows inspector callback fix

The new landmark callback used a named local helper inside Playwright's browser-evaluated function. The `tsx` runtime serialised that helper as an unresolved `__name` reference, so pressing Enter could print a generic capture failure and save no JSON. The callback is now self-contained. A regression test executes it through the actual `node --import tsx` path and checks that neither browser callback depends on `__name`; `npm run typecheck` and all six inspector tests passed. A separate `node --import tsx` Chromium run captured job-title, résumé and masked account-email landmarks without exposing the email. This is a local verification of the fix, not a successful Windows or SEEK capture.

## Review and account-menu follow-up

The operator's new review snapshot is at `/job/94974243/apply/review` and identifies exact document filename elements by `data-testid="resume-upload"` and `data-testid="cover-letter-upload"`. Title and employer text are visible, but their proposed locators are not live-uniqueness-checked. The accompanying homepage snapshot has the observed profile-avatar button but no account-email landmark, so it cannot establish account verification. An explicit `--page account` inspection mode now opens only that avatar menu and captures immediately. `npm run typecheck` and the full local Chromium suite passed **47 tests**, 0 failed, including a local browser test of the menu click. No live prepare or submit was run.

## Prepare-only observed candidate

The operator's account-menu capture still did not expose a stable account email. `config/seek.prepare.candidate.json` defers exact account-text verification to Quick Apply, **before** upload, and repeats it at review. The adapter maps the observed search, target Apply link, preselected `Resume.docx`, local cover-letter input/completion radio, unchanged profile continuation, review filenames, and Standard visibility selection. `config/windows.example.json` points to the candidate. No observed confirmation or history mapping exists, so `--mode submit` fails before opening a browser; standalone `auth` cannot certify the homepage account for this candidate. `npm run typecheck` and the full local Chromium suite passed **51 tests**, 0 failed, including matching-account prepare, pre-upload account mismatch refusal, review account mismatch refusal, and submit preflight refusal for the candidate. These establish only runner behavior, not selector accuracy on live SEEK. A live prepare is still unrun, and no application was submitted.
