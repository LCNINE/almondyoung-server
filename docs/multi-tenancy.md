# 멀티테넌트 — 구현자 가이드

이 시스템은 여러 회사(테넌트)가 **같은 인스턴스**(core 프로세스·RDS·Kafka·ALB)를 함께 쓴다. 테넌트 1 은 원래 서비스(아몬드영)이고, 1 이 아닌 테넌트는
자기 창고·상품·직원으로 일한다. 이 문서는 테넌트에 닿는 코드를 고치기 전에 읽는 정본이다 — 결정의 이유는 ADR 에, 여기엔 «어디서 정해지고 어디로 흐르는가»와
«실수하기 쉬운 곳»을 모은다.

| 결정 | ADR |
|---|---|
| core 는 테넌트마다 논리 DB | [[0051-core-tenant-per-database]] |
| 계정은 전역, 테넌트는 소속과 부여 (🔸 일부 대체됨 → 0056) | [[0052-account-is-global-tenant-is-membership-and-grant]] |
| 계정은 한 테넌트의 것 (**expand 만** — 계정 칸·채우기·새 계정 쓰기. 읽기는 아직 전역) | [[0056-account-belongs-to-one-tenant]] |
| 이벤트 테넌트는 라이브러리가 찍고 문에서 거른다 | [[0053-event-tenant-stamped-by-library-gated-before-handler]] |
| 공유 서비스는 한 테넌트만 섬긴다 | [[0054-shared-services-serve-one-tenant]] |
| 테넌트 직원 화면 = 테넌트 도메인의 테넌트 셸 | [[0055-tenant-shell-on-tenant-domain]] |

🔸 **계정 모델이 바뀐다(0056, 미구현).** 아래 «계정·소속·플랫폼 운영자», 3절의 user-service 줄, 함정 6·28·29·31 은 **지금 코드**를 적은 것이다 —
0056 이 구현되면 계정은 한 테넌트의 것이 되고 소속은 없어진다. 그 PR 이 이 항목들을 다시 쓴다. 계정 전역을 새로 더 굳히는 코드는 그 전에 0056 과 맞는지 먼저 본다.
지금은 expand 까지다: `users.tenant_id`(nullable, 마이그 SQL 에만 DB 기본값 `'1'`)가 채워졌고 새 계정(고객·소셜 가입 = 앱 설정 T,
직원 대행 = 요청자 테넌트, 첫 `master` = 대상 테넌트)과 인증번호 기록이 테넌트를 쓴다. 로그인은 화면 테넌트가 오면 그 안에서,
가입·소셜 로그인의 중복 확인(이메일·아이디·닉네임·소셜 신원)과 아이디·비밀번호 찾기·재설정은 앱 설정 T 안에서 찾고,
전화번호·발송 대상으로 계정을 찾는 user-service 내부 라우트는 호출의 `x-tenant-id` 안에서 찾는다(헤더 없으면 403). unique 는 아직 전역이라
다른 테넌트 계정이 가진 이메일·아이디로 가입하면 사전 체크는 «사용 가능»이고 가입은 오늘과 같은 409 로 실패한다(contract 전까지).
채우기 마이그(`…_backfill-account-tenant.sql`) 전에 라이브에서 `npm run tenancy:account-tenant-preview -- --stage live` 를 돌린다 —
테넌트 1 에 남으며 다른 테넌트 부여를 잃는 계정이 있으면 끝 코드 1 이고 명단을 보여 준다. 채우기는 테넌트 1 «소속»을 이음으로 치지 않는다:
테넌트 1 백필 마이그를 시드가 다시 돌리면 다른 테넌트 직원 부여를 보고도 테넌트 1 소속을 만들기 때문이다(그 가짜 소속은 채우기가 거둔다).

🔒 **공개 레포다.** 테넌트 값(누구인지·slug·도메인·버킷·인증서 ARN·존 ID·로고)을 코드·문서·이슈·PR·커밋 메시지에 적지 않는다. 값은 Secret·user-service 테넌트 행·
레포 밖 계획 파일에만 있다. 예시는 `acme`·`tenant-2.example` 같은 가짜 값으로 쓴다.

## 1. 용어

| 용어 | 뜻 |
|---|---|
| **테넌트** | 이 시스템을 자기 업무에 쓰는 회사 하나. 바뀌지 않는 `id`·`slug`(우리가 짓고 회사 이름을 쓰지 않는다)와 상태 **준비 → 활성 ↔ 정지**를 갖는다. 테넌트 1 도 특별한 «본사»가 아니라 테넌트 중 하나다. |
| **테넌트 목록** | `{ id, slug, coreDb, publicBucket, privateBucket }[]` JSON Secret(`TENANT_LIST`). 값의 SoT 는 lcnine-auth 의 `TenantList`, services 앱은 SSM 으로 받는다. 이름·로고·도메인은 목록이 아니라 user-service 테넌트 행. |
| **계정** | 사람 한 명의 신원. 시스템 전체에 하나이고 어느 테넌트의 것도 아니다. 🔸 0056: 정확히 한 테넌트의 것으로 바뀐다. |
| **소속** | 계정이 어느 테넌트의 직원인가. 🔸 0056: 판정에 더는 쓰지 않는다 — 역할을 주고 늘리는 것은 계정의 테넌트에서만이다(부여의 테넌트 = 계정의 테넌트). 표는 옛 코드로 되돌릴 때를 위해 contract 까지 계속 쓰고, contract 가 걷는다. |
| **고객** | 어느 테넌트의 고객 역할을 가진 계정. 어느 테넌트의 고객인지는 들어온 앱이 정한다. 운영자가 만들어 주는 직원 계정은 고객 가입이 아니다. |
| **플랫폼 운영자** | 이 시스템을 운영하는 우리. 테넌트 역할이 아니라 계정의 성질. `master` 는 테넌트 안의 전권 역할일 뿐이다. 🔸 0056: 플랫폼 일만, 다른 테넌트 계정엔 첫 `master` 만들기·비번 비상 초기화만. |
| **토큰 테넌트** | 토큰의 `tenant` 클레임. 토큰의 역할은 이 테넌트에서 받은 부여만 실린다. |
| **앱 설정 T** | `SERVED_TENANT_ID` — 한 테넌트만 섬기는 앱이 섬기는 그 테넌트. |
| **문 모드** | `TENANT_GATE_MODE` = `warn`(없으면 경고 + 셈) / `reject`(없으면 거절). 라이브는 `reject`. SoT 는 lcnine-auth 의 `tenantGateMode` 한 줄. |
| **테넌트 도메인** | 1 이 아닌 테넌트 직원이 관리자 화면·로그인에 쓰는 주소. 주소가 테넌트를 정한다. |
| **테넌트 셸** | 테넌트 도메인에서 뜨는 admin-web 의 바깥 틀. 허용 목록 화면만 연다. |
| **칸** | 테넌트 도메인 하나를 위한 CloudFront 배포(admin-web 용·auth-web 용). 코드엔 번호만, 값은 칸 Secret. |

## 2. 테넌트가 정해지고 흐르는 길

```
사람 ─ 로그인 ─▶ user-service ─ 토큰(tenant: T, 계정의 테넌트와 같아야 한다) ─▶ admin-web / 쇼핑몰
                  (리디렉트 호스트 → 테넌트 도메인 → T)
admin-web / 다른 앱 ─ HTTP(토큰, 또는 내부 키 + x-tenant-id) ─▶ core
core 요청 문 ─ CLS(TENANT_CONTEXT_KEY = T) ─▶ DbService 라우터 ─▶ core_<slug> 풀
core 쓰기 ─ outbox 행(그 DB) ─▶ 디스패처가 봉투 metadata.tenantId = 그 DB 의 테넌트
소비 앱 ─ 핸들러 앞의 문(per-message: 맥락으로 / served-tenant: T 만) ─▶ 핸들러
크론·폴러·부팅 훅 ─ DbService.forEachDatabase ─▶ 테넌트마다 차례로, 그 테넌트 맥락에서
```

**정하는 곳은 몇 곳뿐이고, 나머지는 받아 쓰기만 한다.** 새 코드가 테넌트를 «고르는» 일은 거의 없어야 한다.

| 어디서 | 무엇이 정하나 | 코드 |
|---|---|---|
| 사람의 요청 | 토큰 `tenant`. 헤더와 다르면 거절 | `libs/tenancy/src/request-tenant.ts`, `apps/core/src/platform/tenancy/core-request-tenant.interceptor.ts` |
| 서비스끼리의 요청 | 내부 키 + `x-tenant-id` 헤더(공용 HTTP 클라이언트가 맥락에서 찍는다) | `libs/tenancy/src/tenant-header.ts` |
| 이벤트 | 봉투 `metadata.tenantId`(라이브러리가 찍는다) | `libs/events/src/tenancy/` |
| 요청 밖 작업 | `forEachDatabase` 가 테넌트마다 맥락을 연다 | `libs/db/src/db.service.ts` |
| 화면 | 들어온 주소(테넌트 도메인) | `apps/admin-web/src/lib/tenant-shell/` |

**맥락이 없으면 기본 테넌트로 떨어지지 않는다.** core 는 `TenantContextMissingError`, 소비 문은 DLQ, 공유 서비스는 403 이다. «없으면 테넌트 1» 을 시한부로도 들이지 않는 것이
이 설계 전체의 전제다 — 빠뜨린 곳이 조용히 테넌트 1 데이터를 읽는 대신 시끄럽게 터지게 하려는 것이다.

## 3. 앱별 모드

어느 앱이 어느 모드인지는 문서가 아니라 코드가 정본이다 — `libs/tenancy/src/guards/tenancy-wiring.spec.ts` 가 SST 설정·로컬 env·`main.ts` 를 대조한다.

| 앱 | HTTP | 이벤트 | 저장소 |
|---|---|---|---|
| core | 토큰/헤더 테넌트로 DB 라우팅 | `per-message` | 테넌트별 논리 DB |
| user-service | 계정 층(전역) + 테넌트 1 데이터는 토큰 테넌트 1 일 때만 | `per-message` | 전역 DB, 부여·소속·이력에 테넌트 (🔸 0056: 계정 행에 테넌트) |
| file-service · ai | 토큰 테넌트 | (ai: 계정 이벤트만) | 행에 테넌트 축, file-service 는 테넌트별 버킷 |
| wallet · membership · analytics · ugc-service · notification · search · channel-adapter | T 만 섬김, 다른 토큰은 403 | `served-tenant` | 테넌트 축 없음(= 테넌트 1) |
| Medusa · 쇼핑몰 | 테넌트 1 전용. admin-web 의 Medusa 프록시도 토큰 테넌트 ≠ T 면 403. Medusa 로그인 입구 둘(SSO 콜백은 access_token, `my-auth` 는 내부 토큰)도 토큰 테넌트 ≠ T 면 거절한다(`refuseForeignTenantToken`). 다른 서비스를 내부 키로 부를 땐 T 를 헤더로 싣는다(`apps/medusa/src/utils/served-tenant-headers.ts`) | Kafka 직접 소비 없음 | Medusa DB(테넌트 1) |

## 4. 실수하기 쉬운 곳

각 항목의 «장치»는 그 실수를 빨갛게 만드는 스펙·명령이다. «규율»이라 적힌 것은 지키는 장치가 없다 — 리뷰에서 본다.

### 4.1 코드를 쓸 때

**1. 기본 테넌트를 들이지 않는다.** «맥락이 없으면 테넌트 1» 같은 폴백을 넣으면 맥락을 빠뜨린 코드가 조용히 테넌트 1 DB 를 읽는다. 테넌트 목록·문 모드·T 는 기본값이 없고
틀리면 기동을 거부한다. 테넌트 id 를 코드 상수로 두지 않는다(테넌트 1 의 id 도 문자열 `"1"` 이고 uuid 칸에 들어가지 않는다).
장치: `libs/tenancy/src/tenant-list.spec.ts`, `libs/tenancy/src/tenancy-settings.spec.ts`, `apps/core/src/platform/tenancy/core-tenant-db-routing.integration.spec.ts`.

**2. 요청 밖에서 core DB 에 닿는 코드는 `DbService.forEachDatabase` 안에서.** 크론·폴러·부팅 훅·소비자 부팅 검사가 루프 밖이면 ② 에서 `TenantContextMissingError` 로 터진다.
`@CronOnce` 는 러너가 감싸 주지만 `@Cron`·`@Interval`·`@Timeout` 은 본문에서 직접 써야 한다. 루프를 동시 실행으로 바꾸거나 인스턴스 «도는 중» 깃발을 루프 안에서 보면
둘째 테넌트가 건너뛰어지는데 `cron_runs` 에는 ok 로 남는다. 결과(`DatabaseRun[]`)는 던지지 않으니 실패 처리는 부르는 쪽 몫이다.
장치: `libs/cron-once/src/guards/cron-once-guard.spec.ts`(규칙 `cron-outside-tenant-loop` — 데코레이터 본문만 본다), `apps/core/src/platform/tenancy/core-non-request-tenancy.integration.spec.ts`,
`libs/db/src/db.service.spec.ts`. `onModuleInit`·`setInterval`·`startConsumer` 부팅 경로는 규율.

**3. 토큰의 역할은 토큰 테넌트의 부여만.** 모든 테넌트의 부여를 실으면 다른 테넌트 직원이 테넌트 1 쇼핑몰 토큰으로 테넌트 1 관리자가 된다. 내부 세션 토큰은 계정 테넌트의 부여로 좁힌다(0056 — 그 전에는 T). 계정 테넌트 ≠ 토큰 테넌트면 발급·갱신하지 않는다.
장치: `apps/user-service/src/api/oauth/token-tenant.spec.ts`, `token-tenant.integration.spec.ts`, `apps/user-service/src/api/auth/internal-token-tenant.spec.ts`.

**4. 토큰 vs 헤더: 사람 토큰이 있으면 언제나 토큰이 이긴다.** «`@Public` 은 헤더로만»처럼 구현하면 사람 토큰으로 `@Public` 을 부르는 호출자가 ② 에서 깨진다. 헤더와 토큰이 다르거나
목록 밖이면 두 모드 모두 403. 클레임 없는 토큰을 헤더가 대신하지 못한다(core `@Public` 이 헤더로 공개 콘텐츠 DB 를 고르는 것만 예외). DB 를 안 읽는 헬스 라우트는 `@TenantFree` —
빼먹으면 ② 에서 ALB 가 태스크를 죽인다.
장치: `libs/tenancy/src/request-tenant.spec.ts`, `apps/core/src/platform/tenancy/core-request-tenant.http.spec.ts`.

**5. 토큰을 서명하는 곳은 모두 `tenant` 클레임을 싣는다.** 클레임 없는 토큰을 발급하는 경로가 하나라도 남으면 ① 의 셈이 0 이 안 되고 ② 에서 그 경로가 403 이다. audience 로 테넌트를
추론하게 하면 기본 테넌트가 들어온다. 사람 토큰뿐 아니라 서비스가 다른 서비스를 부르려고 서명하는 토큰(core 의 file-service 위임 토큰·일괄 세션 `ownerToken`, ugc 서비스 토큰)도 같다.
장치: `apps/user-service/src/api/auth/internal-token-tenant.spec.ts`, `apps/core/src/platform/auth/file-service-delegation.spec.ts`, `apps/ugc-service/src/almond-template/clients/service-token.spec.ts`.

**6. 이벤트를 내는 앱은 요청 테넌트를 CLS 맥락에 세운다.** 맥락이 없으면 직접 발행은 T(테넌트 1)로 찍히고, 문은 그 이벤트를 테넌트 1 것으로 통과시킨다 — 아예 없는 것보다 나쁘다
(다른 테넌트 직원의 계정 변경이 테넌트 1 브랜드 알림으로 나갈 뻔했다). 반대로 «계정 이벤트»로 선언하면 모든 T 앱의 문을 통과하니 그것도 답이 아니다. 분류 기준은 «그 일이 일어난 화면의 테넌트»이고, 선언이 없으면 테넌트 이벤트다.
장치: `packages/event-contracts/streams/event-tenancy.spec.ts`, `apps/user-service/src/tenancy/user-request-tenant.interceptor.spec.ts`, `libs/events/src/tenancy/event-tenant-stamp.spec.ts`.

**7. core 는 `publishEvent` 를 직접 부르지 않고, 생산 코드는 `metadata.tenantId` 를 넣지 않는다.** core 의 테넌트 = outbox 행이 든 DB 다. 직접 발행은 어느 DB 의 일인지 모른다.
넣은 값은 라이브러리가 덮어쓴다. 정적 게이트는 `publishEvent|publishEvents|publishCommand(` 를 줄 단위로만 본다 — `publishStoredEnvelope`·전송 계층 직접 호출은 못 잡는다.
장치: `apps/core/src/platform/tenancy/core-no-direct-publish.spec.ts`, `libs/events/src/tenancy/event-tenant-wiring.spec.ts`.

**8. 새 Kafka 소비 앱은 네 군데를 함께 고친다** — `startConsumer(app, { tenancy })` 모드 선언, 루트 모듈의 `TenancyModule`, SST 의 T(`...servedTenantEnv`), 로컬 정본(`scripts/local/e2e-env-map.sh`).
하나라도 빠지면 기동 거부거나 배포 태스크가 안 뜬다. 게이트의 SST 쪽 검사는 `...servedTenantEnv,` 의 개수만 보고 어느 블록에 붙었는지는 안 본다.
장치: `libs/tenancy/src/guards/tenancy-wiring.spec.ts`, `libs/tenancy/src/guards/local-e2e-tenancy.spec.ts`.

**9. 서비스 간 내부 키 호출에는 `x-tenant-id` 를 싣는다.** 공용 클라이언트(`OutboundTenant`)는 CLS 맥락이 있는 Nest 앱만 덮는다. Medusa·쇼핑몰·admin-web 라우트 핸들러·CLS 없는 코드는
직접 실어야 하고, 빠지면 ② 에서 403 이다. Medusa 는 루트 `libs/` 를 못 가져와 헤더 이름 사본을 둔다(둘이 갈리면 게이트가 잡는다).
장치: `scripts/security/permission-wiring.spec.ts`, `libs/authorization/src/served-tenant-gate.spec.ts`, `apps/medusa/src/utils/__tests__/served-tenant-headers.unit.spec.ts`.

**10. admin-web 서버가 쥔 자격증명(Medusa Admin secret, 내부 키)으로 업스트림을 부를 땐 테넌트 판정을 거친다**(`admitServerCredentialTenant`). 판정 없이 쓰면 다른 테넌트 직원이 조회 권한만으로
테넌트 1 상품·주문을 본다. 게이트 사각 둘: 파일 단위라 한 파일 안 다른 핸들러가 판정을 건너뛰는 건 못 잡고, 이름 접미사 `_KEY|_SECRET|_TOKEN|_PASSWORD` 만 본다.
넓은 키를 다른 용도로 빌려 쓰지 않는다(연락처까지 여는 내부 키를 썼다가 OIDC 클라이언트 Basic 으로 바꿨다).
장치: `apps/admin-web/src/lib/auth/server-credential-routes.spec.ts`, `server-credential-tenant.spec.ts`.

**11. 테넌트 셸은 방어선이 아니다.** 허용 목록 화면이 테넌트 1 전용 업스트림을 부르면 그대로 샌다. 게이트는 페이지의 값 import 를 파일 단위로 따라가므로 화면에서 숨긴 블록도 import 하면 닿는다 —
숨김은 `useUpstreamAvailable` 신호 뒤에서만 그린다. 새 화면은 `TENANT_SHELL_SCREENS` 와 `screen-access` 에 함께 넣는다.
장치: `apps/admin-web/src/lib/tenant-shell/tenant-shell.gate.spec.ts`, `allowlist.spec.ts`, `shell-brand.spec.ts`.

**12. 주소로 브랜드가 갈리는 페이지는 언제나 동적.** 정적·ISR·`"use cache"`·`unstable_cache` 로 두면 OpenNext 캐시 키에 호스트가 없어 남의 브랜드가 캐시로 나간다.
admin-web·auth-web 루트 레이아웃은 `force-dynamic` 이고 트리 안에서 뒤집는 선언을 금지한다. 장치: `scripts/tenancy/brand-pages-dynamic.spec.ts`.

**13. 리디렉트 기원은 사이트 판정에서.** 라우트 핸들러의 `request.nextUrl.origin` 은 Host 를 따르지 않아 테넌트 도메인이 아닌 기본 주소로 보낸다. `x-forwarded-host` → host 순의 사이트 판정을 쓴다.
장치: `apps/admin-web/src/lib/tenant-shell/site-rules.spec.ts`.

**14. auth-web 리디렉트는 «클라이언트에 등록됨»으로 허용하지 않는다.** 같은 OAuth 클라이언트에 모든 테넌트 주소가 등록돼 있다. 테넌트 화면은 자기 도메인과 정확히 같은 host 만,
기본 화면은 다른 테넌트 도메인으로 보내지 않는다(그러면 첫 로그인 비밀번호 변경을 건너뛴다). 테넌트 도메인 행을 먼저 넣고 리디렉트를 나중에 등록한다(반대면 관리 API 가 400).
userinfo·`:443` 이 붙은 주소는 정규화가 달라 테넌트를 못 찾는다(fail-closed).
장치: `scripts/tenancy/auth-web-site.spec.ts`, `apps/user-service/src/api/iam/platform/platform-tenant.integration.spec.ts`.

**15. auth-web: 레이아웃이 오류를 그려도 페이지 코드와 서버 액션은 돈다.** redirect 하는 페이지·쿠키를 심는 액션은 따로 막는다. `"use server"` 파일의 export 는 브라우저가 부를 수 있는 액션이 되므로,
인자(누구에게·변경 필요 여부)를 호출자가 정하는 발급 함수는 server-only 모듈에 둔다. 장치: 규율(규칙 함수는 `scripts/tenancy/auth-web-site.spec.ts`).

**16. 테넌트 도메인의 «흔적 0»을 깨는 것들:** `app/favicon.ico` 파일 규칙(metadata 보다 앞서 모든 주소에 박힌다 — `public/` 으로), 로고 없을 때 빈 파비콘(브라우저가 `/favicon.ico` 를 부른다 — `data:,`),
CSS `@import` 외부 폰트(네트워크 호스트 흔적 — 자체 서빙), 사이트 판정 전에 글자 응답을 내는 middleware(파비콘 링크가 빠진다).
장치: `scripts/tenancy/isolation-check/screen-judge.spec.ts` + `npm run isolation:check:local`.

**17. file-service: 쓰기는 요청 테넌트, 읽기·서명·삭제·confirm 은 행의 테넌트.** 요청 테넌트로만 고르거나 버킷 이름을 코드에 두면 남의 버킷을 읽거나 파일을 잃는다. 버킷은 목록에서만 고른다.
직원·위임 예외는 파일 테넌트 = 요청 테넌트일 때만.
장치: `apps/file-service/src/tenancy/file-tenant-axis.http.spec.ts`, `apps/file-service/src/storage/storage.service.spec.ts`.

**18. user-service 의 테넌트 1 데이터 컨트롤러는 `@ServedTenantData()`.** 고객·근태처럼 사실상 테넌트 1 데이터인 라우트를 분류 없이 만들면 다른 테넌트 토큰에 열린다. 계정·토큰·권한 라우트만 모든 테넌트용이다.
장치: `apps/user-service/src/tenancy/served-tenant-classification.spec.ts`, `served-tenant.guard.spec.ts`.

**19. 요청 테넌트 문은 앱마다 따로다.** 판정 함수(`resolveRequestTenant`)는 `@app/tenancy` 공용이지만 인터셉터는 core·file-service·ai·user-service 에 각각 있고(user-service 는 맥락만 세우고 거절하지 않는다),
내부 비밀 비교도 세 곳에 따로 있다. 규칙을 바꿀 땐 넷을 다 본다. 장치: 규율.

**20. 세션을 끊는 거절은 커밋 «뒤»에 던진다.** 테넌트가 준비·정지라 토큰 갱신을 거절할 때, 트랜잭션 안에서 던지면 세션 revoke 가 롤백된다. 장치: 규율.

### 4.2 배포·롤백

**21. 🔴 1 이 아닌 테넌트를 만든 뒤에는 전환 배포 ② 이전으로 되돌리지 않는다.** ① 의 core 는 라우터 없이 단일 DB 를 쓰고 문도 «경고 + 셈»이라 다른 테넌트 토큰이 테넌트 1 DB 를 읽는다.
되돌리기는 직전 `deploy/<stage>/…` 태그 커밋을 코드·배포 설정째 재배포한다 — 이미지만 돌리면 옛 문이 판정한다. 장치: 규율(모드 값은 `deployments/lcnine/auth/infra/services.ts` 의 `tenantGateMode` 한 줄).

**22. 문 모드를 `warn` → `reject` 로 넘기기 전에 셈이 모두 0 이어야 한다** — `core_untenanted_requests_total`, `events_published_without_tenant_total`, `events_consumed_without_known_tenant_total`,
공유 서비스·file-service·ai 의 테넌트 모르는 요청 셈, consumer lag, 그리고 액세스 토큰 수명 경과. admin-web 은 Lambda 라 Prometheus 셈 대신 CloudWatch 경고 로그 줄로 센다.
`reject` 에서 직접 발행은 테넌트를 못 정하면 던지므로 도메인 흐름 자체가 실패한다. 장치: 규율.

**23. 테넌트 설정의 SoT 는 lcnine-auth 다.** 목록(`TenantList`)·T(`ServedTenantId`)·모드(`tenantGateMode`)를 바꾸면 **auth → services** 순서로 배포한다(services 앱은 auth 가 만든 SSM 파라미터를 읽는다). 장치: 규율.

**24. 칸은 Secret → 표 → 배포 순서.** 칸 표(`TENANT_DOMAIN_SLOTS`)를 칸 Secret 보다 먼저 커밋하면 `run()` 맨 앞의 검사가 그 뒤 **모든 live 배포**를 멈춘다(반쯤 된 배포를 막으려고 비거나 공백인 칸 Secret 을 거절한다).
칸을 지우는 길은 표에서 번호를 빼는 커밋뿐이다.
장치: `scripts/deployment/tenant-domain-slots.spec.ts`, `scripts/tenancy/create-tenant/live/human-stops.spec.ts`(만들기 스크립트가 이 순서로 출력한다).

**25. 테넌트 도메인은 `domain.aliases` 로 붙이지 않고, 사이트 `protection` 을 바꾸지 않는다.** 별칭은 인증서 SAN·CT 로그에 다른 테넌트 주소를 남기고, `oac` 는 Lambda 권한을 SST 배포 하나에 묶어 칸이 403 이 된다.
장치: `scripts/deployment/tenant-slot-protection.spec.ts`(aliases 는 규율).

**26. 칸 무효화는 `sst diff` 에 안 보이고, 매 배포 1건이 정상이다.** 트리거(`codeSha256`)가 apply 전 미지값이라 diff 에 교체가 안 보인다. SST 가 배포마다 Next 를 다시 빌드해 소스 변경 0 이어도 본 사이트와 칸이 함께 무효화된다.
무효화 명령 안의 `aws` CLI 는 sst 자격증명을 자동으로 받지 않는다(sst 는 `SST_AWS_*` 로만 넘긴다) — `providers.aws` 에 profile·assumeRoles 를 넣으면 명령에도 넘긴다. 배포 머신에 aws CLI v2 가 필요하다.
장치: 규율(코드는 `deployments/lcnine/tenant-domain-distribution.ts`).

**27. 테넌트 칸 백필의 DB 기본값 `'1'` 은 contract 에서 함께 걷는다.** user-service·file-service·ai 의 테넌트 칸 기본값은 마이그 SQL 에만 있고 `schema.ts` 엔 없다 — drizzle 이 모르므로 NOT NULL 을 거는 custom 마이그에 `DROP DEFAULT` 를 함께 넣는다.
기본값이 남아 있는 동안 «테넌트를 안 넘기는 쓰기»는 조용히 테넌트 1 이 된다. 운영자 성질 변경 이력 행은 일부러 테넌트 null 이다. contract 는 `deploy → migrate` 이고 expand 와 한 배포에 섞지 않는다.
장치: `npm run deploy:preflight`(expand/contract 섞임이면 1). `DROP DEFAULT` 는 규율.

### 4.3 테넌트 만들기·운영

**28. 만들기 스크립트를 우회하지 않는다.** 역할·계정·소속·부여는 운영자 API(iam Manager)로만 만든다 — 직접 SQL 은 권한 상승 방지와 이력을 건너뛴다. 목록 넣기 전 실패는 지나온 단계를 거꾸로 되돌리고,
목록 뒤 실패는 되돌리지 않는다. 같은 id 다른 slug 같은 «남의 상태»를 만나면 되돌리지 않고 멈춘다(`StepRefused` — 되돌리면 남의 행·DB 를 지운다). 사람 손 멈춤은 exit 2, 재실행이 이어간다.
계획 파일이 git 추적 경로면 거절한다. 계획 파일 검사가 user-service 계정 규칙(아이디 소문자·숫자 4~20자, 이름 2~8자)을 먼저 본다.
장치: `scripts/tenancy/create-tenant/runner.spec.ts`, `steps.spec.ts`, `live/live-plan.spec.ts`.

**29. 계정·역할은 전역이다.** 🔸 0056 이 계정 쪽을 뒤집는다(역할 정의는 전역 그대로). 테넌트를 지워도 계정은 남고, 재실행은 «계정 있으면 소속 추가 → 비밀번호 재발급»으로 이어 간다. 역할 이름에 테넌트 이름을 넣지 않는다. 부여 unique 가 `(user, role)` 이라
같은 역할을 두 테넌트에서 받을 수 없다(`IAM_GRANTED_ELSEWHERE`). 회수는 테넌트를 지정한다(`DELETE /admin/roles/:id/members/:userId?tenantId=`) — 지정 없는 회수는 토큰 테넌트 부여만 보고 2xx 로 끝나 다른 테넌트 부여가 조용히 남는다.
장치: `apps/user-service/src/api/iam/assignments/role-assignment.manager.spec.ts`, `platform-tenant.integration.spec.ts`.

**30. 1 이 아닌 테넌트 역할에 테넌트 1 업스트림을 여는 키를 주지 않는다** — `order.*`·`customer.profile.read`·`analytics.report.read`·`ai.assistant.use`·`channel.*`·`master` 등. Medusa 프록시와 공유 서비스는 테넌트 축이 없다(T = 1).
예: 단건 SKU 연결 패널이 요구하는 주문 조회 권한은 Medusa 프록시로 테넌트 1 주문을 연다 — 그래서 새 테넌트의 SKU 연결은 일괄 세션으로만 한다. 새 테넌트에 주문·고객 화면을 열려면 역할이 아니라 Medusa 의 테넌트 분리가 먼저다.
장치: `scripts/tenancy/create-tenant/tenant-staff-role.ts`(키 집합 정본), `live/live-plan.spec.ts`.

**31. 플랫폼 운영자는 둘 이상 유지한다.** 운영자 API 는 라우트 권한(토큰 테넌트의 `master`)과 Manager 의 운영자 성질, 두 겹이다. 한 명뿐인 운영자가 토큰 테넌트에서 `master` 를 잃으면 권한 상승 방지 때문에 스스로 되살릴 수 없다.
장치: `apps/user-service/src/api/iam/tenancy/platform-operator.manager.spec.ts`(마지막 운영자 강등 거절). «둘 이상»은 규율.

**32. 시작 조건은 실제로 잰다.** core 는 테넌트마다 풀 10(롤링 중엔 태스크 수만큼)이라 RDS 클래스와 연결 여유를 재고, ② 인지는 무인증 core 호출이 «테넌트 헤더 없음» 403 을 받는지 직접 불러 본다 — 태그나 기억으로 판단하지 않는다.
RDS 클래스 변경은 수 분 끊김을 동반한다. 장치: `scripts/tenancy/create-tenant/live/start-conditions.spec.ts`.

**33. 정지는 즉시·전부가 아니다.** core 는 상태를 약 15초마다 받고(+ 응답 ≤5초) 사람 토큰 클레임에서 온 테넌트만 막는다. user-service 가 안 닿으면 마지막 값을 유지하고, 한 번도 못 받은 태스크는 막지 않는다.
남은 액세스 토큰은 수명(15분)까지 일부 경로(file-service·ai 는 상태를 보지 않는다)에서 산다. user-service 가 모르는 테넌트는 막지 않는다(빈 응답 한 번에 테넌트 1 까지 멈추지 않게). 운영자는 자기 토큰 테넌트를 정지할 수 없다.
장치: `apps/core/src/platform/tenancy/tenant-status-cache.spec.ts`, `core-request-tenant.http.spec.ts`.

**34. DB 도구는 SSM 목록만 읽는다.** `db:migrate`·`db:bootstrap`·`db:seed:ref`·`deploy:preflight` 가 env 의 `TENANT_LIST` 나 이름 규칙 `core_*` 로 테넌트를 찾으면 라이브 실행이 테넌트 DB 를 빠뜨리거나 남은 DB 가 테넌트가 된다.
목록에서 빠진 DB 는 조용히 건너뛰고 preflight 가 경고만 한다. 시드 dedupe 는 «스텝 이름@DB» 단위다. `sst shell` 은 `SST_STAGE` 를 주지 않으니 stage 는 `SST_RESOURCE_App` 에서 읽는다.
장치: `scripts/seeding/lib/tenant-registry.spec.ts`, `core-tenants.spec.ts`, `scripts/ops/batch-deploy-preflight.spec.ts`.

**35. 테넌트 1 전용 시드·부팅 훅을 «모든 테넌트» 경로에 섞지 않는다.** 섞이면 새 테넌트 DB 에 테넌트 1 의 창고·자사몰 채널이 생긴다. `baseline` 엔 core 밖 서비스 시드도 들어 있어, 새 테넌트에는 core 스텝(`tenantOneData: false`)만 돈다.
장치: `scripts/seeding/lib/core-tenants.spec.ts`.

**36. 테넌트 없는 이벤트의 실패는 테넌트 DB 실패 테이블에 적을 수 없다.** ② 의 core 에서 맥락이 없으면 `event.dead_letters` 에 쓸 DB 가 없어 커밋이 안 되고 같은 메시지가 계속 다시 온다(파티션 정지).
판정 `canRecord()` 가 거짓이면 옛 `.dlq` 토픽으로 보낸다. 다시 넣기는 사람이 돌리는 스크립트로 봉투에 테넌트를 붙여 그 테넌트 DB 로 옮긴다 — HTTP 라우트로 만들지 않는다(테넌트 없는 메시지의 개인정보가 다른 테넌트 직원에게 보일 수 있다).
실패 테이블은 «모든 테넌트 DB 가 가졌을 때만» 켠다(파티션을 같이 쓰므로 한 곳이라도 없으면 보류 검사가 모든 테넌트 소비를 멈춘다). 교훈: 문 하나만 타는 스펙으로는 안 보였다 — `startConsumer` 전체 사슬을 타야 보인다.
장치: `apps/core/src/platform/tenancy/core-untenanted-event-exit.integration.spec.ts`, `libs/events/src/dead-letter/dead-letter-interceptor.spec.ts`, `dlq-import.spec.ts`, `dead-letter-tables.spec.ts`, `npm run events:untenanted-dlq`.

**37. 격리 실측 Secret(`IsolationCheck`)은 칸이 여럿이다** — 테넌트 1 점검 계정·고객·금지어·새 테넌트 점검 계정. 한 칸을 바꿀 때 다른 칸을 지우지 않는다. 새 테넌트 칸은 하나뿐이라 테넌트를 하나 더 만들면 덮인다. 금지어 목록은 레포 밖에만 둔다.
링크하는 앱이 없는 Secret 을 인프라에 선언하면 비었을 때 배포만 멈춘다. 장치: `scripts/tenancy/isolation-check/live-config.spec.ts`.

**38. 상품이 0 인 새 테넌트는 읽기 전용 실측으로 상세 화면을 못 잰다.** 그 실패(«행이 없어 못 잼»)만 남으면 실측이 종료코드 3 을 내고, 만들기의 직원 단계는 그때만 쓰기 실측(`--write`)으로 다시 잰다.
쓰기 실측은 테넌트를 잠깐 정지했다 되돌린다. 장치: `scripts/tenancy/isolation-check/runner.spec.ts`, `scripts/tenancy/create-tenant/live/isolation-gate.spec.ts`.

### 4.4 테스트·로컬

**39. 격리 실측 판정을 느슨하게 짜면 헛초록이 난다.** 403 상태만 보면 권한 거절과 문의 거절이 구별되지 않는다(문 하나를 끈 실연에서 권한 거절로 «통과»했다) — 문 문구로 판정하고 테넌트 1 대조 호출 2xx 를 먼저 본다.
화면은 닫힌 메뉴·모달 안의 글자를 못 본다. 동적 화면은 게시된 상품이어야 한다(초안이면 «업스트림 0» 이 헛초록). 메트릭은 «아직 안 들어옴»과 «0» 을 가른다 — PromQL `timestamp()` 는 식이 아니라 셀렉터에 걸어야 샘플 시각이다.
`cron_runs` «주기당 1행»은 PK 가 보장해서 세어 봐야 늘 0 이다.
장치: `scripts/tenancy/isolation-check/gate-messages.spec.ts`, `screen-refusal-texts.spec.ts`, `judge.spec.ts`, `prometheus.spec.ts`, `screen-judge.spec.ts`.

**40. 로컬 테넌트 2 는 `reject` 에서만 섬긴다**(`E2E_GATE_MODE=reject npm run start:all:local`). 기존 로컬 `.env`·admin-web `.env.local` 엔 T·모드 줄이 없을 수 있다(admin-web 은 없으면 Medusa 프록시 503) —
`npm run bootstrap:e2e:local` 한 번이 빠진 줄을 더한다. dotenv-cli·Next 는 이미 있는 값을 덮지 않는다. `tenant:create:local` 은 core 가 떠 있으면 거절한다. auth-web dev(Turbopack)는 CSS `@import` 변경을 touch 로는 다시 굽지 않는다.
장치: `libs/tenancy/src/guards/local-e2e-tenancy.spec.ts`, `scripts/local/e2e-env-map.sh`(정본), `scripts/local/preflight-e2e.sh`.

**41. 테넌트 칸 마이그는 «구조 + 백필» 두 개라 drizzle 스냅샷이 같은 초에 덮이기 쉽다.** generate 와 custom 을 연달아 돌릴 땐 사이에 1~2초 띄운다. 장치: 규율.

## 5. 운영 절차

명령은 전부 운영자 머신에서 사람이 돌린다. 운영자 로그인을 묻는 명령(`tenant:create`, `isolation:check --write`)은 TTY 가 필요하다.

**테넌트 만들기** — `npm run tenant:create -- --stage <stage> --plan <계획 파일>`(`scripts/tenancy/create-tenant/live/live.ts`).
계획 파일(`live-plan.ts` 스키마)은 레포 밖이나 git 이 무시하는 곳에 둔다 — 테넌트 값은 그 파일에만 있다. 단계 러너가 멱등이라 멈춤마다 할 일을 하고 다시 돌리면 이어간다.
순서: 시작 조건 → 테넌트 행 «준비» → core DB·마이그·시드 → 버킷 둘·권한 → 인증서 → 리디렉트 → 역할 → 점검 계정 → [멈춤] 칸 Secret → [멈춤] 목록 Secret →
[멈춤] 칸 표 커밋 + 배포 → 만든 직후 확인 → «활성» → 격리 실측 → 직원 명단(초기 비밀번호는 이때 한 번만 출력). 목록 Secret 전 실패는 DB·행·버킷·권한을 되돌린다.
로컬 리허설은 `npm run tenant:create:local` 과 `docs/local-e2e-environment.md` §2-C.

**정지** — `npm run tenant:create -- --stage <stage> --plan <계획 파일> --suspend`. user-service 의 테넌트 상태를 «정지»로 바꾼다. 새 토큰 발급은 바로 막히고,
core 는 상태 캐시(약 15초) + 요청 경로 지연(≤5초) 안에 남은 액세스 토큰도 거절한다. user-service 에 닿지 못하는 경로는 액세스 토큰 수명(15분)까지 열려 있다.
file-service 직접 업로드도 토큰 수명까지 열린다. 데이터는 그대로 남는다.

**격리 실측** — 매 배포 뒤 `npm run isolation:check -- --stage live`(읽기 전용), 개통 때 한 번 `-- --write`(테넌트 2 점검 계정으로 «[개통 점검]» 행을 만들고 지운다,
정지 스위치도 잰다). 로컬은 `npm run isolation:check:local`. 점검 목록은 로컬·라이브가 한 벌이다(`scripts/tenancy/isolation-check/checks.ts`). 라이브에서 «못 쟀다»는 통과가 아니다.
`deploy:preflight --mark-deployed` 가 테넌트가 둘 이상이면 끝에 이 명령을 알려 준다.

**배포** — `npm run deploy:preflight -- --stage live` 가 테넌트 DB 마다 대기 마이그를 보고, 테넌트 사이 버전이 다르면 1 로 끝난다. 배포 순서·태그는 `CLAUDE.md` 의 배포 절.
