# User Service — CLAUDE.md

> 루트 `CLAUDE.md`의 공통 규칙(레이어 아키텍처, Drizzle 컨벤션, 에러 핸들링 패턴 등)은 여기서 반복하지 않는다.

## 1. 역할과 경계

### 책임지는 것
- 사용자 인증(로컬 회원가입/로그인, 카카오/네이버 소셜 로그인)
- JWT 토큰 발급/갱신/폐기 (Access 15분, Refresh 2주/자동로그인 90일)
- 사용자 프로필, 동의(consents), 위시리스트, 최근 본 상품 관리
- RBAC 역할/스코프 관리 (역할 할당, 만료 기한 지원)
- 사업자등록증 등록/심사
- 상점(Shop) 정보 관리
- Cafe24 계정 연동/마이그레이션
- 파일 업로드/삭제 (AWS S3)
- 휴대폰 인증 (인증코드 생성·검증. 문자 발송 자체는 notification 에 위임한다)
- 블랙리스트, 휴면/탈퇴 회원 관리 (Admin)

### 책임지지 않는 것
- 결제/지갑 — `wallet`
- 상품 마스터 데이터 — `pim`
- 재고/물류 — `wms`
- 주문/커머스 트랜잭션 — `medusa`
- 마켓플레이스 연동 — `channel-adapter` (Cafe24 토큰 관리는 user-service가 하지만, 주문/상품 동기화는 channel-adapter)
- 알림 발송 — `notification`

## 2. Source of Truth (SoT)

| 데이터 | 테이블 | 비고 |
|--------|--------|------|
| 사용자 계정 | `users` | loginId, email, password(bcrypt) |
| 사용자 프로필 | `profiles` | 전화번호, 주소(JSONB), 생년월일, 프로필 이미지 |
| 소셜 ID 연동 | `user_identities` | provider: kakao/google/naver |
| JWT 토큰 | `tokens` | access/refresh/verification, 폐기(isRevoked) 관리 |
| 역할/권한 | `roles`, `user_roles` | 스코프 기반 RBAC, 만료 기한 지원 |
| 동의 내역 | `user_consents` | 14세 이상, 약관, 마케팅 등 |
| 상점 정보 | `shops` | 업종, 카테고리(JSONB), 영업일(JSONB) |
| 사업자등록증 | `business_licenses` | 심사 상태(under_review/approved/rejected) |
| Cafe24 연동 | `cafe24_tokens`, `cafe24_links`, `cafe24_snapshots` | 멀티몰, 스냅샷 |
| 블랙리스트 | `blacklists` | soft delete |
| 위시리스트 | `wishlist` | (userId, productId) unique |
| 최근 본 상품 | `recent_views` | (userId, productId) unique |
| 휴대폰 인증 | `phone_verifications` | 목적별(phone_verify/pin_reset), 만료/시도 횟수 |

## 3. 핵심 설계 패턴 & 아키텍처 특이사항

### JWT 토큰 추출
Bearer 헤더 **또는** 쿠키(`accessToken`, `refreshToken`)에서 추출한다. Refresh Strategy는 `ignoreExpiration: true`로 설정하고 DB에서 폐기/만료를 직접 검증한다.

### @Public() 데코레이터
`JwtAuthGuard`가 글로벌 가드로 등록되어 있고, 인증 불필요 엔드포인트에 `@Public()`을 붙여 bypass한다. Cafe24 내부 API도 `@Public()`로 열려 있다(channel-adapter 서비스 간 호출용).

### 소셜 로그인 전략 조건부 로딩
`KAKAO_CLIENT_ID`, `NAVER_CLIENT_ID` 환경 변수 존재 여부에 따라 Passport Strategy를 동적으로 등록한다. 없으면 해당 소셜 로그인 비활성.

### Fastify 기반
Express가 아닌 Fastify를 사용한다. 파일 업로드는 `@fastify/multipart` + 커스텀 `FastifyFileInterceptor`로 처리한다.

### Soft Delete
사용자(`users.deletedAt`), 블랙리스트(`blacklists.deletedAt`) 모두 논리 삭제. 휴면 전환/영구 삭제는 Admin API를 통해 수행.

### Cafe24 조건부 Unique 인덱스
`cafe24_links` 테이블에서 `unlinkedAt IS NULL` 조건의 partial unique index를 사용하여, 해제 후 재연동을 허용한다.

### 토큰 테넌트 (멀티테넌트)
OAuth 액세스 토큰에는 `tenant` 가 실리고 `roles` 는 그 테넌트의 부여만 싣는다(`UsersService.getTokenRoleNames`). 토큰 테넌트는
클라이언트의 고정 테넌트(`oauth_clients.tenant_id`, 쇼핑몰 등)이거나, 비어 있으면(웹 직원 앱) 등록된 리디렉트 주소의 host →
`tenant_domains` 로 정한다 — 요청 파라미터·Host 헤더로 정하지 않는다. 준비·정지 테넌트는 발급·갱신을 거절하고 세션을 끊는다.
계정은 한 테넌트의 것이다(`users.tenant_id`, ADR-0056) — 계정의 테넌트 ≠ 토큰 테넌트면 코드 발급은 «없는 사용자»(400 `user not found`),
교환·갱신·핸드오프는 401 이고 갱신은 세션을 끊는다(`OAuthManager.assertAccountInTenant`).
내부 세션 토큰(`aud=user-service-internal`, 쇼핑몰·auth-web 쿠키)은 `tenant` 가 계정의 테넌트이고 역할은 그 테넌트의 부여만 싣는다 —
로그인한 도메인과 무관하다(테넌트 1 계정에게는 T). 클레임만 보는 core·file-service·ai 가 이 토큰의 테넌트를 알려면 클레임이 있어야 한다.
로그인(`POST /auth/signin`)은 auth-web 이 보증 헤더(`x-tenant-id` + `x-internal-secret`)로 화면 테넌트를 실으면 그 테넌트의 계정만 찾는다 —
다른 테넌트의 계정은 «아이디 또는 비밀번호 틀림»과 같다. 본문 필드가 아닌 건 옛 user-service 가 모르는 헤더를 무시해 auth-web 을 먼저
내보내도 되게 하려는 것이다. 헤더가 없으면 아직 전체에서 찾는다(읽기 전환 기간).
가입(`POST /auth/signup`)과 가입 폼의 사전 체크(`/users/*-available`)·소셜 로그인의 «기존 계정»·이메일 중복은 앱 설정 T 의 계정만 본다
(`UsersService.find…InTenant`·`findSocialAccountInTenant`). 이메일·아이디 unique 는 contract 마이그 전까지 전역이라 다른 테넌트 계정이 가진 값은
insert 에서 23505 로 걸린다 — 가입은 같은 409 문구로, 소셜 가입은 개인정보 없는 문구로 바꾼다(카카오 콜백이 오류 문구를 리디렉트 주소에 싣는다).
아이디·비밀번호 찾기·재설정(`/auth/forget-userid`·`forget-password`·`reset-password`, 레거시 이메일 토큰 포함)과 관리자 이메일 고객 조회
(`/users/find-by-email`)도 앱 설정 T 의 계정만 찾고, 찾기를 여는 휴대폰 인증도 T 의 기록만 본다 — 다른 테넌트의 같은 번호·아이디·이메일은 «없는 계정»이다.
전화번호·발송 대상으로 계정을 찾는 내부 라우트 넷(`/users/internal/contacts/by-phone`·`sms-audience`·`sms-audience/summary`·
`marketing-consent/withdraw`)은 호출자가 실은 `x-tenant-id` 의 계정만 보고, 헤더가 없거나 목록 밖이면 403 이다(`src/tenancy/internal-call-tenant.ts`).
userId 묶음 조회(`/users/internal/contacts`)는 거르지 않는다 — 계정 id 는 전역 UUID 이고 호출자가 자기 테넌트에서 얻은 id 다.
고객·근태처럼 T 의 데이터를 답하는 컨트롤러(또는 라우트)는 `@ServedTenantData()` 를 단다 — 토큰 테넌트 ≠ T 면 403.
어느 쪽인지 안 정한 컨트롤러는 `src/tenancy/served-tenant-classification.spec.ts` 가 빨갛게 한다.

이벤트 봉투의 테넌트는 «그 일이 일어난 화면의 테넌트»다 — `UserRequestTenantInterceptor` 가 요청마다 CLS `TENANT_CONTEXT_KEY` 를
세우고(판정 `src/tenancy/request-event-tenant.ts`), 못 정하면 T 로 찍힌다. 토큰 라우트는 토큰 `tenant`, 단 auth-web 서버가
`x-internal-secret`(= `OAUTH_INTERNAL_SECRET`)과 함께 실은 `x-tenant-id` 가 먼저다(판정 `src/tenancy/vouched-site-tenant.ts`) — 화면의
테넌트이고, 그다음이 토큰의 `tenant`(계정의 테넌트)다. 비밀 없는 헤더는 무시한다. 맥락만 세우고 거절하지 않는다.
계정 이벤트(모든 테넌트 서비스가 듣는 것)의 선언과 근거는 `packages/event-contracts/streams/user.stream.ts` 에 있다.

### 플랫폼 운영자 API (`/admin/platform/*`)
테넌트 행(준비 → 활성 ↔ 정지, 준비만 삭제)·소속 추가·웹 직원 앱 클라이언트의 테넌트 도메인 주소·직원 비밀번호 재발급·운영자 성질은
`src/api/iam/platform/` 이 연다. 라우트 문은 `iam.tenant.read`/`iam.tenant.write` 이고 판정은 Manager 가 운영자 성질
(`users.is_platform_operator`)로 한다 — 테넌트 안의 master 도 운영자가 아니면 403. 기존 계정 만들기·역할 만들기·역할 부여는
`tenantId` 를 받는데, 지정하면 운영자만 된다(`PlatformOperatorManager.workingTenant`). 정지는 그 테넌트의 `oauth_tokens` 를
그 자리에서 끊는다. 대행해 만드는 직원 계정은 `UserCreated` 를 내지 않는다(고객 가입 이벤트다).
남은 액세스 토큰은 core 가 막는다 — `GET /internal/iam/tenant-statuses`(내부 키, id·상태만)를 15초마다 받아 정지·준비 테넌트의
사람 토큰을 403 한다(`apps/core/src/platform/tenancy/tenant-status-cache.ts`).
`GET /tenant-brand?host=` 는 로그인 전 브랜드 조회라 공개이고 이름·로고·활성 여부만 돌려준다.
`GET /tenant-brand/site?host=` 는 auth-web 서버 전용(`x-internal-secret` = `OAUTH_INTERNAL_SECRET`)이라 테넌트 id 와 그 테넌트의
도메인 전부를 더한다 — auth-web 이 테넌트 화면의 리디렉트를 그 안에 가둔다. 테넌트 도메인은 앱마다 하나다(admin-web 주소·auth-web
주소, CloudFront 배포가 앱마다 따로라). 이미 있는 테넌트에 더하는 길은 `POST /admin/platform/tenants/:id/domains`.

### 테넌트 안의 직원 관리 (ADR-0056)
계정은 한 테넌트의 것이라, 직원 계정과 역할은 **그 테넌트의 관리자**(`iam.admin_user.write`·`iam.role.assign` 을 가진 사람, 보통
그 테넌트의 `master`)가 토큰 테넌트 안에서 관리한다. 만들기는 `POST /admin/auth`(계정의 테넌트 = 토큰 테넌트, 중복은 그 테넌트
안에서만 — unique 가 아직 전역이라 다른 테넌트의 값은 insert 23505 를 같은 409 로), 부여·회수는 `/admin/users/:id/(staff-)roles`·
`/admin/roles/:id/members`, 비밀번호 초기화는 `POST /admin/auth/staff/:userId/password`(`StaffPasswordManager` — 새 비번을 한 번만
돌려주고 변경 강제·세션 끊기·이력). iam Manager 가 «계정의 테넌트 ≠ 일하는 테넌트»면 주기·늘리기·비번 초기화를
`IAM_NOT_ACCOUNT_TENANT`(409)로 거절한다 — 고객 역할도 같다. 회수는 거절하지 않는다(그 테넌트에 남은 어긋난 부여를 거두는 길).
비번 초기화는 지금 유효한 직원 역할이 있는 계정만 되고(고객은 404), 권한 상승 방지(`GrantAuthority`)를 그 계정의 역할에 대고 지나며, 운영자 계정은 운영자만 초기화한다.
관리자의 고객 비밀번호 변경(`PATCH /admin/auth/change-password`, T 전용)도 T 의 계정만 찾는다.
⚠️ 부여 읽기(`GET /admin/users/:id/roles`·`/admin/roles/:id/members`)는 아직 테넌트로 거르지 않는다 — 테넌트 만들기 스크립트의 재실행 판정이 운영자 토큰으로 다른 테넌트 구성원을 읽기 때문이다. 스크립트를 바꾸는 쪽이 함께 거른다.
소속은 판정에 쓰지 않지만 contract 까지 계속 쓴다(되돌린 옛 코드는 소속으로 판정한다). 테넌트 셸에는 아직 이 화면이 없다(API 만).

### 역할 만료
`user_roles.expiresAt`으로 시한부 역할 할당을 지원한다.

### Throttling
`ThrottlerModule.forRoot({ ttl: 60000, limit: 10 })` 이 등록돼 있지만 **`ThrottlerGuard` 가 `APP_GUARD` 로 등록돼 있지 않아 이 기본값은 어디에도 적용되지 않는다.** 실제로 제한이 걸린 곳은 `@UseGuards(ThrottlerGuard)` 를 직접 단 3곳뿐:

| 엔드포인트 | 제한 |
|---|---|
| `POST /twilio/send-message` | 3회/분 |
| 이메일 인증코드 발송 | 3회/분 |
| 이메일 인증코드 검증 | 10회/분 |

전역 등록을 검토했으나 보류했다. user-service 는 공개 ALB(`user.<base>`) 뒤에 있고 `main.ts` 가 `trustProxy: true` 라 ThrottlerGuard 가 `req.ip` 로 카운트하는데, auth-web 등 호출자가 **서버사이드에서** 이 ALB 를 호출하므로 모든 최종 사용자의 요청이 호출 서비스의 IP 하나로 뭉친다. 전역 10회/분을 걸면 동시 가입 2건 수준에서 정상 사용자가 429 를 맞는다. 즉 IP 기준 스로틀은 여기서 정상 트래픽만 막고 공격자는 거의 못 막는다.

**대안은 자원 기준 카운터다** — `phone_verifications.attempts` 처럼 IP 가 아니라 대상 레코드에 시도 횟수를 누적하면 프록시 뒤에서도 정확히 동작한다.

### 스케줄 작업
`@nestjs/schedule`로 만료된 휴대폰 인증 코드를 자동 처리한다(ExpireExistingCodesService).

## 4. 다른 앱/라이브러리와의 연동

### 사용하는 공유 라이브러리
| 라이브러리 | 용도 |
|-----------|------|
| `@app/db` | `DbService`, `@InjectDb` |
| `@app/events` | `StreamPublisher` — Kafka 이벤트 발행 |
| `@app/authorization` | `StoreRoute`, `RequirePermission`, `PermissionGuard`, `JwtAuthGuard` |
| `@app/shared` | `CurrentUser`, `GlobalExceptionFilter`, `ResponseInterceptor` |
| `@packages/event-contracts` | `UserEvents`, `USER_STREAM` 이벤트 타입 |

### 발행하는 이벤트 (Kafka Stream: `users.events.v1`)
| 이벤트 | 발생 시점 |
|--------|----------|
| `UserCreated` | 회원가입 |
| `UserEmailVerified` | 이메일 인증 완료 |
| `UserUpdated` | 프로필 수정 |
| `UserVerification` | 인증 요청 |
| `Cafe24Linked` / `Cafe24Unlinked` | Cafe24 연동/해제 |
| `BusinessLicenseApproved` | 사업자등록증 승인 |
| `UserDormantConverted` | 휴면 전환 |
| `UserPermanentDeleted` | 영구 삭제 |

### 서비스 간 내부 API
- **channel-adapter → user-service**: `/cafe24/internal/link-info`, `/cafe24/internal/links` (Public 엔드포인트, 인증 없이 호출)

## 5. 스키마 구조 요약

```
users ──┬── profiles (1:1)
        ├── user_identities (1:N, provider별)
        ├── tokens (1:N)
        ├── user_roles (N:M) ── roles
        ├── user_consents (1:1)
        ├── shops (1:1) ── business_licenses (1:1)
        ├── blacklists (1:1)
        ├── wishlist (1:N)
        ├── recent_views (1:N)
        └── cafe24_links (1:N) ── cafe24_snapshots (1:1)

cafe24_tokens (독립, mallId 기준)
phone_verifications (독립, 전화번호 기준)
```

스키마 파일: `database/drizzle/schema.ts`

## 6. 주요 환경 변수

| 변수 | 용도 |
|------|------|
| `AUTH_SECRET` | JWT Access Token 시크릿 |
| `JWT_REFRESH_SECRET` | Refresh Token 시크릿 |
| `JWT_VERIFICATION_TOKEN_SECRET` | 이메일 인증 토큰 시크릿 |
| `KAKAO_CLIENT_ID/SECRET/CALLBACK_URL` | 카카오 OAuth (선택) |
| `NAVER_CLIENT_ID/SECRET/CALLBACK_URL` | 네이버 OAuth (선택) |
| `NOTIFICATION_SERVICE_URL`, `NOTIFICATION_INTERNAL_KEY` | 인증문자 발송을 notification 에 위임 (→ `POST /internal/sms/send`) |
| `AWS_ACCESS_KEY_ID/SECRET_ACCESS_KEY/REGION/S3_BUCKET` | S3 파일 업로드 |
| `CAFE24_CLIENT_ID/CLIENT_SECRET/SERVICE_KEY` | Cafe24 연동 |
| `CORS_ORIGIN_DOMAIN`, `COOKIE_DOMAIN` | CORS/쿠키 설정 |
| `TENANT_LIST`, `TENANT_GATE_MODE`, `SERVED_TENANT_ID` | 테넌트 목록·전환 모드·앱 설정 T (`@app/tenancy`, 기본값 없음 — 빠지면 기동 거부) |

환경 변수 검증: `src/config/env.validation.ts` (Zod 스키마, 앱 시작 시 검증)
