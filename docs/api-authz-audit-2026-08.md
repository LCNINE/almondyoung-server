# API 인가(authorization) 감사 현황판 (2026-08)

> 출처: 2026-08-07 `apps/` 전 NestJS 백엔드 HTTP 라우트 인가 전수 감사.
> 이 문서가 **상황판(허브)** 이다. 항목 착수/완료 시 상태를 갱신한다.
> 상태: ⬜ 미착수 / 🟨 진행 / 🟩 완료 / ⏸ 보류(사유 명기)
>
> 도구: `node scripts/security/route-authz-audit.js` — 이 문서의 모든 수치는 이 스크립트 출력이다.

## 0. 한 줄 요약

라우트 883개 중 **인가 가드 축(PR #572)과 무인증 내부 API(P0)는 정리 완료**. 남은 것은
**(a) IDOR 전수 95건 — 최대 계열**, (b) 인증 설계 부채 2건(하드코딩 크레덴셜은 코드 제거
완료 · Neon 프로젝트 삭제가 사람 작업으로 남음), (c) 조용히 죽은 경로 4건.

P1 착수 설계는 `docs/superpowers/specs/2026-08-08-p1-idor-audit-design.md`,
실행 계획은 `docs/superpowers/plans/2026-08-08-p1-idor-audit.md` 다.

---

## 1. 완료 🟩 — PR #572 (`30e9d3848`, 2026-08-07 머지 + live 배포)

**무엇이 문제였나**: `ScopeGuard.canActivate` 는 `@RequireScopes` 메타데이터가 **없으면 통과**시킨다.
core 는 이 가드를 전역 등록하지 않고 컨트롤러마다 수동으로 붙였다 → 스코프를 안 붙인 라우트
351건이 "유효한 JWT 만 있으면 누구나" 였다. core 가 `/store/*`(고객)와 `/admin/*` 를 같은 앱·같은
전역 `JwtAuthGuard` 로 서빙하고 모든 서비스가 `AUTH_SECRET` 하나를 공유하므로, **쇼핑몰 고객
토큰으로 재고 조정·환불 승인·SKU 삭제가 가능**했다.

**해결**: `AdminRealmGuard`(`libs/authorization/src/guards/admin-realm.guard.ts`) 를 전역 등록해
기본값을 뒤집었다. `@Public`/`@OptionalAuth`/`@StoreRoute`(신규)/`@RequireScopes` 중 하나라도
있으면 각자의 정책에 위임, 없으면 `admin`/`master` 필요.

- core / notification / channel-adapter 에 적용. notification·channel-adapter 는 **인증 자체가
  없었다**(공개 ALB 노출) → `AuthorizationModule` + 전역 가드 신설.
- 회귀 가드 2종: `admin-realm.guard.spec.ts`, `apps/core/src/platform/auth/scope-guard-binding.spec.ts`
  (후자는 AST 로 `@RequireScopes` ↔ `ScopeGuard` 짝을 **핸들러 단위**로 검사 — 짝이 깨지면 두
  가드를 동시에 통과하는데 무증상이다).

**고객 영향 없음을 확인한 방법**: 스토어프론트에서 core 로 나가는 호출 27건을 개행 포함 파싱으로
전수 추출하고 각각의 `withAuth` 를 확인. 고객 토큰을 실제로 보내는 건 `/store/orders/*` 8건과
`/library/ownerships*` 3건뿐 — 전부 `@StoreRoute` 로 덮었고, 두 서비스 모두 소유권 검사
(`assertOwnership`, `eq(customerId, ...)`)가 실재함을 확인했다.

---

## 1-2. 완료 🟩 — P0 무인증 내부 API (2026-08-07, 배포 2단계)

**무엇이 문제였나**: 아래 3개 라우트가 `@Public()` 만 붙고 키 검증이 없어 공개 ALB 에서 누구나
호출 가능했다.

| # | 라우트 | 위험 |
|---|---|---|
| P0-1 | `POST /reviews/eligibilities` (ugc) | 바디의 `userId` 로 리뷰 자격 발급 → 리뷰 작성 시 `review-reward-publisher.service.ts:23` 이 `EarnPointsRequested` 발행 → wallet `ugc-command.consumer.ts:15` 가 포인트 적립. **무인증 포인트 발행 체인** |
| P0-2 | `POST /membership/benefits/internal/{record,cancel}` | 임의 `userId` 의 멤버십 절약액 조작. `cancel` 은 `orderId` 만으로 남의 기록 취소 |

**해결**: ugc 에 `UgcInternalApiKeyGuard` + `@UgcInternalAuth()` 신설(membership 패턴 복제,
fail-closed), membership 두 건은 기존 `@MembershipInternalAuth()` 로 전환. 호출자(Medusa)는
`Authorization: Bearer` 를 보낸다. 새 SST 시크릿 `UgcInternalKey`.

**왜 PR 이 아니라 배포를 둘로 쪼갰나** — Medusa·ugc·membership 이 **한 `sst deploy` 로 같이 뜬다**.
태스크 교체 순서를 통제할 수 없는데, ugc 리뷰자격 등록은 `confirm-purchase-workflow` 의 **step 2**
라 실패가 step 1(결제 캡처) **롤백**으로 번진다 → 가드가 키보다 먼저 뜨면 고객 구매확정이 깨진다.
그래서 ①호출자가 키를 보내는 배포 → ②가드를 켜는 배포로 분리했다. 각 단계는 단독으로 무해하다.

**감사 문서에 없던 발견**: 스토어프론트도 `POST /reviews/eligibilities` 를 고객 토큰으로 호출하고
있었다(`lib/api/ugc/reviews.ts`). 다만 `userId` 를 안 보내 **항상 400** 이었고 `orders.ts` 의
try/catch 가 삼켜 왔다 — 같은 일을 Medusa 워크플로가 이미 하므로 중복이고, 누가 `userId` 를 채워
"고치면" 취약점이 되살아나는 지뢰라 삭제했다.

**회귀 가드**: `scripts/security/route-authz-audit.spec.ts` — 감사 도구를 그대로 돌려
membership·ugc 에 **키 검증 없는 `@Public` 쓰기 라우트가 0** 임을 못 박는다(허용 목록은 비어 있고,
추가하려면 이유를 적어야 한다). 개별 라우트가 아니라 **규칙**으로 걸어야 다음 사고를 잡는다.
가드 자체 spec 도 양쪽에 신설(membership 은 그동안 spec 이 0개였다).

**같이 고친 것**: 감사 도구 `--json` 이 `process.exit(0)` 때문에 stdout flush 전에 죽어 출력이
잘리고 있었다(883 라우트에서 실제로 잘림). 사람 출력이 JSON 에 섞이던 것도 함께 정리.

---

## 2. 미해결 — 우선순위 순

### P0 🟩 무인증 내부 API 2건 — 해결 (위 §1-2, 배포 순서는 §4)

### P1 ⬜ IDOR 전수 조사 — 95건 (그중 쓰기 37건)

**이게 남은 최대 계열이다.** 아래는 "인증만 통과하고 인가 표시가 없는" 라우트 = 서비스 계층이
호출자 본인의 데이터로 범위를 좁혀야만 안전한 것들. `where(userId = ...)` 하나만 빠져도 남의
데이터가 열린다. **grep 으로는 못 세고 엔드포인트별로 읽어야 한다.**

| 앱 | 전체 라우트 | IDOR 검사 대상 | 그중 쓰기 | @Public |
|---|---|---|---|---|
| core | 476 | 22 (`@StoreRoute`) | 8 | 10 |
| user-service | 118 | 20 | 10 | 38 |
| membership | 73 | 26 | 7 | 5 |
| ugc-service | 33 | 12 | 7 | 8 |
| file-service | 9 | 5 | 3 | 4 |
| notification | 51 | 2 (`@StoreRoute`) | 2 | 4 |
| search | 4 | 4 | 0 | 0 |
| analytics | 4 | 4 | 0 | 0 |
| channel-adapter | 19 | 0 | 0 | 6 |
| wallet | 96 | 0 (전부 인가 있음) | 0 | 0 |
| **합계** | **883** | **95** | **37** | **75** |

**이미 확인해서 정상인 것 (재검 불필요)**:
- core `store-return-exchange.service` — 모든 경로에서 `assertOwnership(so, customerId)`
- core `ownership.service` — `eq(digitalAssetOwnerships.customerId, customerId)` + `_loadOwnedOrThrow`

**우선 볼 곳 (영향 큰 순)**:
1. `file-service` 5건 — `GET /files/:fileId/download`, `GET /files/:fileId/metadata`,
   `DELETE /files/:fileId` 가 인증만 통과한다. fileId 가 UUID 라 추측은 어렵지만, ID 가 새는
   경로(리뷰 이미지·상품 이미지 URL)가 많다. **DELETE 가 특히 위험**.
2. `membership` 26건 — `/subscriptions/*`(구독·해지·환불), `/membership/savings/*`, `/pause/*`.
   금전 영향.
3. `ugc-service` 12건 — `PATCH|DELETE /reviews/:id`, `PATCH|DELETE /qna/questions/:id`.
   남의 리뷰 수정/삭제 가능 여부.
4. `user-service` 20건 — `/users/me`, `/wishlist`, `/recent-views`, `/cafe24/link`,
   `/business-licenses/me`. 대부분 `me` 계열이라 안전할 가능성이 높지만 `:id` 를 받는 것 주의.
5. `core` 22건(`@StoreRoute`) — 위 2건은 확인 완료, 나머지 `store-sales-orders.service` 확인 필요.

**방법**: 라우트별로 컨트롤러 → 서비스 → 리포지토리를 따라가 `userId`/`customerId` 가
**쿼리 조건에 실제로 들어가는지** 확인한다. 파라미터로 받기만 하고 안 쓰는 경우가 함정이다.

### P2 🟨 인증 설계 부채 2건 — 크레덴셜 건은 코드 제거 완료, 사람 작업 대기

- **`libs/authorization/src/strategies/jwt-access.strategy.ts:110`** — `if (payload?.iss)` 조건
  때문에 `iss` 클레임 없는 HS256 토큰은 **issuer/audience 검증을 통째로 건너뛴다**. 레거시 Medusa
  토큰 호환이 의도. IdP·Medusa·core·wallet·file-service 가 `AUTH_SECRET` 하나를 공유하므로 한
  서비스에서 시크릿이 새면 전 서비스 위조가 된다.
- 🟩 **하드코딩 DB 크레덴셜 — 코드 제거 완료 (2026-08-08)**. 이 항목은 원래
  `apps/channel-adapter/src/adapter.module.ts` 1건으로 적혀 있었으나, 전수로 훑으니
  **3개 Neon 프로젝트 × 5곳**이었다. 4곳은 죽은 코드였고(도달 불가 fallback 1, 없는 모듈을
  import 해 실행 불가능한 테스트 2, import 하는 곳이 없는 파일 1), `apps/membership/drizzle/seed.ts`
  만 **살아있는 진입점**이라 `DATABASE_URL` 없이 `npm run db:seed` 를 돌리면 클라우드 DB 에
  시드를 썼다. 회귀는 `scripts/security/no-cloud-credentials.spec.ts` 가 막는다.
  - ⚠️ **크레덴셜 자체는 여전히 유효하다.** 코드에서 지워도 공개 이력에서 회수되지 않는다
    (`docs/git-history-rewrite-2026-08-07.md`). 남은 건 **사람 작업**이다:
  - [ ] Neon 프로젝트 `ep-divine-hill-a1nspuc3` 삭제 (membership)
  - [ ] Neon 프로젝트 `ep-young-pine-a149ey1z` 삭제 (wallet)
  - [ ] Neon 프로젝트 `ep-young-thunder-a1bkhlx2` 삭제 (channel-adapter)

### P3 ⬜ 조용히 죽어 있는 경로 4건 + 의도 확인 1건

전부 **PR #572 이전부터** 실패하던 것. 고치는 건 동작 변경이라 기능 요구 확인이 먼저다.

- 스토어프론트 `GET /categories`(+`/:id`,`/children`,`/path`) — `withAuth:false` 인데 core 는
  `@Public` 이 아님 → **항상 401**. 같은 이유로 `/variants/*`, `/masters/:id/versions*`,
  `/masters/:id/pricing/*` 도 401 (총 13건).
  - ⚠️ **함정**: 이걸 고치려고 스토어프론트에서 `withAuth:true` 로 바꾸면 이번엔
    `AdminRealmGuard` 403 이 된다(고객 토큰은 admin 아님). **올바른 해법은 core 에 `@Public()`**.
  - 단 `/masters/:masterId/versions*` 는 **미게시 버전 노출** 가능성이 있어 카탈로그 읽기와 한
    묶음으로 공개하면 안 된다 — 도메인 판단 필요.
- 스토어프론트 `GET /products` — core 에 해당 컨트롤러가 없음 → **404** (죽은 호출)
- notification `/devices/fcm-token` — `JWT_ACCESS_SECRET` 이 배포 env 에 없음 → **항상 401**
  (`getOrThrow` 가 try 안이라 catch 가 401 로 삼킨다)
- channel-adapter → core `POST /channel-listings` — 인증 헤더를 안 보냄 → **항상 401**
- **의도 확인**: `search` 4개 읽기 라우트에 인증이 전혀 없다(상품검색·연관검색어·추천).
  공개 카탈로그 검색이라 의도일 가능성이 높지만 확인 필요.

---

## 3. 방법론 — 다음 세션이 반드시 읽을 것

### 3-1. 앱마다 인가 관용구가 다르다 (이걸 모르면 결과가 통째로 위양성)

`scripts/security/route-authz-audit.js` 의 `APPS` 맵이 이 지식을 담고 있다. **새 앱을 추가하면
맵부터 갱신**할 것.

| 앱 | 인가 방식 |
|---|---|
| core, notification, channel-adapter | `AdminRealmGuard` 전역 — 표시 없으면 admin/master (기본 차단) |
| user-service, membership, file-service, ugc-service | `ScopeGuard` **전역** — `@RequireScopes` 만으로 강제됨 |
| membership | 추가로 `@MembershipAdminAuth()`, `@MembershipInternalAuth()` |
| wallet | `WalletAuthGuard` 전역. `@WalletAdminAuth()`/`@WalletJwtAuth()`, **표시 없으면 API key 요구**(기본 차단) |
| search, analytics | 전역 가드 없음 (analytics 는 라우트별 `@UseGuards(JwtAuthGuard)`) |

초기 감사에서 이 맵 없이 돌려 user-service 60건 / ugc 13건을 "`@RequireScopes` 무력화" 로
**오보**했다. 전역 ScopeGuard 를 못 본 탓이다.

### 3-2. 함정 — 이번에 두 번 밟았다

- **줄 단위 grep 은 멀티라인 호출/데코레이터를 통째로 놓친다.**
  (1) 여러 줄 `@ApiResponse({...})` 가 낀 핸들러를 놓쳐 무방비 쓰기를 105건으로 과소집계(실제 207).
  (2) 스토어프론트 `api("svc",\n "path")` 를 놓쳐 core 호출을 6건으로 과소집계(실제 27).
  → **전수 집계는 TS AST 또는 개행 허용 파서(`re.S`)로만 한다.**
- **`type-check:scoped` 의 include 는 bulk-session 등 5개뿐**이다. 변경 파일이 안 들어가면
  통과해도 의미가 없다. 임시 tsconfig 를 **repo 루트에** 만들어 검사할 것 (루트 밖에 두면
  typeRoots 가 안 풀려 `Cannot find type definition file for 'jest'`).
- 이 레포는 **npm workspace 가 아니다**. 재클론 후엔 서브프로젝트마다 개별 설치가 필요하다.
  SST `lcnine-services` 가 호스트에서 빌드하는 건 `apps/admin-web`, `apps/wallet-web`,
  `web/almondyoung-storefront` 3개(+ auth 배포용 `web/auth-web`). 나머지는 Docker 빌드.
  안 하면 `Cannot find module 'next/package.json'` 으로 배포가 죽는다. (2026-08-07 설치 완료)

### 3-3. 기준선 (이 수치보다 늘면 내 변경 탓)

- `npx jest libs/authorization apps/notification apps/channel-adapter apps/core/src/platform`
  → **실패 3건이 정상**: `coupang-integration`, `pim-snapshot-builder`, `medusa.client`
  (전부 기존 debt). `channel-adapter.integration` 은 2026-08-08 삭제 — 없는 모듈
  (`../channel-adapter.repository`)을 import 해 **실행 자체가 불가능**했다. DB 문제가 아니었다.
- `npx eslint <변경파일>` → SST `services.ts` 의 ~399건은 기존 debt. 변경 파일 기준 **14건이 기준선**
- `node scripts/security/route-authz-audit.js` → **`[A] 무력화 0` 이 정상**. 0 이 아니면 스코프도
  역할도 검사하지 않는 라우트가 생긴 것 (스크립트가 exit 1 로 알린다)
- `npx jest scripts/security` → 위 두 불변식을 테스트로도 건다.
  **새 `@Public` 쓰기 라우트를 만들면 여기서 빨개진다** — 키/서명 검증을 붙이거나, 정당하면
  `ALLOWED` 에 이유를 적어 추가한다

### 3-4. 이번 감사에서 확인해서 **문제없던** 것 (재검 불필요)

- **SQL 인젝션** — `sql.raw` 가 레포 전체에 1건이고 사용자 입력 보간 없음. drizzle 템플릿은 파라미터 바인딩
- **경로 탈출** — file-service `/files/local/*key` 는 `resolveWithinUploadsDir` 봉쇄 +
  `STORAGE_PROVIDER=LOCAL` 에서만 활성
- **wallet 전체** — 96개 라우트 전부 인가 있음(표시 없으면 API key). 이 레포에서 가장 잘 된 설계
- **notification 웹훅 3건** — Resend/Twilio/NHN 서명 검증이 실재 (`@Public` 이 맞다)
- **channel-adapter `internal/*`** — 각 핸들러가 `verifyInternalKey()` 직접 호출

### 3-5. 아직 손도 안 댄 계열

mass assignment(DTO whitelist), SSRF, `@Public` 75건의 데이터 노출 개별 검토.

---

## 4. 착수 순서 제안

1. ~~P0 2건~~ 🟩 완료 (§1-2). **배포는 아직** — 아래 순서를 지켜야 한다.
2. **P1 IDOR** — file-service(5) → membership(26) → ugc(12) → user-service(20) → core 나머지.
   앱 단위로 PR 을 끊는 게 리뷰하기 좋다.
3. P2 는 설계 논의가 필요하니 이슈로 먼저 올린다.
4. P3 는 기능 요구 확인 후.

### P0 배포 순서 (어기면 고객 구매확정이 깨진다)

1. `sst secret set UgcInternalKey <값> --stage live` — 안 하면 배포 2 자체가 실패한다
2. **PR 1**(호출자가 키를 보냄) 머지 → `sst deploy --stage live`
3. Medusa 태스크가 새 이미지로 교체됐는지 확인
4. **PR 2**(가드 부착) 머지 → `sst deploy --stage live`

마이그레이션 0건. 되돌릴 때는 **PR2 → PR1 역순**으로만 (PR1 만 되돌리면 401 이 된다).
