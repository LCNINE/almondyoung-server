# 관리자 계정 관리 (master 전용) — 설계 스펙

- 작성일: 2026-07-07
- 브랜치: `feature/admin-account-management`
- 상태: 설계 확정 (구현 계획 착수 전)

## 1. 배경 / 현재 상태

RBAC 는 **분산 2계층** 구조다 (자세한 지도는 memory `project_rbac_distributed_authz`):

- **role 식별 SoT** = user-service `public.roles` ← `public.user_roles` → `public.users`. role 은 `master` / `admin` / `membership` / `user`.
- **role → scope 매핑** = 각 앱이 자기 DB 에 복제한 `auth` 스키마 (`auth.scopes`, `auth.role_scope_mapping`). role_name 문자열이 JWT `roles[]` 로 흐르는 서비스간 계약. **하드코딩된 시드로 관리하며 이번 작업 범위 밖.**
- **`master`** 는 하드코딩된 슈퍼권한 (role 이름 `master` 또는 scope `master` 보유 시 모든 체크 통과).

admin-web 현재 상태:

- **`/users`** ("관리자 계정"): 목록을 `roleName: 'admin,master'` 로 필터해 관리자 계정만 노출. 페이지 가드 `RouteGuard requireRole={['admin','master']}`. 상세 `/users/[id]` 는 페이지 가드 **없음**.
- 역할 편집: 상세 "권한" 탭(역할 토글 → `PUT /admin/users/:id/roles`) + 목록 "역할 부여" 일괄 모달. 두 경로 모두 백엔드에서 **master 전용**(`GET /admin/roles`, `PUT /admin/users/:id/roles` = `@RequireScopes('master')`).
- **`/account/customer`** ("고객 목록"): user-service 일반 회원 열람 화면. 가드 `['admin','master']`.
- `usePermission()` 훅 존재: `hasRole(names)` (myRoles 기반), `hasScope(names)`.

**핵심 문제**: UI 가드(`admin`+`master`)와 API 가드(`master` 전용)가 어긋나 있어, **non-master admin 이 역할 편집/저장 버튼을 누르면 403** 이 뜬다.

## 2. 목표

1. admin 이 자기 권한 밖 기능 버튼을 눌러 403 을 만나는 경험을 없앤다.
2. 일반 회원 열람에 마찰이 없게 한다.
3. master 는 **랜덤 초기 비밀번호로 새 관리자 계정을 생성**하고, **역할을 자유롭게 부여/박탈**할 수 있어야 한다.

## 3. 비목표 (YAGNI)

- 역할 CRUD·역할↔스코프 매핑 편집 UI (하드코딩 시드 유지).
- 이메일 초대 / 임시비번 메일 발송.

## 4. 확정된 결정

| # | 결정 | 근거 |
|---|------|------|
| D1 | **관리자 계정 관리 화면은 master 전용** (메뉴 + 페이지 자체). non-master admin 은 일반 회원(고객) 관리만. | 버튼 숨김이 아니라 화면 단위 분리라 403 이 구조적으로 안 남. "master 가 관리, admin 은 일반회원" 멘탈모델과 일치. |
| D2 | 초기 비번 = **서버 랜덤 생성** + 생성 성공 시 화면 1회 노출 + `must_change_password` 플래그 + **첫 로그인 시 강제 변경(변경 페이지 redirect)**. | 이메일 인프라 없이 즉시 가능. "유도"에 실효성 부여. |
| D3 | 계정 생성 시 **단일 역할** 할당 (현 `CreateAccountDto.roleId` 단수). 추가 역할은 생성 후 권한 탭에서. | 최소 변경. |
| D4 | 백엔드 계정 생성·역할 API 를 **master 전용으로 조임** (현재 `admin:users:modify` 도 허용 → 제거). | UI 화면 분리와 심층 방어 일치. |

## 5. 설계

### 5.1 권한 게이팅 3겹 (403 원천 차단)

프론트 게이팅 기준은 **role** (`usePermission().hasRole(['master'])`) — role-scope 가 하드코딩이라 role 기준이 단순하고 멘탈모델과 맞음.

1. **메뉴 게이팅** — `MenuItem` 타입에 `requireRole?: string[]` 옵션 추가. 사이드바(`app-sidebar.tsx`)가 렌더 시 `hasRole` 로 필터. `menu.ts` 의 `admin-accounts`(`/users`) 항목에 `requireRole: ['master']`. → non-master 에겐 메뉴 자체가 안 보임.
2. **페이지 가드** — `/users/page.tsx` 및 `/users/[id]/page.tsx` 의 `RouteGuard requireRole` 를 `['master']` 로. 상세 페이지엔 현재 가드가 없으므로 **추가**. `/account/customer` 는 `['admin','master']` 유지.
3. **백엔드 일치 (심층 방어)** — `POST /admin/auth`, `/admin/roles*`, `PUT /admin/users/:id/roles` 의 `@RequireScopes` 에서 `admin:users:modify` 를 제거하고 **`master` 만** 남긴다.

### 5.2 관리자 계정 콘솔 (`/users`, master 전용)

- 목록 (admin,master 필터), 역할 부여/박탈(권한 탭 + 일괄 모달): **기존 유지** — 이제 master 전용 페이지 안에 있음.
- **[신규] "관리자 추가" 다이얼로그**: 입력 `{loginId, email, username, nickname, 초기 역할(admin|master), phone_number?}`. **비밀번호 입력란 없음.** 제출 → `POST /admin/auth`.
- 생성 성공 응답으로 받은 **평문 초기 비밀번호를 성공 다이얼로그에 1회 노출**(복사 버튼) + "이 비밀번호는 지금만 표시되며, 해당 관리자는 첫 로그인 시 변경해야 합니다" 안내.

### 5.3 초기 비번 & 첫 로그인 변경

**스키마 (user-service):**
- `users.must_change_password boolean NOT NULL DEFAULT false` 추가. additive → 단일 PR 가능.
- 생성 명령: `npm run db:generate:user-service -- --name add-must-change-password`.

**계정 생성 (`POST /admin/auth`, `admin/auth.service.ts createAccount`):**
- `CreateAccountDto` 에서 `password` 필드 **제거**.
- 서버가 crypto 안전 랜덤 비밀번호 생성 (비번 정책 충족 — 대소문자/숫자/특수문자, 예 16자) → bcrypt 해시 저장.
- `must_change_password = true` 로 삽입.
- 응답에 **평문 초기 비밀번호를 1회 반환** (`{ user, initialPassword }`). 이후 어디에도 평문 저장/재조회 없음.

**세션에 플래그 노출 (확정: id token claim):**
- OIDC id/access token 발급 시 `must_change_password` claim 추가 (role claim 주입 지점 `users.service.getUserRoleNames` 인접). role 이 이미 토큰으로 흐르므로 같은 경로를 재사용 → admin-web `middleware.ts` 가 별도 fetch 없이 토큰에서 바로 읽어 redirect 강제 가능.
- `/users/me` 응답에도 `mustChangePassword` 필드를 함께 노출하되, 이는 표시/확인용 보조 surface 이고 **강제 판단의 소스는 token claim** 으로 단일화한다.

**첫 로그인 강제 변경 (admin-web):**
- 로그인 후 세션에 `must_change_password === true` 면 **비밀번호 변경 페이지로 redirect**, 변경 전에는 다른 화면 접근 차단 (middleware 또는 최상위 레이아웃 가드).
- 변경은 기존 self 엔드포인트 **`POST /auth/change-password`** (`currentPassword` + `newPassword`, `@CurrentUser()`) 재사용.
- 서버는 이 self 변경 성공 시 해당 사용자의 `must_change_password = false` 로 클리어.

### 5.4 일반 회원 열람 마찰 제거 (`/account/customer`)

- `CustomerListTemplate` 및 그 하위 액션이 호출하는 엔드포인트를 감사 → **master 전용 API 를 부르는 버튼이 있으면** 숨기거나 admin 스코프(`admin:users:read/modify/archive/purge`) 엔드포인트로 교체.
- 읽기(`GET /admin/users`)는 `admin:users:read` 를 허용하므로 열람 자체는 기본 OK. 감사에서 위반이 없으면 이 절은 no-op 로 종결.

### 5.5 정리(cleanup) 후보 — 이번 작업 중 손대는 김에

- 미사용 `roleApi.createRole/updateRole/deleteRole` (`lib/api/domains/roles/index.ts`), 미사용 `lib/types/dto/scopes.ts` — dead code 제거 검토. (하드코딩 방침과 충돌하는 잔재.)
- `usePermission().hasScope` 의 `s.scopes.scope_name` 접근 형태가 role 구조와 어긋나 보임 — 이번엔 role 기준 게이팅만 쓰므로 손 안 대되 주석/이슈로 기록.
- 루트 CLAUDE.md 표의 `@app/roles`·`@app/auth-core` 실존하지 않음 — 문서 드리프트, 별도 정리.

## 6. 영향 파일 지도

**백엔드 (user-service):**
- `apps/user-service/database/drizzle/schema.ts` — `users.must_change_password` 컬럼 + 마이그레이션.
- `apps/user-service/src/api/admin/auth/auth.controller.ts` / `auth.service.ts` / `dto/create-account-dto.ts` — 비번 제거·랜덤 생성·플래그 세팅·초기비번 반환·스코프 조임.
- `apps/user-service/src/api/auth/auth.service.ts` (`changePassword`, line ~939) — self 변경 성공 시 플래그 클리어.
- OIDC 토큰/`me` claim 주입 지점 (`apps/user-service/src/api/users/users.service.ts` `getUserRoleNames` 인접, `apps/user-service/src/api/oauth/oauth.controller.ts`).
- 역할 API 스코프: `apps/user-service/src/api/admin/roles/roles.controller.ts`, `apps/user-service/src/api/admin/users/users.controller.ts`.

**프론트 (admin-web):**
- `apps/admin-web/src/lib/utils/menu.ts` — `MenuItem.requireRole`, `admin-accounts` 게이팅.
- `apps/admin-web/src/components/layout/app-sidebar.tsx` — `hasRole` 필터.
- `apps/admin-web/src/app/(admin)/users/page.tsx`, `.../users/[id]/page.tsx` — `RouteGuard` → `['master']`.
- `apps/admin-web/src/features/users/**` — "관리자 추가" 다이얼로그 + 초기비번 노출.
- 첫 로그인 강제 변경: `apps/admin-web/src/middleware.ts` 또는 상위 레이아웃 + 비번변경 페이지, `usePermission`/세션 payload 확장.
- `apps/admin-web/src/features/customers/**` — 일반 회원 페이지 액션 감사.

## 7. 테스트 고려

- 단위: 랜덤 비번 생성(정책 충족), `must_change_password` set/clear.
- 통합/itdoc: 관리자 생성 → 초기비번으로 로그인 → 강제 변경 페이지 → 변경 성공 → 플래그 클리어 → 정상 진입.
- 게이팅: non-master admin 이 `/users` 접근 시 redirect, 메뉴 미노출, 백엔드 role API 403(방어) 확인.
- 회귀: master 는 생성/부여/박탈 전 경로 정상.
- 전체 jest 일괄 실행 금지 (OOM) — 변경 구현 부분으로 좁혀 실행 (memory `feedback_no_test_runs`).

## 8. 롤아웃 / 마이그레이션

- `must_change_password` 는 **additive nullable-default 컬럼** → 코드 변경과 같은 PR 가능 (ADR-0005 expand 규칙).
- destructive 변경 없음. 백엔드 스코프 조임은 behavior change 지만 비파괴적.
- 마이그레이션 파일은 `schema.ts` 변경과 **한 커밋**에 함께.

## 9. 열린 위험

- OIDC id/access token 에 claim 추가 시 admin-web 토큰 검증(JWKS) 경로가 새 claim 을 문제없이 통과하는지 확인.
- 5.4 감사에서 일반 회원 페이지에 master 전용 액션이 발견되면 별도 처리 필요 (설계상 no-op 가정).
- 관리자 계정이 admin-web 외 다른 클라이언트로도 로그인한다면 첫-로그인 강제가 그 경로엔 적용 안 됨 — 현재 관리자는 admin-web 전용 로그인이라는 전제.
