# Start the live SEEK setup on your PC

The fully automated application test is not ready yet. These steps let you open the real SEEK job, log in privately, and capture the authenticated form structure needed to finish it. No password or session file needs to be sent to the developer.

1. Install **Node.js 24 LTS** from <https://nodejs.org/en/download> if it is not already installed.
2. Extract the supplied project ZIP into `C:\Maxim`. The project folder should be `C:\Maxim\Seek-Automation`, containing `package.json`. Keep your documents where they are: `C:\Maxim\seek\Resume.docx` and `C:\Maxim\seek\Cover Letter.docx`.
3. Open **PowerShell**, close all Chrome windows, and run this command to launch a separate Chrome profile that the helper can reach only from your own PC:

```powershell
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --user-data-dir="$env:LOCALAPPDATA\SEEK-Automation-Chrome"
```

4. In that Chrome window, sign in to SEEK with Google and open **Quick apply** for the AI Engineer listing. Complete MFA there if requested. Leave that exact Quick apply tab open and do not click final Submit.

5. Open a second PowerShell window in the project folder and run:

```powershell
cd C:\Maxim\Seek-Automation
npm ci
npx playwright install chromium
npm run inspect:seek -- --connect-cdp http://127.0.0.1:9222
```

If PowerShell blocks `npm.ps1`, use `npm.cmd` instead of `npm` and `npx.cmd` instead of `npx` in these commands. No execution-policy change is necessary.

The helper attaches to the existing Quick apply tab; it does not open another browser or copy login data.

6. Once the first application step is visible, press **Enter** in the second PowerShell window. The helper writes a JSON file under `.inspection\<run-id>\step-01.json` and prints its full path. It does not type answers, upload files, click buttons, save cookies/session state, or submit anything.
7. If you manually continue to further steps, capture each one in the same way. Manual uploads and navigation may save a SEEK draft. **Stop at the final review; do not click final Submit for this setup capture.** Type `q` in PowerShell when finished.
8. Review the generated JSON files, then attach them to this chat. They contain field labels/types and visible button captions, not input values or credentials. Account names can appear in labels/captions, so remove those if needed. Do not attach session cookies, passwords, or MFA codes. Capturing even the first application step is useful; you do not need to invent answers to advance further.

The first capture has now confirmed the résumé and cover-letter controls. To capture the next state, choose `Cover Letter.docx` through the visible cover-letter Upload control, wait for SEEK to show its attachment state, then press Enter in the attached helper. Uploading documents may create or update a SEEK draft/profile. After that, use **Continue** only if you have an approved answer for every required question. Capture each page and stop at the final review screen before Submit.

If login needs a different provider, the helper reports and blocks the new origin. For an approved login destination, restart with `npm run inspect:seek -- --allow-origin https://EXACT-OBSERVED-LOGIN-HOST`. This is an explicit origin allowance, not a CAPTCHA bypass. Do not add an external employer's application site; employer forms remain outside this runner's scope.

Google can reject a Playwright-launched browser, so use your normal Chrome user experience for that sign-in. Once the application adapter is complete, the runner supports attaching to a **separate**, manually signed-in Chrome profile. This is the recommended Google-login path; it is not a browser extension. The exact command and safety notes are in the README section “Google sign-in: use a dedicated manual Chrome profile.”

## Optional read-only live check

After installation, this command verifies the actual listing without signing in or entering the application:

```powershell
npm run test:live-public -- --headed
```

It checks the job title, employer, location, job ID in the URL, and exact application link. It is **not** a test of search, document upload or application submission. The browser closes when the check finishes. To inspect its report, run `npx playwright show-report artifacts/public-report` on your PC.

## After authenticated mappings are implemented

The inspection data lets the developer complete and locally verify the actual page adapter. The final setup still needs your account identifier, applicant fields and screening answers, plus observed upload and review checks. The two known Word paths are already in `config/windows.example.json`. Do not expect that example alone to make `npm run auth` or `npm run apply` succeed today: a verified application adapter and completed private configuration are required.

The first automated application run will then use `--mode prepare`, verifying the final review without final submission. Reliable observed submission/history evidence must be added before enabling submit mode. This capture tool does not save an authenticated session; the verified `auth` command will do so during that later setup.
