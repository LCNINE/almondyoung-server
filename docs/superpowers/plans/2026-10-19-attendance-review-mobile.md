# Mobile attendance request review implementation plan

**Goal:** Let a master select a request, understand changed timestamps, and process it comfortably on mobile.

**Architecture:** Separate the master inbox and detail from the employee request form.
Reuse existing authenticated APIs and mutation invalidation.
Use the current React, Tailwind, Radix/Vaul, React Hook Form and Zod dependencies.

**Spec:** User-approved proposal in this conversation: compact status tabs, comparison-first detail, fixed primary action, secondary processing sheet, collapsed AI/history and image thumbnails.

## Constraints

- Keep changes uncommitted during manual review.
The user authorized a commit on 2026-10-20.
- Keep current authorization, version checks, request creation and resubmission behavior.
- Keep actions enabled when required inputs are missing and explain errors inline.
- Preserve the local user's attendance and settings when testing.

## Tasks

- [x] Add failing tests for request buckets, omitted timestamp preservation, next-day formatting, record conflicts and decision reasons.
Implement `lib/request-review-model.ts` and verify those tests.
- [x] Extract shared history; add master inbox, mobile detail, image gallery and RHF decision actions.
Verify initial compact rendering, pending-only content and mobile viewport behavior.
Implement fixed-size file loading/error states; live file-service verification remains outside this local test.
- [x] Run focused Jest tests serially, type checking, lint and production build.
Review the change for ownership, stale data, double submissions and mobile keyboard/focus issues.
- [x] Test the local preview through actual browser interaction at 375px (iPhone SE) and 390px.
Exercise tabs, details, back, missing reason guidance and a test-only decision.
- [x] Leave the working tree uncommitted for initial review and provide the local review URL.
After review, remove the redundant async wrapper and commit as authorized on 2026-10-20.

## Verification evidence

- Attendance and layout Jest: 22 suites, 96 tests passed.
- TypeScript, scoped ESLint and production build checked.
- Browser: 390px and iPhone SE 375×667; status tabs, change comparison, unchanged checkout, fixed footer, missing-reason error, successful needs-information decision and employee resubmission verified.
- Completed requests show decision reasons without pending AI or processing actions.
- Test request restored to pending for manual inspection; no approval applied to attendance records.
- Read-only review identified expiring attachment URLs; preview now refreshes stale URLs and supports retry.
- Native iOS keyboard and live attachment downloads have not been verified on an actual iPhone.
