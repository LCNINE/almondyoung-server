# Attendance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 개인 휴대폰 출퇴근과 정정, 관리자 근무 현황·공유 휴가 캘린더, PWA 알림을 기존 어드민에 연결한다.

**Architecture:** user-service가 출결 원장·정정·일정·개인 설정을 소유한다. admin-web은 기존 인증과 shadcn/ui, API 프록시를 재사용한다. 비공개 첨부는 file-service, 검토 보조는 ai, Web Push 전송은 notification에 둔다. 외부 전송은 DB 작업함을 통해 재시도하며 실제 기록과 알림/AI의 성공 여부를 분리한다.

**Tech Stack:** TypeScript, NestJS, Drizzle/PostgreSQL, Next.js, React, TanStack Query, shadcn/ui, Jest.

**Spec:** `docs/superpowers/specs/2026-10-16-attendance-design.md`

## Global Constraints

- 기존 shadcn/ui·Tailwind, admin/master 직원 역할과 마스터 승인 구분.
- Asia/Seoul 근무일, UTC instant, 하루 한 쌍, 열린 세션은 자정에도 유지.
- 위치는 출퇴근 시점에만 확인; 성공 서버 응답 뒤 완료 표시/소리.
- 공유 캘린더와 현황은 모든 관리자 조회, 본인 일정만 편집; 경리나라 승인 유지.
- 오전 반차 09~18 → 13~18, 10~19 → 14~19; 실제 출근으로 퇴근 알림 이동 금지.
- 반차 시각의 엄격한 구간 제한은 보류; 퇴근 예정≤출근 예정은 차단.
- 첨부 0~3개, 10MB, JPG/PNG/WEBP; 사유 줄바꿈 보존, AI는 최종 판단 금지.
- Yarn 루트 실행, Node 22, Jest --runInBand. 현재 머신 Yarn은 `corepack yarn`, Node 22는 `npm exec --package=node@22 --`로 제공한다.
- 사용자 지시: 기존 체크아웃에서 `feat/attendance` 브랜치 생성 및 구현 착수. 별도 worktree/중간 승인 없이 인라인 진행.

## Review Focus

- KST 자정과 열린 전날 세션: 새 출근보다 기존 퇴근을 우선한다(Task 2).
- 공유 조회가 요청 상세/첨부를 노출하거나 타인 일정을 수정하지 않는다(Task 3/4).
- 동시 출퇴근/결정/중복 요청은 DB 락·제약·버전으로 한 번만 반영한다(Task 2/4).
- 반차 출근 변경은 평소 퇴근을 유지하고 잘못된 순서만 차단한다(Task 1/5).
- AI·푸시 장애, 권한 거부, 파일 오류가 실제 출결 및 수동 검토를 막지 않는다(Task 4/6/7).

## File Structure

- `packages/domain-types/attendance.ts`: DTO 공유 타입과 순수 시간·위치·상태 규칙.
- `apps/user-service/database/drizzle/attendance.schema.ts`: 출결·감사·일정·설정·작업함 테이블. 기존 schema에서 합성해 순환 참조를 피한다.
- `apps/user-service/src/api/attendance/{attendance.module,attendance.controller,attendance.service,attendance.repository,attendance.dto,attendance.jobs}.ts`: 인증, 입력, 트랜잭션, 조회, 배경 작업.
- `apps/admin-web/src/lib/api/domains/attendance/index.ts`: 타입 지정 API 호출.
- `apps/admin-web/src/features/attendance/`: 쿼리, 근무 카드, 모바일 화면, 공유 캘린더, 등록창, 요청창, 마스터 검토, 설정/현황.
- `apps/admin-web/src/app/attendance/`: 독립 모바일/PWA 화면·manifest.
- `apps/admin-web/src/app/(admin)/company/attendance/`: 현황·캘린더·내 기록·검토·설정.
- `apps/file-service/src/database/default-file-contexts.ts`, `access/file-access.ts`: 비공개 출결 컨텍스트 및 삭제 제한.
- `apps/ai/src/attendance/`: 내부 인증 AI 보조 API.
- `apps/notification/src/web-push/`: 구독/해제·내부 전송과 만료 구독 정리.

### Task 1: 공유 규칙과 데이터 계약

**Files:** Create `packages/domain-types/attendance.ts`, `packages/domain-types/attendance.spec.ts`.

**Interfaces:** Produces `normalSchedule(start: string): PlannedTimes`, `halfDaySchedule(start: string, type: LeaveType): PlannedTimes`, `validatePlannedTimes(start: string, end: string): string | null`, `seoulDate(now: Date): string`, `verifyLocation(point: LocationSample, site: Worksite, now: Date): void`, and shared DTO interfaces.

- [ ] Write tests: normal09→18/10→19; am09→13–18/10→14–19; unchanged normal end; invalid/equal/reversed clocks; invalid dates; stale/inaccurate/outside/NaN location; KST rollover.
- [ ] Run `corepack yarn jest --runInBand packages/domain-types/attendance.spec.ts`; expect missing module failure.
- [ ] Implement pure functions with strict parsing, Haversine distance plus accuracy margin, location max age 60s, future tolerance 10s, configurable accuracy/radius.
- [ ] Run same tests; expect PASS. Commit `[attendance] define shared rules and contracts`.

### Task 2: 출결 영속성과 기록 API

**Files:** Create attendance schema/module/controller/service/repository/dto and `attendance.service.spec.ts`; modify app.module/schema; generate Drizzle migration and snapshot.

**Interfaces:** Consumes Task1; produces `/attendance/me`, `/attendance/records`, `/attendance/punch`, `/attendance/worksites`, `/attendance/settings`. API caller identity is authenticated user.id; staff role and active account checked server-side.

- [ ] Write service tests: duplicate request replay, opposite-kind id collision denied, one daily pair, open overnight session closes, location failure performs no write, staff-only guard.
- [ ] Run focused test; expect missing implementation failure.
- [ ] Implement per-user advisory transaction lock, immutable event audit, session uniqueness and current version, configured worksite required, no fabricated coordinates. Master-only worksite mutations; normal working period and reminder preferences stored separately. No raw coordinate persistence needed: save verification outcome/site/policy version only.
- [ ] Generate migration with `corepack yarn drizzle-kit generate --config=apps/user-service/database/drizzle/drizzle.config.ts --name=attendance`; inspect SQL without applying to remote DB.
- [ ] Run Task1+2 tests serially; commit `[attendance] persist verified check-in and check-out`.

### Task 3: 공유 캘린더와 근무 현황

**Files:** Add repository/service methods and DTOs, `attendance-calendar.spec.ts`.

**Interfaces:** `/attendance/calendar?from&to` → `CalendarLeave[]`; `/attendance/overview` → minimal staff statuses; `POST /attendance/leaves` → batch of date/type/plannedTimes; `DELETE /attendance/leaves/:id` owner-only. Shared types from Task1.

- [ ] Write tests: cross-owner edit/delete denied, all staff read shared minimal rows, deleted/expired-role staff omitted, date overlap conflicts atomically, full-day suppresses reminders, empty batch/reversed times denied.
- [ ] Run focused test RED, implement server-side joined queries and transaction audit, then run GREEN.
- [ ] Preserve leave snapshots for history and audit deletions; no internal leave approval. Commit `[attendance] add shared calendar and staff overview`.

### Task 4: 정정·첨부·마스터 결정

**Files:** Add request methods/DTOs, `attendance-requests.spec.ts`; file context/delete guard tests and changes.

**Interfaces:** `/attendance/requests` own list/create, `/attendance/review` master list, `/attendance/requests/:id/decision` master only, `/attendance/requests/:id/resubmit` owner only. `RequestDecision` carries expectedVersion and target session version. Private file metadata verified over internal files API before linking.

- [ ] Write tests RED: self master approval allowed, nonmaster denied, stale/double decision conflict, target record changed conflict, no attachments accepted, wrong owner/context denied, nonblank multiline reason retained, submitted files cannot be removed via general delete.
- [ ] Implement transactional request+session changes and immutable audit; needs_information/resubmit/version; no request autoapproval. Private attachment context disallows user deletion (including master) via generic endpoint; retention cleanup internal-only.
- [ ] Run request and file-access tests GREEN. Commit `[attendance] add audited correction review and private evidence`.

### Task 5: 기존 어드민 화면 연결

**Files:** Feature components/client/queries/routes above; modify MainTemplate, main-layout, menu; add `attendance-model.spec.ts` for UI state transformations.

**Interfaces:** Consumes Tasks1–4 through typed API; TanStack query key prefix `['attendance']`. Normal settings get persisted before deriving half-day default.

- [ ] Write tests RED for UI models: actual status + leave badge coexist, exclude/restore dates, manual end remains, AM fixed end, reversed end error, recommendation explicit application, request reason linebreaks retained.
- [ ] Build desktop independent right card, phone one-tap location and short optional WebAudio chime, shared calendar + owner-only controls, date exclusion/undo, inline leave kind buttons, fixed dialog header/footer with native Radix background lock, current staff overview/search/filters/refetch, records/request/review/settings.
- [ ] Add route/menu access guards admin/master, master-only review actions. Display loading/error/retry instead of fabricated success/empty data on errors; actual punch success only after server response. Remove calculation basis entirely.
- [ ] Run models/API tests, scoped lint/typecheck, visually inspect PC/mobile using computer-use. Commit `[admin-web] connect attendance workflow and shared calendar`.

### Task 6: PWA와 웹 푸시 전송

**Files:** Add attendance manifest/service worker/icons, notification web-push module/schema/migration and tests; frontend subscription UI.

**Interfaces:** notification `/web-push/subscriptions` authenticated register/delete; internal `POST /internal/web-push/send` with idempotency key,userId,title,body,url (allowlisted same-origin path); env VAPID public/private/subject and NOTIFICATION_INTERNAL_KEY.

- [ ] Test RED: malformed/private network endpoint rejected, subscription ownership cannot transfer, expired410 disabled, missing VAPID returns unavailable without fake success, duplicate send key not resent, unsafe notification URL rejected.
- [ ] Add established web-push library, send TTL-bound notifications, queue pending sends with status, clean invalid subscriptions; scoped service worker no sensitive cache, notification click focuses/opens same-origin route. iOS home-screen install guidance and user-triggered permission only.
- [ ] Test GREEN, update env templates, migration only generate/inspect. Commit `[attendance] support PWA web push subscriptions`.

### Task 7: AI 보조와 일정 리마인더 작업

**Files:** Add ai attendance module/controller/service/test and user-service jobs/test.

**Interfaces:** internal AI review input requestId/version,reason,original/proposed times,validated private attachments → structured summary/evidence/questions/opinion, no decision; jobs claim durable operations with leases and conditional completion. Notification task uses Task6 internal endpoint. CronOnce for replica-safe scheduling.

- [ ] Test RED: absent image still summarizes, AI failures retry/leave manual review available, stale output ignored, no face matching/system instruction following; reminders only latest preferences/schedule, skip full leave/recorded punches/past times, dedup by user/date/type, AM leave keeps normal end.
- [ ] Implement bounded AI requests using existing provider conventions and approved metadata; persist model/version/status separately. Durable inbox/outbox jobs with bounded retries and deadlines. Request/result notifications with minimal lockscreen copy, masters notified on new request. No AI/notification service call inside punch transaction.
- [ ] Test GREEN; document failure recovery and required env. Commit `[attendance] add reminder jobs and AI review assistance`.

### Task 8: 全体 검증과 운영 안내

**Files:** Add `docs/attendance-rollout.md`, update spec/plan checkboxes, regression tests as found.

**Interfaces:** All preceding contracts, no external deploy/migration application authorized by local implementation task.

- [ ] Run focused Jest suites serially and relevant guard/file regression tests, Prettier changed files, admin-web typecheck/lint, user-service/AI/notification builds; record baseline unrelated failures separately.
- [ ] Fresh-context whole-branch review via executing-plans; fix important issues with regression RED→GREEN.
- [ ] Verify migration journal/snapshot consistency and deploy flags/config requirements. Explicitly list real-device checks still needing iOS/Android and on-site coordinates. Commit `[attendance] document rollout and verification`.

## Execution decision

The user explicitly requested immediate implementation on a new branch after document synchronization. Proceed inline under executing-plans, without another plan approval prompt. Keep unfinished tasks unchecked and report actual verification results; do not call a partially implemented scope complete.
