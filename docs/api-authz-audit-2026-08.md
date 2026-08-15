# API 인가(authorization) 감사 현황판 (2026-08)

> 출처: 2026-08-07 `apps/` 전 NestJS 백엔드 HTTP 라우트 인가 전수 감사.
> 이 문서가 **상황판(허브)** 이다. 항목 착수/완료 시 상태를 갱신한다.
> 상태: ⬜ 미착수 / 🟨 진행 / 🟩 완료 / ⏸ 보류(사유 명기)
>
> 도구: `node scripts/security/route-authz-audit.js` — 이 문서의 모든 수치는 이 스크립트 출력이다.

## 0. 한 줄 요약

라우트 883개 중 **인가 가드 축(PR #572)과 무인증 내부 API(P0)는 정리 완료**. **IDOR 전수
95건 조사도 완료** — SAFE 75 / N/A 19 / VULN 1 / UNCLEAR 0 (notification `fcm-token` 은
2026-08-08 수정·커밋 완료로 VULN → SAFE 전환, §2 P1). 남은 것은 **(a) VULN 1건(membership
`confirm-checkout-intent`) 조치 대기 — 착수 전 런타임 로그 확인이 선행조건(§2 P3, §4)**,
(b) 인증/방어심층 설계 부채 다수 건(기존 JWT `iss` 1건 + 하드코딩 크레덴셜 1건 + IDOR 조사
중 나온 부산물 9군데 — 하드코딩 크레덴셜은 코드 제거 완료·Neon 프로젝트 삭제만 사람 작업으로
남음), (c) 조용히 죽은 경로 4건 + 동작/의도 확인 3건.

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

### P1 🟨 IDOR 전수 조사 — 95건 완료, VULN 1건 조치 대기 (1건은 해결)

95건 전부 라우트별로 컨트롤러 → 서비스 → 리포지토리를 따라가 `userId`/`customerId` 가
**쿼리 조건에 실제로 들어가는지** 확인했다. grep 이 아니라 엔드포인트별 수기 판독이다
(3-2 절 참고 — grep 으로는 애초에 못 센다).

| 앱 | SAFE | N/A | VULN | UNCLEAR | 합계 | 그중 쓰기 |
|---|---|---|---|---|---|---|
| core | 22 | 0 | 0 | 0 | 22 | 8 |
| user-service | 18 | 2 | 0 | 0 | 20 | 10 |
| membership | 18 | 7 | 1 | 0 | 26 | 7 |
| ugc-service | 11 | 1 | 0 | 0 | 12 | 7 |
| file-service | 3 | 2 | 0 | 0 | 5 | 3 |
| notification | 2 | 0 | 0 | 0 | 2 | 2 |
| search | 0 | 4 | 0 | 0 | 4 | 0 |
| analytics | 1 | 3 | 0 | 0 | 4 | 0 |
| **합계** | **75** | **19** | **1** | **0** | **95** | **37** |

전체 라우트 883건 중 95건이 IDOR 검사 대상(나머지는 `@Public` 이거나 애초에 인가 대상이 아님),
그중 쓰기 37건. 판정 근거 원본은 `scripts/security/idor-reviewed.spec.ts` 의
`IDOR_REVIEWED` 맵 — 라우트마다 `verdict`/`evidence`(file:line)/`predicate`(실제 코드
술어 원문)를 담고 있다.

**검증 방법**: SAFE 판정 74건 전부 방어 술어를 **원문 그대로 인용**해야 했고, 오케스트레이터가
그 인용문을 인용된 `file:line` 과 기계적으로 대조했다(74건 중 불일치 0건). 쓰기 라우트
SAFE 28건은 추가로 **적대적 반박(adversarial refutation) 패스**를 거쳤다 — "이 방어를 깨는
입력이 있는가"를 별도로 캐물은 것. 뒤집힌 판정 0건.
(위 표의 SAFE 75건과 숫자가 다른 이유: 이 기계적 대조는 `POST /devices/fcm-token` 이
VULN→SAFE 로 뒤집히기 **전**에 74건을 대상으로 돌았다. 그 라우트는 별도 회귀
테스트로 검증됐다 — 아래 "VULN 1건 해결" 항목 참고.)

**VULN 1건 해결 🟩 — notification `POST /devices/fcm-token`**
(`apps/notification/src/device/services/device.service.ts:54-66`, 2026-08-08,
`b09083e55` → `47088602e`):

원래 문제: `dto.deviceId` 를 안 보내면 `onConflictDoUpdate({ target: fcmTokens.token })` 가
**전역 유니크 인덱스**(`idx_fcm_token`, notification schema 223행)를 타겟으로 잡고 `set` 에
소유자 조건이 없어, A 가 B 소유의 토큰 문자열을 알아내(또는 유출된 토큰을 재사용해)
`deviceId` 없이 POST 하면 B 의 행이 갱신됐다.

- **고침**: `onConflictDoUpdate` 에 `setWhere: eq(fcmTokens.userId, userId)` 추가
  (`device.service.ts:57`) — 충돌 대상 행이 호출자 소유가 아니면 Postgres 가 `DO UPDATE`
  자체를 건너뛴다(no-op). `updateSet` 에는 여전히 `userId` 가 없어 self-match 여도 소유권이
  넘어가진 않는다.
- **관측 가능하게 만듦**: `.returning({ userId: fcmTokens.userId })` 로 실제 쓰기 행 수를
  확인해, 0행이면 `logger.warn('FCM token registration skipped: token already owned by
  another user', { userId })` 을 남기고(토큰 문자열은 자격증명이라 로그하지 않음) 성공 로그는
  안 남긴다. 이전엔 스킵 여부와 무관하게 무조건 성공 로그가 찍혔다.
- **외부 응답은 그대로 (단, `deviceId` 없는 분기에 한해)**: `dto.deviceId` 를 안 보내는
  분기는 스킵돼도 클라이언트에 여전히 201/무본문이라 "토큰 존재 여부 오라클"이 되지 않게
  의도적으로 유지된다. `deviceId` 를 보내는 분기(42-46행, `target:
  [fcmTokens.userId, fcmTokens.deviceId]`)는 이 보장 밖이다 — 그 target 은 (userId,
  deviceId) 복합 유니크만 잡고, 전역 유니크 인덱스(`idx_fcm_token`)에서 다른 사용자
  소유 토큰과 충돌하면 어떤 `ON CONFLICT` 절도 안 걸려 처리되지 않은 유니크 위반이 그대로
  터져 500 이 난다 — "토큰이 남의 것" 과 "그냥 성공(201)" 을 구분하는 오라클이 된다. 이번에
  건드린 게 아니라 원래 있던 문제이고, 실사용에서 뚫기는 어렵다(FCM 토큰은 ~163자 엔트로피고,
  이 라우트는 현재 프로덕션에서 인증 자체가 401 이라 도달 불가) — 그래도 청구를 이 분기까지
  넓혀 말하면 안 된다.
- **회귀**: `apps/notification/src/device/services/__tests__/device.service.idor.spec.ts`.
  `scripts/security/idor-reviewed.spec.ts` 에서 이 라우트가 SAFE 로 뒤집혔고
  `EXPECTED_OPEN` 에서 빠졌다(위 표에 반영).
- **알려진 한계 — 결함이 아니라 다음 사람이 알아야 할 트레이드오프**: 이 구멍을 막았다는 건
  정당한 교차사용자 토큰 재할당(기기 공유 핸드오프, 또는 FCM 이 재설치 후 같은 토큰 문자열을
  재사용하는 경우)도 이제 **조용한 no-op** 이 된다는 뜻이다 — 이전처럼 탈취가 일어나진
  않지만, 성공하지도 않는다. 오늘 코드에는 소유권 이전 프로토콜이 없다 — 그 흐름이 실제로
  필요해지면(예: "이 토큰을 내 계정으로 옮긴다"는 명시적 액션) 별도로 설계해야 한다. 지금
  이대로 방치해도 안전하지만, 필요해질 때 이 문서를 안 보고 손대면 다시 구멍이 날 수 있다.

**VULN 1건 — 조치 대기**:

| 라우트 | 위치 | 문제 | 재현 | 영향 |
|---|---|---|---|---|
| `POST /subscriptions/confirm-checkout-intent` (membership) | `apps/membership/src/services/subscription.service.ts:220` | 핸들러(`subscription.controller.ts:163-167`)가 호출자 신원을 전혀 받지 않는다. 바디의 `intentId` 만으로 payment intent 를 조회해 그 메타데이터의 `userId` 로 구독을 만든다 — 소유권 검사 없음 | 로그인한 A 가 B 의 `intentId` 를 알아내 호출하면 B 명의로 구독이 확정된다 | intent 가 AUTHORIZED/CAPTURED 상태여야 하므로 **B 는 이미 결제를 마친 건**이고 A 가 얻는 이득은 없다 — 그래서 영향은 제한적이지만 검사가 없다는 사실 자체는 남는다. 이 라우트는 **별도 문제(JWT 주석-구현 불일치)** 도 갖고 있음 — §2 P3 참고 |

membership 은 코드 수정이 필요하다(이 문서는 상황판이라 수정하지 않음). **다만 지금 착수하면
안 된다** — 올바른 수정 내용이 아직 없는 런타임 증거에 달려 있다. 확인 절차는 §2 P3, 착수
순서는 §4.

**UNCLEAR 0건** — 판정을 못 내려 유보한 라우트는 없다. 95건 전부 SAFE/N/A/VULN 중 하나로
확정됐다.

**"우선 볼 곳" 목록 삭제 — 이유**: 이전 버전 이 자리에는 "영향 큰 순" 으로 file-service와
ugc-service 를 최우선으로 지목한 목록이 있었다. 실제로 훑어보니 **둘 다 위양성** —
file-service 5건 전부 SAFE(3)/N/A(2), ugc-service 12건 전부 SAFE(11)/N/A(1)였다. 원인은
감사 스크립트(`route-authz-audit.js`)가 **라우트 데코레이터**를 보고 "IDOR 검사 대상"을
뽑아내는데, 실제 IDOR 방어는 **서비스 계층의 `where` 절**에 산다는 점 — 데코레이터에 안전
표시가 없다고 방어가 없는 게 아니다. 이 목록을 안 지우고 남겨두면 다음 사람이 안전한 곳부터
다시 파게 된다. "영향이 클 것 같다"는 감(느낌)은 판정 근거가 아니라는 게 이번 조사의 재사용
가능한 교훈이다 — 어떤 앱이 위험한지는 **판정표(위)를 보고 판단**한다.

**회귀 가드와 그 한계**: `scripts/security/idor-reviewed.spec.ts` 가 95건의 판정을 스냅샷으로
고정한다. `route-authz-audit.js` 가 뽑아내는 IDOR 검사 대상 키 집합과 `IDOR_REVIEWED` 맵의
키 집합을 대조해, **새 IDOR 대상 라우트가 생기거나 기존 라우트가 사라지면 실패**한다.
⚠️ **이 장치가 못 잡는 것**: 기존에 있던 소유권 술어(`eq(reviews.userId, userId)` 같은 것)를
누가 지워도 이 테스트는 그대로 초록이다 — IDOR 은 라우트 존재 여부가 아니라 **의미론**이라
AST 로 판정할 수 없다. **초록불을 "IDOR 없음"으로 읽지 말 것.** 실제 방어가 살아있는지는
여전히 코드 리뷰가 잡아야 한다.

### P2 🟨 인증/방어심층 설계 부채 — 기존 2건 + IDOR 조사(P1) 부산물 9건

- **`libs/authorization/src/strategies/jwt-access.strategy.ts:110`** — `if (payload?.iss)` 조건
  때문에 `iss` 클레임 없는 HS256 토큰은 **issuer/audience 검증을 통째로 건너뛴다**. 레거시 Medusa
  토큰 호환이 의도. IdP·Medusa·core·wallet·file-service 가 `AUTH_SECRET` 하나를 공유하므로 한
  서비스에서 시크릿이 새면 전 서비스 위조가 된다.
  - **`apps/file-service/src/access/file-access.ts:75-76`** — 같은 신뢰구조의 다른 사례.
    `scopes: ['master']` 만 든 서비스 위임 토큰은 `isMasterOrOwner()` 의 파일 소유권 검사를
    전량 통과한다. IDOR 은 아니다(정상 우회 경로다) — 다만 `master` 역할/스코프를 실을 수 있는
    토큰이 새면 전 사용자 파일이 열린다. 같은 서비스의
    `FileRepository`(`apps/file-service/src/shared/repositories/file.repository.ts:26-59`)는
    모든 메서드의 WHERE 가 `eq(uploads.id, id)` 뿐이라, IDOR 방어가 **`isMasterOrOwner` 딱 한
    지점**에 몰려 있다 — 그 함수를 안 거치고 리포지토리를 직접 호출하는 경로가 생기면 방어가
    통째로 사라진다.
  - **`apps/core/src/modules/sales-order/controllers/store-sales-orders.controller.ts:52-66`** —
    `cancelRequest`/`cancelRequestByChannelOrder` 가 `@User()` 의 `customer.roles` 를 그대로
    `fulfillmentCommandContext.actorRoles` 로 넘긴다. IDOR 축은 아니지만 JWT claim 을 검증 없이
    믿고 하위 커맨드 권한판단에 쓰는 것은 위 두 항목과 같은 계열.
- 🟨 **하드코딩 DB 크레덴셜 — 코드 제거 완료, 그러나 처음 집계는 과소 계산이었다
  (1차 2026-08-08, 스코프 확장 재검증 2026-08-08)**. 이 항목은 원래
  `apps/channel-adapter/src/adapter.module.ts` 1건으로 적혀 있었으나, 전수로 훑으니
  **3개 Neon 프로젝트 × 5곳**이었다(당시 `scripts/security/no-cloud-credentials.spec.ts` 의
  `git grep` 스코프가 `*.ts` 뿐이었다). 4곳은 죽은 코드였고(도달 불가 fallback 1, 없는 모듈을
  import 해 실행 불가능한 테스트 2, import 하는 곳이 없는 파일 1), `apps/membership/drizzle/seed.ts`
  만 **살아있는 진입점**이라 `DATABASE_URL` 없이 `npm run db:seed` 를 돌리면 클라우드 DB 에
  시드를 썼다.
  - ⚠️ **`*.ts`-only 스코프가 구멍이었다.** 그 3개짜리 집계가 초록불이던 바로 그 순간,
    `envs/*.example` 10개 파일과 `apps/user-service/README.md`, 그리고 참조되지 않는
    죽은 스크립트 3개(`apps/notification/fix-consents-service.js`,
    `apps/user-service/add-marketing-consent-column.js`,
    `apps/user-service/check-user-schema.js`)에 **서로 다른 11개** Neon 프로젝트의 실제
    접속문자열이 그대로 커밋돼 있었다 — `.ts` 만 보는 스코프는 구조적으로 이걸 볼 수 없었다.
    재검증에서 테스트 pathspec 을 `*.ts *.js *.json *.yml *.yaml *.md *.example *.env*` 로
    넓히고, `envs/*.example` 10곳과 README 는 자리표시자로 교체, 죽은 스크립트 3개는
    삭제했다. 정당한 비-크레덴셜 매치(문서의
    자리표시자 문법, `guard.spec.ts` 의 반대 방향 픽스처, `postgres:postgres` 로컬
    docker-compose 기본값 등)는 `ALLOWED` 맵에 이유와 함께 등록했다.
  - **바로잡은 총계: 3개가 아니라 14개의 서로 다른 Neon 프로젝트**(호스트 접두어 기준,
    2026-08-08 재검증). 회귀는 이제 넓어진 `scripts/security/no-cloud-credentials.spec.ts` 가
    막는다.
  - **후속(2026-08-08): `envs/` 디렉터리 전체를 삭제했다.** 자리표시자로 남겨뒀던 12개
    `.example` 파일이 실은 **아무것도 참조하지 않는 고아**였다 — SST 는 그 변수명을 쓰지
    않고, 코드·스크립트 어디서도 `envs/.env.*` 를 읽지 않는다. 아래 출처 표기의
    `envs/...` 경로는 **발견 당시의 좌표**이고 지금 그 파일은 없다.
  - **DB 접속문자열 말고 다른 시크릿도 같은 파일들에 있었다** — `AUTH_SECRET`(6개 서비스
    공유), Kafka(Confluent) 키, AWS/S3 시크릿, `KAKAO_CLIENT_SECRET`,
    `ELASTICSEARCH_PASSWORD`, `MEDUSA_API_KEY`, medusa `JWT_SECRET`/`COOKIE_SECRET` 등.
    운영자 확인 결과 대조한 8건이 전부 현재 값과 불일치(길이·접두사 기준)라 **한 시점의 낡은
    스냅샷**으로 판정했다. AWS 키는 과거 노출 사고 때 이미 회전됐고, Confluent 는 현재
    미사용(Redpanda 로 이전)이다. 미확인 잔여: `ELASTICSEARCH_PASSWORD`,
    user-service `JWT_REFRESH_SECRET`/`JWT_VERIFICATION_TOKEN_SECRET`.
    `KAKAO_CLIENT_SECRET` 은 라이브 env 에 없으나 **카카오 콘솔에서 무효화된 것은 아니므로**
    재발급해두면 이 갈래가 닫힌다.
  - **히스토리 재작성은 하지 않기로 했다.** 2026-08-07 에 이 레포에서 이미 시도했고,
    `refs/pull` 364개와 포크 3개가 원본 blob 을 붙들어 **노출이 끊기지 않았다**(실측). 비용은
    전원 재클론 + 커밋 해시 244곳 치환이었다. 죽은 값을 위해 그 비용을 다시 치를 이유가 없다 —
    살아있는 값이 나오면 재작성이 아니라 **로테이션**으로 닫는다.
  - ⚠️ **크레덴셜 자체는 여전히 유효하다.** 코드에서 지워도 공개 이력에서 회수되지 않는다
    (`docs/git-history-rewrite-2026-08-07.md`). 남은 건 **사람 작업**이다 — 아래 14개
    프로젝트를 전부 삭제하거나 회전(rotate)해야 이 항목이 닫힌다. 이 문서가 상황판이지
    수정 문서가 아니듯, 이 리스트도 코드가 아니라 사람이 처리할 큐다:
  - [ ] Neon 프로젝트 `ep-divine-hill-a1nspuc3` 삭제 (membership, `.ts` 스코프에서 발견)
  - [ ] Neon 프로젝트 `ep-young-pine-a149ey1z` 삭제 (wallet, `.ts` 스코프에서 발견)
  - [ ] Neon 프로젝트 `ep-young-thunder-a1bkhlx2` 삭제 (channel-adapter, `.ts` 스코프에서 발견)
  - [ ] Neon 프로젝트 `ep-wandering-union-a1ead79i` 삭제 (analytics, `envs/.env.analytics.example`)
  - [ ] Neon 프로젝트 `ep-silent-sea-a191s6x9` 삭제 (channel-adapter, `envs/.env.channel-adapter.example` — young-thunder 와는 별개 프로젝트)
  - [ ] Neon 프로젝트 `ep-still-shape-a14xh93f` 삭제 (file-service, `envs/.env.file-service.example`)
  - [ ] Neon 프로젝트 `ep-muddy-bird-a1ao43dw` 삭제 (medusa, `envs/.env.medusa.example`)
  - [ ] Neon 프로젝트 `ep-lively-fire-a1qf7wvd` 삭제 (membership, `envs/.env.membership.example` — divine-hill 과는 별개 프로젝트)
  - [ ] Neon 프로젝트 `ep-wild-poetry-a1x5p1po` 삭제 (pim, `envs/.env.pim.example`)
  - [ ] Neon 프로젝트 `ep-patient-frost-a11kkz8r` 삭제 (ugc-service, `envs/.env.ugc-service.example`)
  - [ ] Neon 프로젝트 `ep-little-grass-a1s81mkd` 삭제 (user-service, `envs/.env.user-service.example`)
  - [ ] Neon 프로젝트 `ep-tiny-art-a1bwtgfe` 삭제 (wallet, `envs/.env.wallet.example` — young-pine 과는 별개 프로젝트)
  - [ ] Neon 프로젝트 `ep-billowing-band-a1cgr277` 삭제 (wms, `envs/.env.wms.example`)
  - [ ] Neon 프로젝트 `ep-jolly-river-a8oplnnc` 삭제 (user-service, `apps/user-service/README.md` +
        삭제된 죽은 스크립트 3개가 같은 접속문자열을 썼다 — little-grass 와는 별개 프로젝트)

**IDOR 조사(P1) 중 나온 나머지 부산물 — VULN 은 아니고 지금은 안전하지만, 설계로 남기면
다음 리팩터링에서 조용히 구멍이 되는 것들**:

- **"사전 SELECT 가드 + id-only UPDATE" 패턴** — 소유권 확인은 UPDATE **앞의** SELECT 에서만
  하고, 실제 `UPDATE ... WHERE` 는 `id` 단독 키다. 오늘은 같은 트랜잭션 안에서 순서가 지켜져
  안전하지만, 이 UPDATE 만 재사용되거나 가드-UPDATE 순서가 바뀌면 **그 즉시** IDOR 이 된다.
  5곳 전부 같은 모양:
  - `apps/core/src/modules/library/services/ownership.service.ts:119` (`exercise()`)
  - `apps/core/src/modules/sales-order/services/store-sales-orders.service.ts:470,488`
    (`findSoOrThrow` — `customerId` 가 optional 파라미터라 호출부가 실수로 빠뜨리면 검증이
    조용히 스킵된다)
  - `apps/user-service/src/api/business-licenses/business-licenses.service.ts:156-159`
  - `apps/user-service/src/api/cafe24-link/cafe24-link.service.ts:298-308`
  - `apps/ugc-service/src/qna/qna.service.ts:183` (`updateQuestion`)
- **ugc 비밀글 마스킹이 불완전하다** — `apps/ugc-service/src/qna/mappers/qna.mapper.ts:25` 는
  `isHidden` 일 때 title/content/nickname/mediaFileIds 는 가리지만 **`answer` 필드는 그대로
  노출**한다 — 비밀 질문에 달린 관리자 답변이 목록 조회에서 그대로 유출된다. 같은 파일 14행은
  `userId` 도 안 가려 비밀글이어도 작성자를 특정할 수 있다. IDOR(식별자로 남의 데이터를
  특정)은 아니지만 마스킹 로직 자체의 결함이라 코드 수정이 필요하다.
- **ugc 첨부파일 소유권 미검증** — `apps/ugc-service/src/qna/qna.service.ts:34-49`,
  `apps/ugc-service/src/reviews/services/reviews.service.ts:133-148` 는 게시물 작성 시
  `mediaFileIds` 의 개수·중복만 검사하고 그 파일이 호출자 소유인지, 심지어 존재하는지도 확인
  안 한다 — 타인이 올린 파일 ID 를 추측/열거해 자기 게시물에 참조로 붙일 여지가 있다.
- **search·analytics 는 인가 스캐폴딩 자체가 없다** — `search`(`apps/search/src/main.ts`,
  `search.module.ts`)는 `AuthorizationModule` 을 아예 import 하지 않는다. `analytics`
  (`analytics.module.ts:45-48`)는 `AuthorizationModule.forRoot()` 로 provider 만 등록하고
  전역 가드(`APP_GUARD`)를 안 건다 — 실제로 analytics 4개 라우트 중 `@UseGuards` 를 직접 붙인
  1개(`/frequently-purchased`)만 인증되고 나머지 3개는 기본값이 "공개"다. 지금은 두 앱의
  노출 데이터가 전부 공개 카탈로그/집계라 N/A 판정이지만, **allow-list 구조라 다음 라우트를
  추가할 때 인가를 깜빡하면 그대로 공개된다**(core/notification/channel-adapter 의
  `AdminRealmGuard` default-deny 와 반대 방향).
- **`GET /search/products` 의 `includeMembersOnly` 가 클라이언트 입력을 그대로 신뢰한다** —
  `apps/search/src/dto/product-search-query.dto.ts:64-69`,
  `apps/search/src/product-index.service.ts:466-474`. 실제 멤버십 여부를 서버가 검증하지
  않아 `?includeMembersOnly=true` 만 붙이면 비회원도 멤버십 전용 노출 상품을 볼 수 있다.
  IDOR 은 아니지만(식별자로 남의 데이터를 특정하는 게 아니라 boolean 플래그 하나) 인가 로직
  자체가 빠진 사례.
- **`apps/user-service/src/api/cafe24-link/cafe24-link.controller.ts:170-203`** —
  `GET /cafe24/internal/link-info`, `GET /cafe24/internal/links` 가 `@Public()` 으로 열려
  있고 `mallId`/`cafe24MemberId` 쿼리만으로 그 사용자의 `userId`+`email` 을 반환한다.
  channel-adapter 전용 내부 API 로 문서화돼 있고 네트워크 경계(내부망)를 신뢰하는 설계인데,
  §1-2 에서 정리한 "무인증 내부 API" 들과 모양이 같다 — 이번엔 GET/조회라 감사 스크립트의
  "무인증 **쓰기**" 필터에 안 걸려 P0 조사에서 빠졌고 이번 IDOR 조사에서 우연히 걸렸다.
  **공개 ALB 로 실제 도달 가능한지 확인이 먼저** — 도달한다면 P0 와 같은 등급의 문제다.
- **`apps/membership/src/controllers/subscription.controller.ts:373`** —
  `getCancellationReasons` 가 `@User('userId') userId` 를 받아놓고 서비스 호출에 전달하지
  않는다(죽은 파라미터). 지금 반환값이 사용자 무관 카탈로그라 위험은 없지만, "이미 userId 를
  받고 있으니 안전하다"는 착각을 유발하는 코드 냄새 — 나중에 개인화 로직이 붙을 때 조심해야
  한다.

### P3 ⬜ 조용히 죽어 있는 경로 4건 + 확인 필요 3건

죽은 경로 4건은 전부 **PR #572 이전부터** 실패하던 것. 고치는 건 동작 변경이라 기능 요구
확인이 먼저다. 확인 필요 3건은 정적 분석만으로는 결론을 못 내려 사람 확인이 필요한 것들이다.

- 스토어프론트 `GET /categories`(+`/:id`,`/children`,`/path`) — `withAuth:false` 인데 core 는
  `@Public` 이 아님 → **항상 401**. 같은 이유로 `/variants/*`, `/masters/:id/versions*`,
  `/masters/:id/pricing/*` 도 401 (총 13건).
  - ⚠️ **함정**: 이걸 고치려고 스토어프론트에서 `withAuth:true` 로 바꾸면 이번엔
    `AdminRealmGuard` 403 이 된다(고객 토큰은 admin 아님). **올바른 해법은 core 에 `@Public()`**.
  - 단 `/masters/:masterId/versions*` 는 **미게시 버전 노출** 가능성이 있어 카탈로그 읽기와 한
    묶음으로 공개하면 안 된다 — 도메인 판단 필요.
- 스토어프론트 `GET /products` — core 에 해당 컨트롤러가 없음 → **404** (죽은 호출)
- notification `/devices/fcm-token` — `JWT_ACCESS_SECRET` 이 배포 env 에 없음 → **항상 401**
  (`getOrThrow` 가 try 안이라 catch 가 401 로 삼킨다). 같은 라우트가 §2 P1 의 VULN 이었으나
  소유권 검사는 이미 수정·커밋됐다(`b09083e55`, `47088602e` — §2 P1 참고). 이 401(시크릿
  누락) 자체는 별개 문제로 남아 있다 — 시크릿을 채워도 더 이상 §2 P1 문제는 재발하지 않는다.
- channel-adapter → core `POST /channel-listings` — 인증 헤더를 안 보냄 → **항상 401**
- **의도 확인 1** — `search` 4개 읽기 라우트에 인증이 전혀 없다(상품검색·연관검색어·추천).
  공개 카탈로그 검색이라 의도일 가능성이 높지만 확인 필요.
- **의도 확인 2** — `analytics GET /best-product` 는 무인증으로 최근 90일 전체 주문의
  상품별 주문수·판매수량(매출 관련 집계)을 반환한다(`analytics.controller.ts:48-71`,
  `product-ranking.query.ts:21-58`). 사용자별 데이터가 아니라 IDOR 은 아니지만 매출 지표
  자체가 민감해 의도된 공개인지 재확인 필요. 같은 컨트롤러의 `GET /summary` 는 현재
  `NotImplementedException` 스텁(`analytics.service.ts:18-20`)이라 실질 노출은 없음(항상
  501) — 구현이 채워질 때 인증 여부를 다시 봐야 한다.
- **동작 확인 — membership `POST /subscriptions/confirm-checkout-intent`, §2 P1 의 남은
  VULN 1건이 이 확인 결과에 달려 있다.** 주석과 실제 가드가 반대다.
  `subscription.controller.ts:137-139` 의 doc comment 는 "JWT 불필요 - wallet API key 로
  검증" 이라 하지만, membership 은 전역 `JwtAuthGuard`(`app.module.ts:131-133`)를 걸어놓았고
  이 라우트엔 `@Public()` 이 없다 — **실제로는 JWT 가 필요하다**. 이 엔드포인트는 크로스도메인
  결제 리다이렉트로 `accessToken` 쿠키가 사라지는 상황을 우회하려고 만들어졌다(주석에 그렇게
  적혀 있다). 스토어프론트는 Next 프록시가 raw `Cookie` 헤더를 그대로 전달하지만
  (`web/almondyoung-storefront/src/app/api/membership/[...path]/route.ts:26-30`), **그 시점에
  쿠키가 실제로 살아있는지는 정적 분석으로 확정할 수 없다** — 이 문서는 살아있다고도 죽었다고도
  단정하지 않는다.
  - **확인 절차**: membership 서비스 라이브 로그(CloudWatch)에서 `POST
    /subscriptions/confirm-checkout-intent` 의 응답코드 분포를 본다.
    - **200 이 대다수**면 쿠키가 리다이렉트를 살아서 넘어온다는 뜻 — 이 라우트는 실제로 인증된
      상태로 호출되고 있는 것이다. 이 경우 고칠 내용은 좁다: 호출자 토큰의 `userId` 와
      `intent.metadata.userId` 를 대조해 불일치를 거부하면 §2 P1 의 IDOR 이 닫힌다. 그 외엔
      바꿀 게 없다.
    - **401 이 대다수**면 IDOR 보다 훨씬 심각하다 — 결제를 완료한 고객이 구독을 못 받고 있다는
      뜻이다(§1-2 의 P0 들과 같은 등급의 임팩트). "JWT 필요" 와 "크로스도메인 리다이렉트로
      쿠키가 사라지는 상황을 우회하려고 만든 라우트" 라는 자기모순이 실제로 터지고 있는 것 —
      패치가 아니라 설계 결정(예: `@Public()` + API key 검증으로 doc comment 를 실제로
      구현하기)이 필요하다.
    - **추측으로 고치면 안 된다** — 잘못된 분기를 고르면 둘 중 한쪽 문제를 더 악화시킨다. IDOR
      패치부터 넣으면 401 이 원인인 구독 유실을 못 보고 지나치고, 로그를 안 보고 `@Public()`
      부터 열면 소유권 검사 없는 채로 인가 자체를 없애 IDOR 이 더 커진다. 위 로그 확인이 선행
      조건이다 — 이 문서는 어느 쪽인지 단정하지 않는다.
  - (같은 라우트의 소유권 검사 부재는 §2 P1 VULN 에 있다 — 이 절차의 결과가 그 조치 내용을
    정한다.)

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
2. ~~P1 IDOR 전수 조사(95건)~~ 🟨 조사 완료 (§2 P1). notification `fcm-token` 은 🟩 수정·커밋
   완료(§2 P1, `b09083e55`/`47088602e`). 남은 건 **VULN 1건** — membership
   `confirm-checkout-intent`. **먼저** §2 P3 의 확인 절차대로 CloudWatch 응답코드 분포부터
   본다 — 200/401 중 무엇이 대다수냐에 따라 고칠 내용이 완전히 다르다(좁은 IDOR 패치 vs 설계
   결정). 로그를 보기 전에는 착수하지 않는다.
3. P2(설계 부채, 총 11건)는 설계 논의가 필요하니 이슈로 먼저 올린다. 그중
   `cafe24/internal/*` 무인증 GET(§2 P2)은 공개 ALB 도달 여부부터 확인 — 도달하면 P0 급이라
   먼저 처리한다.
4. P3(죽은 경로 4건 + 확인 필요 3건)는 기능 요구/런타임 확인 후. membership
   `confirm-checkout-intent` 의 확인 절차는 2번에서 이미 선행 조건으로 명시했다 — 그 로그
   결과가 나와야 PR 을 연다(추측 금지). 어차피 같은 라우트라 결과가 곧 §2 P1 VULN 의 수정
   내용이 된다.

### P0 배포 순서 (어기면 고객 구매확정이 깨진다)

1. `sst secret set UgcInternalKey <값> --stage live` — 안 하면 배포 2 자체가 실패한다
2. **PR 1**(호출자가 키를 보냄) 머지 → `sst deploy --stage live`
3. Medusa 태스크가 새 이미지로 교체됐는지 확인
4. **PR 2**(가드 부착) 머지 → `sst deploy --stage live`

마이그레이션 0건. 되돌릴 때는 **PR2 → PR1 역순**으로만 (PR1 만 되돌리면 401 이 된다).
