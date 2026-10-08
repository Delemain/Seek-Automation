# SEEK single-job UI test runner

TypeScript and Playwright automation for one explicitly configured SEEK test job per invocation. No LLM, ChatGPT subscription, or AI API is used at runtime.

**Current status:** the runner and local multi-step browser fixture are implemented. The real public job page and authenticated search/document/profile/review controls have been inspected. A non-runnable observed adapter draft is in `config/seek.observed.draft.json`; the production application adapter is **not yet verified or complete**. This workspace has no operator login or documents. No production application has been prepared or submitted. See [Windows live setup](WINDOWS-LIVE-SETUP.md), [live adapter setup](docs/ADAPTERS.md), and [validation record](docs/VALIDATION.md).

The requested test job is `94974243`, observed as **AI Engineer at SustainRecruit, Sydney NSW**. Operator captures show it in results for a name-only `AI Engineer` search, with no location entered. The application runner always exercises search and exact-ID selection; it does not silently navigate directly to that application URL. The separate `test:live-public` command is explicitly a direct-navigation, read-only listing check, not the application scenario.

## First live check and operator setup

`npm run test:live-public -- --headed` opens Chromium and checks the actual job listing without logging in or clicking Apply. It does not validate search, uploads, screening or submission. Public tests are excluded from `npm test` and save their report in `artifacts/public-report/`.

`npm run inspect:seek -- --connect-cdp http://127.0.0.1:9222` on your Windows PC attaches to a manually signed-in separate Chrome profile and captures control structure without the unfinished adapter. It includes hidden file-input metadata such as accepted extensions, but no file contents or field values. The supplied captures identify the stored-résumé choice, cover-letter file input, and search result for the exact job ID. A review screenshot confirms both document names, the target title/employer and the Submit application button. Upload completion, static identity/value selectors and reliable submission confirmation still need inspection. The helper does not save login state or perform application actions automatically. Inspection output is ignored by Git; review it before sharing because labels/button captions can include account names. This setup capture is not an automated prepare or submit result.

## Install and run local verification

Use Node.js 24 LTS (22.12+ is also accepted), Windows/macOS/Linux, and Chromium:

```sh
npm ci
npx playwright install chromium
npm run typecheck
npm test
```

Local tests start their own temporary HTTP servers and browser sessions. They use synthetic documents and never contact SEEK. They cover real browser interactions and upload transport against a fixture, not live SEEK behavior. The Playwright HTML report is written to `playwright-report/`; `npm run report` opens it locally.

In the managed cloud machine, Chromium is already installed. Set `PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium` to use it and run headlessly. The saved cloud startup instructions include this setting. On a normal PC, leave the variable unset to use Playwright's downloaded browser. Linux systems without browser libraries can use Playwright's documented `install --with-deps chromium` command where system installation is permitted.

## Configure your Windows files

Copy `config/windows.example.json` to `config/local.json`. Its document paths are:

```json
{
  "existingResumeFilename": "Resume.docx",
  "coverLetterPath": "C:\\Maxim\\seek\\Cover Letter.docx"
}
```

The Windows example verifies that the exact `Resume.docx` radio is already selected in SEEK and uploads the cover letter from that PC. It does not read or re-upload the stored résumé. To upload a new local résumé instead, replace `existingResumeFilename` with `resumePath` and use a matching observed adapter; the two settings are mutually exclusive. A cloud session cannot read your C: drive. For cloud/macOS runs, copy `config/example.json` to `config/local.json`, make the documents available privately on that machine, and adjust the paths. Never commit documents or session files.

Complete the visible account identifier and any required screening answers. The examples set `"query": "AI Engineer"` and `"location": ""` to match the operator's name-only search; an empty location clears a prefilled location field. The Windows example leaves the existing SEEK Profile unchanged and omits `applicant`; configure applicant fields only when the observed form requires editing them. Verify upload formats and size limits in the actual UI: the example's `.doc`, `.docx`, `.pdf` and 5 MB limit are configurable preflight defaults, not a verified SEEK policy. Local preflight checks regular files, readability, size, extension and SHA-256; it does not certify that a file is a valid Word/PDF document. SEEK's completed-upload state is checked separately.

Create `config/seek.verified.json` from **observed** UI mappings using [ADAPTERS.md](docs/ADAPTERS.md). Production rejects fixture profiles and placeholder config values. No guessed production selectors are included.

All relative paths resolve against the **config file's directory**, including adapter, documents, session, ledger and artifacts. CLI flags override JSON; JSON overrides defaults. The CLI does not auto-load `.env` files. Credentials do not belong in configuration JSON.

## Authenticate, prepare and submit

Once the observed adapter and configuration are complete:

```sh
npm run validate -- --config config/local.json
npm run auth -- --config config/local.json
npm run apply -- --config config/local.json --mode prepare
```

`validate` is offline and opens no browser. `auth` opens an isolated Chromium context, lets you complete login/MFA in the SEEK page, then asks you to press Enter in the terminal. It verifies the exact configured account before privately saving browser storage state. It does not use your ordinary Chrome profile or accept a password in chat. Login requires a graphical, interactive terminal; cloud login needs a supported interactive browser session. Noninteractive authentication fails with exit 3.

### Google sign-in: use a dedicated manual Chrome profile

Google may reject a Playwright-launched browser as unsupported. Do not weaken Google security checks or share cookies. Instead, start a separate Chrome profile yourself, sign in there normally, and let the runner attach **only to that local profile**. This is a local connection, not a browser plugin and not a remote debugging service exposed to the network.

On Windows, close all Chrome windows first, then run this in PowerShell. The profile directory is intentionally separate from your usual browser:

```powershell
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --user-data-dir="$env:LOCALAPPDATA\SEEK-Automation-Chrome"
```

Sign into SEEK via Google in that Chrome window and leave it open. After the verified production adapter and `config/local.json` exist, run:

```powershell
npm run auth -- --config config/local.json --connect-cdp http://127.0.0.1:9222
npm run apply -- --config config/local.json --mode prepare --connect-cdp http://127.0.0.1:9222
```

The endpoint is restricted to `localhost`/`127.0.0.1`; the runner opens and closes only its own tab. It does not copy, write, or upload the Chrome profile/session state, and it does not close your Chrome window. Close the dedicated Chrome window when you are finished. Chrome’s remote-debugging port grants local programs access to that dedicated profile while it is open, so do not use this mode with your everyday profile or expose port 9222 to another network.

Prepare mode verifies the selected stored résumé and uploads the local cover letter when configured that way. The local-résumé variant uploads both files. It then fills configured fields and answers, checks the final review, retains evidence, and closes the browser without clicking final submit. Uploads and draft saves can still change state on SEEK.

To explicitly enable a single submission:

```sh
npm run apply -- --config config/local.json --mode submit
```

The account, target, filenames and review values are rechecked immediately before submit. An attempted record is persisted before exactly one click. An observed confirmation must include the same job ID and a nonempty application reference. A click or navigation alone does not count. There are no automatic retries or per-run confirmation prompts after submit mode is explicitly configured.

`--headless` overrides the headed default for apply/reconcile. `npm run apply -- --help` describes flags. To generate a Playwright HTML report for an explicitly configured live scenario, set `SEEK_CONFIG` in your shell and run `npm run test:live`. On PowerShell: `$env:SEEK_CONFIG = "config/local.json"`. On macOS/Linux: `SEEK_CONFIG=config/local.json npm run test:live`. That single test respects the JSON mode and uses workers 1, retries 0, and no parallel execution. Plain `npm test` never runs it.

## Questions and adapter limits

An answer has a stable local ID, exact observed locator, type and value:

```json
{
  "id": "workEligibility",
  "locator": { "by": "role", "role": "group", "value": "EXACT OBSERVED QUESTION" },
  "type": "radio",
  "value": "EXACT OBSERVED OPTION"
}
```

Supported types are `text` (string), `radio` (exact option label within a unique group), `select` (exact option label), `checkbox` (boolean), and `multi-select` (array of option labels on a native multiple select). Custom controls require an explicit adapter extension; the runner never fabricates answers. Each configured answer must be encountered exactly once and have an observed review value. Unknown visible required controls stop the run. The adapter must describe custom required-question containers if the UI does not use native/ARIA required markers.

This MVP supports a fixed, inspected sequence of steps, an already selected stored résumé or a local résumé file input, a local cover-letter file input, and either separate completion markers or a checked filename radio after upload. An already populated SEEK Profile can be left unchanged by omitting `applicant` and field mappings. A custom file-picker-only flow, text-only cover letter, autocomplete requiring option selection, or unimplemented dynamic step must be implemented and fixture-tested after inspection. The stored résumé must be verified by its exact accessible filename and checked radio; the runner never substitutes a different document. Employer-hosted application forms are unsupported. Same-origin popups work; navigation to unapproved origins is blocked. Explicit authentication origins are permitted only during interactive login. CAPTCHA/human verification stops unattended runs.

## Results and exit codes

Every started workflow writes a private `artifacts/<run-id>/result.json` with UTC times, operation/mode, query/location, target, hashed account reference, document filenames and local-file hashes, completed phase, terminal status, diagnostic code, confirmation reference and evidence paths. A stored SEEK résumé records its source and exact filename without a content hash. Configuration failures occur before a run and report a diagnostic/exit code without opening the browser. The console omits credentials, document contents and raw Playwright errors.

| Exit | Meaning |
| --- | --- |
| 0 | Prepared or newly submitted with verified confirmation |
| 2 | Invalid configuration, adapter or documents |
| 3 | Login, MFA, verification or account mismatch |
| 4 | Exact target missing, ambiguous or mismatched |
| 5 | Unsupported navigation/form or unknown required question |
| 6 | Other workflow failure |
| 7 | Submission uncertain or reconciliation unresolved |
| 8 | Lock/duplicate refusal, already applied, or successfully reconciled existing application |

`already_applied` never returns 0, including successful reconciliation; CI must not count it as a new application. The separate diagnostic `RECONCILED` indicates a read-only reconciliation succeeded.

Traces start before navigation. Failures retain available screenshots/traces; prepare always retains review evidence. `retainSuccessEvidence: true` also retains confirmed-success evidence. CLI runs produce JSON/console/evidence; the Playwright Test wrapper additionally produces HTML. Abrupt process death or browser launch failure may prevent screenshot/trace capture; an attempted ledger still blocks another submit.

## Duplicate prevention and recovery

Keep `ledgerPath` stable. It is a directory containing one atomically replaced JSON entry and one exclusive `.lock` file per environment/account/job hash. Changing run ID, keywords, documents or SEEK origin alias does not bypass the key. Attempts, uncertainty and confirmations all block new application runs. The account reference is a hash, not anonymization of low-entropy identifiers.

If confirmation is lost:

```sh
npm run reconcile -- --config config/local.json
```

This visits the inspected application-history URL, verifies the account, locates exactly one entry with the exact job ID, and records its observed reference against the **original** run. It never clicks submit. A missing/ambiguous history entry leaves the ledger blocked because absence may be eventual consistency, not proof no application exists.

Stale lock recovery is manual: verify the process and any browser it owns have ended, inspect its PID/run ID and the corresponding JSON, and reconcile the actual account history before removing only that key's stale `.lock`. PID reuse is possible; do not treat age alone as proof a lock is stale. Do not delete a lock held by an active run. There is intentionally no automatic lock expiration.

Reset is separate from running a test: after the approved SEEK operator verifies or performs the agreed cleanup, preserve the ledger entry in a private archive with the evidence and reset reason, then remove only that key's entry and stale lock. Never clear an attempted/uncertain record merely to retry. This runner does not withdraw applications. Separate machines or CI workers require coordinated shared locking and state before concurrent live use; local file locking is not a server-side exactly-once guarantee. Power loss/filesystem failures require manual reconciliation.

## Private data

`.gitignore` excludes standard local configs, verified profiles, documents, auth state, ledger, reports and traces. Keep custom private paths outside tracked directories. New private directories/files use restrictive permissions where supported; on Windows, secure the parent folder with appropriate account ACLs. Storage state contains reusable session credentials. Traces/screenshots/HTML can contain applicant data and authenticated responses, so use approved test data and restrict access. No CI artifact upload is configured. Delete expired artifacts and session files according to your retention policy; preserve the ledger while duplicate prevention is required. Never upload a session file to this chat.

## Defaults

Defaults: production environment, `https://www.seek.com.au`, prepare mode, headed Chromium, 5 search pages, 15-second step timeout, 180-second run deadline, 5,000,000-byte document limit, DOC/DOCX/PDF extensions, no screening answers, no authentication-origin exceptions, and no success evidence retention. Paths default to `../artifacts` and `../private-state/submissions` relative to the config. Required inputs are validated before execution; there is no fallback account, job, answer or live adapter.
