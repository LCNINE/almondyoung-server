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
- 모듈 아래 controllers/services/guards/dto/repositories 디렉터리를 사용한다. 조회·변경 책임이 복잡해지면 Reader/Manager를 분리한다(사용자 추가 지시).
- 프런트·백엔드 모두 명령문을 한 줄에 압축하지 않는다. 계산/검증/DB호출/반환을 빈 줄로 구분하고 긴 쿼리·인자·데코레이터·JSX를 여러 줄로 정리한다. 설명 문서는 문장별 줄바꿈을 적용한다. Prettier 외 수동 가독성 검토를 수행한다.
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
- `apps/user-service/src/api/attendance/attendance.module.ts`와 `controllers/`, `services/`, `guards/`, `dto/`, `repositories/`: 인증, 입력, 트랜잭션, 조회, 배경 작업. 테스트는 해당 책임 디렉터리에 둔다. 이후 Task의 클래스 이름은 이 구조에서의 파일을 뜻한다.
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

## 2026-10-16 중단 복구 및 검증 기록

컴퓨터 종료 후 `feat/attendance`의 변경분과 기존 작업 기록을 복구했다.
사용자의 요청으로 `740626a9a`에 당시 변경분을 중간 저장하고 후속 수정을 진행했다.
위 체크리스트는 최초 TDD 실행 순서를 보존한다.
중단 전 RED 실행을 재현했다고 가정하지 않으며, 현재 구현과 이번 검증 결과는 아래에 별도로 기록한다.

- [x] 공유 규칙과 출퇴근·정정·휴가·감사·소유권 구현을 복구하고 관련 단위/DB 통합 테스트를 실행했다.
- [x] 마스터의 직원별 과거 기록 조회와 근무지 수정·비활성화·정책 버전 증가를 추가했다.
- [x] 표준 브라우저 구독 JSON과 엄격한 DTO 사이의 계약 오류를 RED→GREEN으로 수정했다.
- [x] 만료되거나 마지막 lease 중 종료된 AI 작업의 종료 상태를 RED→GREEN으로 수정했다.
- [x] 잘못된 AI 응답과 첨부 메타데이터의 수신 검증을 RED→GREEN으로 보완했다.
- [x] 실제 notification 마이그레이션 전체를 임시 PostgreSQL에 적용해 멱등 전송·만료·소유권·재시도를 검증했다.
- [x] 푸시 모듈 import와 동시 만료 응답의 DB 교착을 회귀 테스트로 재현하고 수정했다.
- [x] AI 503 중 수동 승인, 정상 재시도 결과·감사 기록, 보완 제출 후 이전 결과 무시를 실제 DB에서 확인했다.
- [x] 전체 브랜치 독립 검토를 수행하고 중요 지적 4건을 수정했다.
- [x] 두 서비스의 SQL/journal/snapshot 연결과 임시 DB 마이그레이션 적용을 확인했다.
- [x] `docs/attendance-rollout.md`와 환경변수 예시를 작성했다.
- [ ] 현장 좌표·반경 측정과 iOS/Android 실기기 위치·설치·푸시 검증은 출시 전 수행한다.

최종 범위 테스트는 `REQUIRE_ATTENDANCE_DB=1`로 실행했으며 18개 suite, 141개 테스트가 모두 통과했다.
어드민 TypeScript 검사와 user-service·ai·notification·file-service 빌드를 통과했다.
린트의 실행 범위와 환경 제약은 운영 문서의 검증 기록에 남긴다.
원격 DB 변경, 서비스 배포, push/merge는 실행하지 않았다.

사용자의 추가 화면 수정 요청을 반영해 시안의 이미지 경로와 드롭다운 화살표 간격을 수정했다.
종일 휴가 16~19일은 주 경계에서도 같은 색으로 이어지는 막대로 표시한다.
기간 등록은 공통 종류·시간을 한 번 입력하고, 날짜별 수정·제외·복원은 접힌 조정 영역에서 처리한다.
실제 `shared-calendar.tsx`의 연결 막대 및 공통 설정 구조와 시안을 맞췄다.
시안 변경은 브라우저에서 확인했으며 실제 운영 기록을 생성하지 않았다.

### 개인 일정 진입과 직원 일정 전환 추가 검증

사용자가 모바일 카드의 ‘내 일정’ 진입임을 명확히 했다.
모바일 캘린더는 본인 일정으로 시작하고 ‘다른 직원 일정 보기’와 ‘내 일정만 보기’로 전환한다.
캘린더 및 등록창의 경리나라 관련 안내 문구를 삭제했다.
승인 절차를 어디서 처리하는지에 관한 운영 정책은 변경하지 않았다.

실제 React 컴포넌트를 QueryClient에 준비한 데이터로 렌더링해 개인 화면의 타인 정보 미표시와 공유 화면의 소유자 전용 수정·삭제를 검증했다.
첫 렌더 테스트에서 날짜 버튼의 접근성 안내가 필터 전 데이터를 쓰는 문제가 재현되어 수정했다.
DB 통합 테스트에는 두 직원의 공유 조회, 타인 및 마스터의 타인 일정 변경 차단, 본인 삭제 후 타인 일정 보존을 추가했다.
범위 Jest는 19개 suite, 145개 테스트가 통과했다.
어드민 TypeScript와 변경 범위 ESLint도 통과했다.
정적 시안은 JavaScript 문법과 DOM 동작 검증으로 개인/공유 전환, 사용자별 연속 구간과 겹침 분리, 본인 수정만 허용, 날짜 제외·복원 및 오전/오후 반차 입력을 확인했다.

### 더 보기 버튼 동작 보완

사용자가 선택된 날짜의 ‘더 보기’를 눌러도 화면 변화가 없음을 보고했다.
기존 동작은 같은 날짜를 재선택해 상세 패널만 갱신했으므로 동일 날짜에서는 눈에 보이는 변화가 없었다.
실제 캘린더의 초과 인원 표시를 날짜 버튼과 분리한 독립 버튼으로 바꾸고, 날짜 전체 일정을 표시하는 조회 전용 모달을 연결했다.
모달을 닫아도 선택 날짜는 유지한다.
시안에도 같은 동작을 적용했다.
회귀 테스트 RED→GREEN, 출결 프런트 테스트 14개, TypeScript, 변경 파일 ESLint를 통과했다.
브라우저에서 16일의 더 보기 버튼을 직접 클릭해 ‘전체 일정 · 총 4명’ 모달과 네 직원의 휴가·반차·시간 표시를 확인했다.
