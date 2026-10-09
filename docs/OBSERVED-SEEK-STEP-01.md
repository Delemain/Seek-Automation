# Observed SEEK Quick Apply step 1

Captured by the operator on 9 October 2026 from the authenticated application page for job `94974243`. The capture contains control structure only; it does not include input values, cookies, storage, screenshots, page text, or submitted application data.

This is evidence for the first application step, not proof that the workflow completed or that documents were uploaded during automation.

| Observed item | Stable marker / behavior |
| --- | --- |
| Application page | `https://au.seek.com/job/94974243/apply` |
| Résumé file input | `#resume-fileFile` accepts `.doc`, `.docx`, `.pdf`, `.rtf`, and text files |
| Résumé upload button | `data-testid="upload-button"` |
| Current résumé choice | A radio option labelled `Resume.docx` was present |
| Cover-letter file input | `#coverLetter-fileFile` accepts the same document types |
| Cover-letter upload button | `data-testid="coverLetter-method-upload"` |
| Cover-letter alternatives | Write a cover letter / Don't include a cover letter |
| Next step | `data-testid="continue-button"`, labelled “Continue” in the current capture |
| Account/job landmarks | The capture found dedicated account-email, job-title, employer, résumé, and cover-letter landmark elements, but deliberately omitted their rendered values. |

The generated element IDs with React-style suffixes, the profile/avatar controls, the option-menu control, and the stored résumé radio label must not be used as permanent automation selectors. The file-input IDs and test IDs above are the only initial candidates recorded here; their uniqueness, upload-completion state, and review values still need verification in further captures.

## Remaining observations

1. With the operator's approval for SEEK to receive the document, choose the local `Cover Letter.docx` using the observed cover-letter upload control. Wait for the page to show its completed state, then capture that page.
2. Advance manually with **Continue** and capture every later form step. Do not invent answers for required questions.
3. Stop at the review screen before final Submit, and capture it. It must show the account, job identity, selected filenames and configured answers before prepare mode can be implemented.
4. Capture the observed applied-jobs/history screen only after there is an approved test application and a known cleanup plan. This will be required before submit mode is enabled.
