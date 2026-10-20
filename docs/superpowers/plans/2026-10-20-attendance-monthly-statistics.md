# Monthly attendance statistics implementation plan

**Goal:** Give masters a mobile-friendly monthly attendance summary in admin-web and PWA.

**Architecture:** Share typed response contracts and one React screen between two routes.
Aggregate persisted sessions on the server using work_date and current active staff.
Protect the endpoint with MasterRoleGuard and hide entry links from other staff.

**Stack:** NestJS, Drizzle, React, TanStack Query and existing Tailwind components.

**Scope:** User requested monthly statistics and admin-web access.
Default metrics are recorded days, completed days, recorded minutes and missing checkout days.
Recorded minutes sum completed check-in/check-out intervals without deducting unrecorded breaks.
Overnight work belongs to the check-in work_date month.
Open records from today are ongoing; past open records are missing checkout.
Do not infer lateness, absence or payroll from current preferences.
No migration, dependency addition or deployment is needed.

- [x] Add failing tests for month validation, calendar boundaries, overnight work, open sessions and role protection.
Implement the monthly service and guarded endpoint with shared contracts.
- [x] Add failing UI coverage for role access and monthly rendering.
Implement month navigation, summary cards, search, employee cards and loading/error/empty states.
Add admin and PWA routes and master-only links.
- [x] Run focused tests serially, type checks and builds.
Verify the actual local admin and mobile screens, month switching and search.
Preserve local test attendance data.
- [x] Review final diff, remove generated tsconfig changes and report results.
Leave the new work uncommitted for review.

## Verification notes

- Frontend: 23 focused suites, 98 tests passed; TypeScript and scoped ESLint passed.
- Backend: Nest build passed; monthly boundary and role guard tests included in attendance suite.
- Actual HTTP checks: master 200, ordinary admin 403, invalid/repeated month parameters 400.
- Browser: admin monthly navigation, employee search and empty search verified.
PWA rendered at iPhone SE 375×667 using desktop emulation.
- Read-only review found no additional concrete issues.
- Frontend production build was stopped after it caused contention with interactive development-page compilation.
The local development server remains running; production build is not claimed as passed.
- Warmed attendance routes return in approximately 100–200ms through the local test origin.
- No local attendance records were changed for statistics verification.
- No new commit or deployment was made.

## Follow-up: sample data, pagination and design research

User requested forty sample staff, pagination, and a mobile-first redesign informed by Toss and Daangn.
Use ten employees per page, whole-dataset search, missing-checkout filter and page reset on month/search/filter change.
Keep the existing server aggregation and master-only access.
Render employee data as aligned desktop columns and compact mobile rows.
Use a prominent total-time summary, subdued supporting metrics and warning badges only for missing checkout.
Keep aggregation explanations collapsed.

Sources consulted:
- https://tossmini-docs.toss.im/tds-mobile/components/ListRow/list-row-overview/
- https://tossmini-docs.toss.im/tds-mobile/components/ListRow/list-row-components/
- https://tossmini-docs.toss.im/tds-mobile/components/skeleton/
- https://seed-design.io/components/list
- https://seed-design.io/components/badge
- https://seed-design.io/components/callout
- https://seed-design.io/components/pagination
- https://seed-design.io/components/table-pagination

Implementation adapts these patterns using the existing application components and colors.
No design-system package or proprietary font was added.
The standalone local demo seed refuses any host except localhost/127.0.0.1 and any DB except attendance_pwa_test.
It seeds forty sample accounts without passwords and disables their attendance reminders.
The first run inserted 936 synthetic session records across the current and previous month.
Existing account attendance records were preserved.

## Follow-up verification

- Updated focused frontend suite: 24 suites, 103 tests passed.
- TypeScript and scoped ESLint passed after settings and statistics redesign.
- Native browser interaction verified 41 staff across five pages, final partial page, search across pages, missing-checkout filter, and month reset to first page.
- Desktop and iPhone SE emulation inspected for settings and employee rows.
- Settings notification toggle disables/enables its time field; original setting restored without saving.
- Test notification button and its instructions removed from the shared settings screen.
- WebKit requires user activation for notification permission; no automatic permission request on page load was added.
- Seed repeated run adds zero duplicate records, rejects connection-string host overrides, and preserves a single open session across generated dates.
- Future payroll-copy update requirement recorded in docs/attendance-rollout.md.
