# 공유 서비스는 앱 단위로 한 테넌트를 섬기고, 서비스끼리의 호출은 테넌트를 명시한다

## Status
Accepted (2026-10-29, 교정 10-30·10-31). 라이브(전환 배포 ②, 2026-11-02). 멀티테넌트 전체 그림은 `docs/multi-tenancy.md`.
선행: [[0051-core-tenant-per-database]] · [[0052-account-is-global-tenant-is-membership-and-grant]] · [[0053-event-tenant-stamped-by-library-gated-before-handler]].

## Context
core 밖의 서비스(wallet·membership·analytics·ugc-service·notification·search·channel-adapter)는 DB 를 테넌트로 나누지 않았고, 데이터는 사실상 테넌트 1 의 것이다.
그런데 테넌트 2 직원은 core 일 때문에 `analytics.report.read`·`order.order.*`·`catalog.product.read` 같은 키를 정당하게 받을 수 있고,
그 키가 공유 서비스에서는 테넌트 1 데이터를 연다. 권한 키 단위로 막으면 키마다 판단해야 하고, 실제 사용처와 어긋난 키를 놓친다.

## Decision
1. **공유 서비스는 한 테넌트 T 만 섬기는 앱이다.** T 는 이벤트 문과 같은 앱 설정 값(`SERVED_TENANT_ID`) 하나다.
2. **판정은 라우트마다 손으로 달지 않고 `PermissionModule.forRoot` 가 앱 단위로 한다**(`libs/authorization/src/services/served-tenant-gate.ts`).
   토큰을 받는 모든 입구(`@RequirePermission`·`@StoreRoute`·토큰이 온 `@OptionalAuth`)에서 토큰 테넌트 ≠ T 면 403 이다. 부팅 때 T 가 목록에 없으면 기동 거부.
3. **토큰 없는 입구는 자격증명을 누가 쥐었나로 가른다.**
   - T 만 쥔 자격증명(머천트 키)과 `@Public` 은 그 자체로 T 다.
   - 여러 테넌트를 섬기는 호출자도 쥐는 자격증명(서비스 내부 키, `@InternalOnly`)은 **테넌트 헤더(`x-tenant-id`)가 필수**다. 없거나 T 와 다르면 거절한다.
4. **헤더를 믿는 범위**: 헤더는 서비스 신원(내부 키) 입구에서만 테넌트를 정한다. **사람 토큰이 오면 언제나 토큰 테넌트가 이기고**, 헤더가 그와 다르면 거절한다.
   헤더는 이벤트 봉투처럼 공용 HTTP 클라이언트가 맥락에서 찍는다(`libs/tenancy/src/tenant-header.ts`).
5. **core 로 들어오는 호출**: core 의 내부 키 가드는 헤더가 필수이고 목록과 대조한다. core 의 `@Public` 라우트는 토큰이 오면 토큰 테넌트, 없으면 헤더로 DB 를 고르고,
   둘 다 없으면 실패한다. 쇼핑몰처럼 고정 테넌트 앱은 자기 T 를 헤더로 싣는다.
6. **ai·file-service 는 플랫폼 공용이라 행에 테넌트 축을 단다**(옛 행 = 테넌트 1).
   - ai: 대화·업로드 파일에 토큰 테넌트. 대화 목록은 (계정, 테넌트)로 가른다.
   - file-service: `uploads` 에 토큰 테넌트. 직원 키 예외(디지털 상품·아카이브 열람)는 파일 테넌트 = 토큰 테넌트일 때만. **새 테넌트는 자기 버킷 둘**(공개·비공개)을 쓴다.
     버킷 이름은 목록에서 파생하고 코드에 상수로 두지 않는다. 맥락 없는 요청은 실패 — 공개 파일 읽기(`GET /files/public/:id`)만 파일 행의 테넌트 버킷에서 꺼내 준다.
   - core 가 서명하는 file-service 토큰(위임 토큰, 일괄 세션 `ownerToken`)은 맥락의 테넌트를 싣는다.
7. **admin-web 서버가 쥔 자격증명으로 업스트림을 부르는 라우트**(Medusa 프록시 — 공유 Admin secret, channel-dispatch — 내부 키)도 같은 판정을 받는다:
   토큰 테넌트 ≠ 그 업스트림이 섬기는 T 면 403(`apps/admin-web/src/lib/auth/server-credential-tenant.ts`). 새 라우트는
   `apps/admin-web/src/lib/auth/server-credential-routes.spec.ts` 가 막는다.

## Considered Options
- **권한 키마다 «core 에선 테넌트별, 공유 서비스에선 테넌트 1» 성질** — 반려. 키마다 판단해야 하고, 라우트 하나 빠뜨리면 곧 누출이다.
- **공유 서비스에 지금 테넌트 축이나 테넌트별 DB** — 이번엔 반려. 두 번째 테넌트가 그 기능을 쓸 때 서비스별로 다시 연다.
- **테넌트별 내부 키** — 반려. 키 회전이 N 배가 되고 키 목록이 Secret 마다 퍼진다.
- **내부 키 호출 = 테넌트 1 고정** — 반려. 기본 테넌트를 코드에 들인다([[0051-core-tenant-per-database]]).
- **파일은 테넌트 칸만, 버킷 공용** — 반려. 파일 URL 이 버킷 이름을 품은 절대 주소로 저장돼, 나중에 나누려면 저장된 URL 을 전부 다시 써야 한다. 다른 테넌트 고객에게 테넌트 1 버킷 주소도 보인다.
- **버킷만 나누고 테넌트 칸 없이** — 반려. 접근 판정은 공용 DB 의 `uploads` 행으로 하고 S3 키도 하나라, 남의 파일 id 로 여는 길이 막히지 않는다. 테넌트 칸이 1차, 버킷이 2차 방어선이다.

## Consequences
- 테넌트 2 토큰이면 admin-web 에서 analytics·wallet·search·ugc·membership·notification·channel-adapter·Medusa 호출이 전부 403 이다. 그 화면들은 테넌트 셸에서 열리지 않는다
  ([[0055-tenant-shell-on-tenant-domain]]). 같은 이유로 **1 이 아닌 테넌트 역할에 `order.*` 같은 키를 주면 안 된다** — 화면 일부(SKU 연결 패널)가 Medusa 프록시로 테넌트 1 주문을 연다.
- 공유 서비스 하나를 다른 테넌트에게 열 때의 길: 앱을 `per-message`([[0053-event-tenant-stamped-by-library-gated-before-handler]])·«토큰 테넌트별»로 바꾸고 저장소에 테넌트 축을 단다.
  게이트 설정에서 T 를 빼는 것이 그 전환의 표지다.
- 버킷과 S3 키의 IAM 권한은 SST 리소스가 아니라 테넌트 만들기 스크립트가 만든다(`scripts/tenancy/create-tenant/`). 공개 버킷 이름은 그 테넌트 고객에게 보이므로 운영사 이름을 넣지 않는다.
