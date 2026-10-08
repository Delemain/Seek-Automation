# Start the live SEEK setup on your PC

A prepare-only adapter candidate is ready for a first live check, but has not yet passed against SEEK. These steps use your private Windows browser session. No password or session file needs to be sent to the developer, and the candidate cannot submit an application.

1. Install **Node.js 24 LTS** from <https://nodejs.org/en/download> if it is not already installed.
2. Use your existing project folder `C:\Maxim\seek\Seek-Automation`, containing `package.json`. The runner uses the `Resume.docx` already selected in SEEK and reads your cover letter from `C:\Maxim\seek\Cover Letter.docx`.
3. Open **PowerShell**, close all Chrome windows, and run this command to launch a separate Chrome profile that the helper can reach only from your own PC:

```powershell
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --user-data-dir="$env:LOCALAPPDATA\SEEK-Automation-Chrome"
```

4. In that Chrome window, sign in to SEEK with Google and open **Quick apply** for the AI Engineer listing. Complete MFA there if requested. Leave that exact Quick apply tab open and do not click final Submit.

5. Open a second PowerShell window in the project folder and run:

```powershell
cd C:\Maxim\seek\Seek-Automation
npm ci
npx playwright install chromium
npm run inspect:seek -- --connect-cdp http://127.0.0.1:9222
```

If PowerShell blocks `npm.ps1`, use `npm.cmd` instead of `npm` and `npx.cmd` instead of `npx` in these commands. No execution-policy change is necessary.

The helper attaches to the existing Quick apply tab; it does not open another browser or copy login data.

To capture authenticated search separately, open one SEEK search tab in the same dedicated Chrome window. Run `npm run inspect:seek -- --connect-cdp http://127.0.0.1:9222 --page search`. The observed search used only `AI Engineer` and no location. The structural capture includes job-link paths without tracking query parameters. Type `q` to finish. Keep the Quick apply tab open if needed; the search mode ignores it.

6. Once the first application step is visible, press **Enter** in the second PowerShell window. The helper writes a JSON file under `.inspection\<run-id>\step-01.json` and prints its full path. It does not type answers, upload files, click buttons, save cookies/session state, or submit anything.
7. If you manually continue to further steps, capture each one in the same way. Manual uploads and navigation may save a SEEK draft. **Stop at the final review; do not click final Submit for this setup capture.** Type `q` in PowerShell when finished.
8. Review the generated JSON files, then attach them to this chat. They contain field labels/types, visible button captions, and masked structural landmarks—not input values or credentials. Account names can appear in labels/captions, so remove those if needed. Do not attach session cookies, passwords, or MFA codes. Capturing even the first application step is useful; you do not need to invent answers to advance further.

For the remaining account mapping, open one signed-in SEEK homepage tab with its profile menu **closed**, then run `npm run inspect:seek -- --connect-cdp http://127.0.0.1:9222 --page account`. Press Enter once, then `q`. This mode clicks only the observed profile-avatar button and immediately captures the menu, avoiding a focus-change closure. It never clicks Submit, uploads files, or edits profile data. Review the new JSON before sharing; account details may appear in control labels.

If login needs a different provider, the helper reports and blocks the new origin. For an approved login destination, restart with `npm run inspect:seek -- --allow-origin https://EXACT-OBSERVED-LOGIN-HOST`. This is an explicit origin allowance, not a CAPTCHA bypass. Do not add an external employer's application site; employer forms remain outside this runner's scope.

Google can reject a Playwright-launched browser, so use your normal Chrome user experience for that sign-in. Once the application adapter is complete, the runner supports attaching to a **separate**, manually signed-in Chrome profile. This is the recommended Google-login path; it is not a browser extension. The exact command and safety notes are in the README section “Google sign-in: use a dedicated manual Chrome profile.”

## Optional read-only live check

After installation, this command verifies the actual listing without signing in or entering the application:

```powershell
npm run test:live-public -- --headed
```

It checks the job title, employer, location, job ID in the URL, and exact application link. It is **not** a test of search, document upload or application submission. The browser closes when the check finishes. To inspect its report, run `npx playwright show-report artifacts/public-report` on your PC.

## First automated prepare check

Pull the latest `main`, then copy `config/windows.example.json` to the ignored `config/local.json`. Set `account.expectedIdentifier` to your exact SEEK account email **in that local file only**; do not send it or your session files here. Confirm the stored résumé is still `Resume.docx` and the cover letter exists at `C:\Maxim\seek\Cover Letter.docx`. Leave the dedicated, signed-in Chrome window open. From PowerShell in the project folder:

```powershell
Copy-Item config\windows.example.json config\local.json
notepad config\local.json
npm run validate -- --config config/local.json
npm run apply -- --config config/local.json --mode prepare --connect-cdp http://127.0.0.1:9222
```

Skip `Copy-Item` if you already have a customized `config/local.json`; do not overwrite it. The run searches for `AI Engineer` with no location, verifies the exact job, checks your account email on Quick Apply **before** uploading, verifies the preselected résumé, uploads the local cover letter, leaves your SEEK Profile and skills untouched, then checks review. It does not click Submit application. Uploading may save a draft. If it stops, share only the diagnostic code and phase from `result.json` after reviewing for personal data; do not share the full trace or session files.

This candidate deliberately blocks `--mode submit` until the confirmation screen and application-history check are observed and tested. The standalone `auth` command also blocks this candidate because the homepage account email could not be verified; use the dedicated Chrome CDP path above. This is not yet a live-tested automation path.
