# inventory 컨트롤러 전면 스코프 authorization (#551)

- 이슈: [#551](https://github.com/LCNINE/almondyoung-server/issues/551) · 상위 순서 [#713](https://github.com/LCNINE/almondyoung-server/issues/713) 1단계
- 선행 판례: [#546](https://github.com/LCNINE/almondyoung-server/issues/546) (`inventory.warehouse.manage`)
- 브랜치: `fix/inventory-scope-authorization` (base `ff31ccc17`)
- 마이그레이션: **0건** · admin-web 변경: **0건**

## 이슈 본문에서 뒤집힌 전제 2건

착수 전 실측에서 #551 본문의 두 전제가 틀린 것으로 확인됐다. 설계는 정정된 사실 위에 선다.

### 1. "인증만 통과하면 누구나 호출할 수 있다" 는 더 이상 사실이 아니다

#572 의 `AdminRealmGuard` 가 전역 `APP_GUARD` 로 등록돼 있고(`apps/core/src/app.module.ts:60`,
커밋 `30e9d3848`, 라이브 배포 완료), **표시 없는 라우트를 `admin`/`master` 전용으로 기본
차단**한다. inventory 모듈에서 `@Public` 은 health 3개뿐이고 `@StoreRoute` 는 0건이므로 나머지
라우트 전부가 이 기본 차단 아래 있다. 감사 도구도 core 를
`AdminRealm=true 기본차단=true` 로 보고 `[A] 무력화 0` 을 낸다.

따라서 실제 노출은 "인터넷에 열려 있다" 가 아니라 **"직원 계정 하나가 재고 원장 전체를
움직일 수 있다"** 다. #713 이 1단계에 넣은 근거("지연 비용이 계속 발생한다")는 #705 에는
맞지만 **이 항목에는 맞지 않는다.** 이 작업은 유출 차단이 아니라 최소권한 정비다.

### 2. 전수조사가 빠졌다 — 16 컨트롤러 / 70 쓰기가 아니라 18 / 85

| 누락 | 쓰기 | 왜 빠졌나 |
|---|---:|---|
| `inbound/controllers/inbound.controllers.ts` | 11 | 파일명이 **`.controllers.ts`(복수)** 라 이슈의 `find -name "*.controller.ts"` 글롭이 통째로 놓쳤다 |
| `warehouse-transfer/controllers/warehouse-transfer.controller.ts` | 4 | #629 이후 추가됨 |

`.controllers?.ts` 로 보는 기존 `scope-guard-binding.spec.ts` 는 이미 옳게 잡고 있었다.
**이름 패턴으로 판정해서 놓친 것** — [#705](https://github.com/LCNINE/almondyoung-server/issues/705)
에서 고친 `route-authz-audit.js` 사각지대(면제 표기를 이름으로만 판정)와 같은 계열의 실수다.
이 설계가 AST 기반 커버리지 스펙을 포함하는 이유가 이것이다.

## 이 작업의 진짜 위험

`admin-realm.guard.ts:53` — **`@RequireScopes` 가 붙은 라우트는 `AdminRealmGuard` 가 비켜선다.**
"정책이 이미 명시됨" 으로 보고 직원 역할 검사를 건너뛴다.

즉 스코프 부착은 단조롭게 제한적이지 않다. 매핑을 빠뜨리면 admin 이 깨지고, 넓게 매핑하면
오히려 비-admin 에게 열린다. 이 작업에서 날 수 있는 사고는 전부 여기서 난다.

## 호출자

| 호출자 | 사용 | role |
|---|---|---|
| admin-web | inventory 화면 15개 | 전부 `RouteGuard requireRole={['admin','master']}` |
| warehouse-app (PDA) | 조회 9경로 + 쓰기 `/inventory/stocks/adjust`, `/movement/move`, `/stocktaking/*`, `/inbound/putaway`·`plans/receive`·`simple`·`cancel` | 코드에 role 언급 없음. fulfillment 경로는 `logistics_worker` 로 설계돼 있다 |
| 타 서비스 | **없음** — core inventory 를 부르는 코드 0건 (channel-adapter·medusa·search·analytics·wallet 전수 grep) |

**admin-web 쪽에서는 스코프 분할이 아무 차이를 만들지 않는다.** 15개 페이지가 전부
`admin`+`master` 게이트이므로 어떤 스코프를 만들든 `admin` 에 전부 매핑해야 한다. 분할이
의미를 갖는 축은 warehouse-app 의 `logistics_worker` / `logistics_manager` 하나뿐이다.

`logistics_*` 는 admin-web 전체에서 fulfillment API 라우트 1곳에만 등장한다
(`app/api/fulfillment/channel-dispatch/channel-dispatch-route.ts:33`).

## 결정된 사항

| # | 결정 | 근거 |
|---|---|---|
| 1 | **스코프 입도 = 위험도 3분할** (`operate` / `manage` / `adjust`) | fulfillment 선례와 같은 모양 — 기본 operate 하나 + 개별적으로 위험한 능력만 분리. 컨트롤러 1:1(17개)은 과하고, 도메인별 7개는 오늘 구분할 호출자가 없어 매핑표가 전부 같은 값이 된다 |
| 2 | **읽기도 위험도로 나눠 부착** | 읽기는 지금 열려 있는 게 아니라 `AdminRealmGuard` 에 막혀 있다. 부착은 "닫기" 가 아니라 PDA 에게 "열기" 다. 단 매입 원가(`unitPrice`)·거래처 은행계좌(`bankAccountNo`)가 나가는 purchase-orders·suppliers 읽기는 `manage` |
| 3 | **admin 은 3개 전부 보유. admin-web 은 손대지 않는다** | 이 PR 의 실효는 (a) PDA 가 admin 없이 동작 가능해짐 (b) 새 라우트가 스코프 없이 들어오면 스펙이 잡음. admin 자체의 권한 축소는 role 재편이 필요해 별도 이슈로 미룬다 |
| 4 | **한 PR** | 배포 1회, 매핑표 한 번에 확정. 대가인 "130줄 diff 를 눈으로 못 잡는다" 는 §커버리지 스펙으로 갚는다 |

## 스코프 정의

`apps/core/src/platform/auth/inventory-scopes.ts` 에 3개를 추가한다. 기존
`inventory.warehouse.manage` 는 그대로 둔다.

| 스코프 | 뜻 | `logistics_worker` | `logistics_manager` | `admin` |
|---|---|:-:|:-:|:-:|
| `inventory.operate` | 현장 작업 + 일반 조회 | ✅ | ✅ | ✅ |
| `inventory.manage` | 마스터데이터·매입·거래처 | — | ✅ | ✅ |
| `inventory.adjust` | 원장을 직접 움직이는 것 | — | ✅ | ✅ |
| `inventory.warehouse.manage` *(기존)* | 창고 CRUD·피킹 방식 | — | ✅ | ✅ |

`master` 는 `ScopeGuard` 가 바이패스하므로 매핑에 넣지 않는다(`scope.guard.ts:74`).

매핑은 `INVENTORY_ROLE_MAPPINGS` 배열만 늘린다. `ALL_ROLE_MAPPINGS` 의
`mergeRoleMappings` 가 role 이름 기준으로 BC별 매핑을 합치므로 **직접 spread 하지 않는다** —
`ensureRoleScopeMappings`(`authorization.service.ts:97`)가 중복 roleName 에 던지고 `:127` 이
목록에 없는 행을 지운다.

## 라우트 배정 — 154개 전수

AST 로 뽑은 `modules/inventory` 전체 라우트 154개(쓰기 88 · 읽기 66)를 남김없이 배정한다
(`.controllers?.ts` 기준 — `inbound.controllers.ts` 포함).

| 스코프 | 수 | 대상 |
|---|---:|---|
| `operate` | 70 | `/inbound/*` 쓰기 11 + 읽기 7(계획·입고·적치·검증·메모), `/stocktaking/*` 쓰기 7 + 읽기 3(세션·스캔·카운트), `/movement/*` 3, 조회 전반 39 — `/inventory/stocks`·`/skus`·`/sku-groups`·`/warehouses`·`/reservations`·`/transfers`·`/returns`·`/safety-stock-*`·`/holders`·`/locations` |
| `manage` | 56 | sku-catalog 6W, sku-group 6W, sku-managers 4W, locations 7W, holders 3W, barcode-generation 5W, suppliers 3W+2R, supplier-categories 3W+2R, purchase-orders 11W+4R |
| `adjust` | 18 | `/inventory/stocks/adjust`·`entry-safe`·`summary/…/rebuild`·`events/:id/cancel`, `/stocktaking/sessions/:id/generate-adjustments`, transfers 3W, returns 4W, warehouse-transfers 4W, reservations 2W |
| `warehouse.manage` | 3 | 기존 그대로 (`POST` / `PATCH :id` / `DELETE :id`) |
| **무표시 유지** | 7 | `/inventory/health*` 4(3개는 `@Public`, `/health/detailed` 는 AdminRealmGuard 전용), `/inventory/ledger-reconciliation` 2, `/inventory/product-sellable-quantities/variants/:variantId` 1 |

`warehouse.controller.ts` 의 읽기 3개는 무표시 → `operate` 로 이동한다. PDA 가
`GET /inventory/warehouses` 를 읽기 때문이다.

**무표시 7개의 근거**: health 4개 중 3개(`/health`·`/health/live`·`/health/ready`)는 이미
`@Public`이고, `/health/detailed`는 `@Public`이 아니라 `AdminRealmGuard`가 계속 지키는
진단용 엔드포인트다. ledger-reconciliation 과
product-sellable-quantities 는 진단·내부 조회 전용이고 **저장소 전체에서 HTTP 호출자가
0건**이다(전수 grep). 표시를 붙이지 않으면 `AdminRealmGuard` 가 계속 `admin`/`master` 로
지키므로, 이게 이들에게는 올바른 기본값이다.

전체 라우트별 배정표는 구현 계획(`docs/superpowers/plans/`)에 표로 싣고, 테스트로도 못 박는다.

### 판단이 갈릴 수 있는 배정 3건

의도적으로 이렇게 정했다는 기록:

- **`POST /inbound/return` → `operate`** (반품 *입고*는 현장 수령 행위)인데
  **`/inventory/returns/*` 쓰기 → `adjust`** (반품 레코드의 검수·처리 수명주기)다. 경로 이름이
  비슷하지만 다른 행위다.
- **`PUT /stocktaking/lines/:id/count` → `operate`.** 실사 카운트 입력은 PDA 작업자의 핵심
  행위다. 그 카운트를 원장에 반영하는 `generate-adjustments` 만 `adjust` 로 뗀다.
- **`/inventory/skus/*` 읽기 → `operate`, 쓰기 → `manage`.** 같은 컨트롤러 안에서 갈린다.
  데코레이터가 핸들러 단위이므로 문제없다.

### 결과로 생기는 동작 2건

warehouse-app 이 부르는 `POST /inventory/stocks/adjust`(재고조정)와
`POST /stocktaking/sessions/:id/generate-adjustments`(실사 차이 반영)는 `adjust` 라
**`logistics_worker` 에게 403** 이 된다. 그 두 화면은 `logistics_manager` 를 요구하게 된다.

**회귀는 아니다.** 오늘도 `AdminRealmGuard` 가 `logistics_worker` 를 그 두 경로에서 막고
있으므로 나빠지는 것은 없다. 나머지 PDA 경로(적치·입고확정·실사 카운트·이동·조회 전반)는
`operate` 라 worker 로 열린다. 이 설계는 **단조적으로 안전**하다 — 권한이 넓어지기만 한다.

## 누락을 기계가 잡는다 — 신규 스펙 1개

한 PR 을 고른 대가를 여기서 갚는다. 데코레이터 130줄 diff 를 눈이 아니라 테스트가 검토한다.

### `inventory-scope-coverage.spec.ts`

기존 `scope-guard-binding.spec.ts` 와 같은 AST 방식으로 `modules/inventory` 의 모든 핸들러를
훑고, 각 라우트가 둘 중 하나임을 단언한다:

1. `@RequireScopes` + 같은 라우트의 `ScopeGuard` 짝을 갖는다, 또는
2. 사유 문자열이 붙은 `INTENTIONALLY_UNSCOPED` 목록에 있다.

**스코프 판단 없이 새 라우트가 들어오면 빨강.** 이것이 #551 의 재발 방지선이자, 이 이슈를
만든 원인(전수조사가 사람 손 글롭이었다는 것)에 대한 구조적 답이다.

배정표가 154행 전수이므로 "표에 없는 라우트 = 실패" 가 곧 커버리지 단언이다. 별도의
배정표 스펙을 두지 않는 이유가 이것이다 — 같은 표를 두 번 읽게 된다.

### 갱신할 기존 스펙

- `inventory-scopes.spec.ts` — 새 스코프 3개와 role 매핑
- `merged-scopes.spec.ts` — 병합 결과의 role 별 스코프 집합

## 마이그레이션·배포

- **마이그레이션 0건.** `ScopeBootstrapService.onModuleInit` 이 부팅 시 스코프와 매핑을
  upsert 한다.
- **admin-web 변경 0건.** 배포는 core 단독이고 순서 제약이 없다.
- 배포 후 실측: admin 계정으로 inventory 화면 몇 개를 눌러 403 이 없는지 확인. 매핑 누락의
  유일한 증상이 그것이다.

## 검증

| 게이트 | 기준 |
|---|---|
| `npm run type-check` | 에러 0 |
| `npx jest --maxWorkers=2` | 실패 0 (`--maxWorkers` 없이 돌리면 OOM) |
| 신규 스펙 1개 | 통과 |
| `node scripts/security/route-authz-audit.js` | `[A] 무력화 0` 유지 |

## 범위 밖

- **admin role 자체의 권한 축소.** admin-web 15개 페이지의 `requireRole` 재배치 + 기존 admin
  유저에게 `logistics_manager` 부여(DB 작업)가 필요하다. 이 PR 과 분리한다.
- **`logistics_*` role 을 실제 사용자에게 부여하는 운영 작업.** 시드는 role 을 만들지만
  `admin` 유저에게는 `master`+`admin` 만 붙인다(`user-service.seed-step.ts:330`). PDA 운영자가
  현재 어떤 role 을 들고 있는지는 라이브 DB 실측이 필요하며, 이 PR 의 선행조건은 아니다
  (설계가 단조적으로 안전하므로).
