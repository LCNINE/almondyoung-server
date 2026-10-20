# Attendance mobile-first completion plan

> **For agentic workers:** Use executing-plans or independent parallel audit tasks to complete this plan.

**Goal:** Complete the installed attendance PWA test path and make branch-owned authentication and attendance screens usable on phones first.

**Architecture:** Keep the current Next.js authentication and attendance APIs.
Add a shared mobile navigation layout and connect the existing master-only worksite form inside PWA scope.
Use the isolated local test databases and authenticated HTTPS proxy for real push verification.

**Spec:** User instructions on 2026-10-19 and `docs/superpowers/specs/2026-10-16-attendance-design.md`.

## Constraints

- Preserve boxed authentication inputs and the existing color palette.
- Keep the admin home work card removed at every viewport size.
- Use mobile widths 320, 375 and 430 as the baseline.
- Preserve master-only worksite authorization and actual location checks.
- No production deployment, remote DB changes or remote publishing.
- Run focused Jest serially with `--runInBand`.

## Tasks

- [x] Reproduce the notification proxy 500 and configure a local notification server with its own DB and VAPID keys.
- [x] Verify authenticated HTTPS Web Push config returns 200 with configured=true.
- [x] Connect the no-worksite home state to a master-only PWA worksite registration page.
- [x] Provide an explicit current-location action to fill coordinates while retaining permission/error feedback and server validation.
- [x] Replace loose back links with a shared mobile top bar and preserve page titles without duplication.
- [x] Fix mobile time controls and notification button overflow.
- [x] Audit authentication screens and attendance calendars/request dialogs independently.
- [ ] Run focused tests, types, lint and mobile browser checks, then commit scoped changes.
- [ ] After phone registration, send a real test notification and report provider acceptance separately from user-confirmed receipt.

## Review focus

- Native mobile time inputs must not force two narrow columns beyond their containers.
- PWA back navigation must return to the work screen even after a direct deep link.
- Coordinate capture must occur only after the administrator presses the capture button.
- Denied or inaccurate location must remain visible and must not fabricate successful registration or attendance.
- Browser notification permissions and subscription registration must succeed before delivery can be claimed.

## Verification record

- Focused Jest: 8 suites, 24 tests passed with no skips in the final run.
- admin-web and auth-web TypeScript passed.
- Attendance component and route ESLint passed.
- Auth responsive changes passed ESLint except the existing birthday-input useEffect/setState violation present before these edits.
- Chrome iPhone SE emulation confirmed the root registration entry, the master worksite form at 375px, back navigation, and the settings page controls.
- The test notification server runs against a separate local DB with a generated VAPID pair.
- Authenticated public HTTPS Web Push config returns 200/configured=true.
- Phone subscription count remains zero; actual delivery and notification-click return remain pending device registration.
