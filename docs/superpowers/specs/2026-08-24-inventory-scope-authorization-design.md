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

AST 로 뽑은 `modules/inventory` 전체 라우트 154개(쓰기 88 · 읽기 66)를 남김없이 배정한다.
수집은 파일 이름이 아니라 **`@Controller` 데코레이터의 존재**로 판정한다 — 이름 글롭이
`inbound.controllers.ts` 를 놓친 것이 #551 을 만든 원인이므로 같은 판정을 재사용하지 않는다.

| 스코프 | 수 | 대상 |
|---|---:|---|
| `operate` | 69 | `/inbound/*` 쓰기 9 + 읽기 7(실입고·적치·검증·메모·취소·회송), `/stocktaking/*` 쓰기 7 + 읽기 3(세션·스캔·카운트·미리보기), `/movement/*` 3, `POST /inventory/transfers/move-within-warehouse` 1, 조회 전반 39 — `/inventory/stocks`·`/skus`·`/sku-groups`·`/warehouses`·`/reservations`·`/transfers`·`/returns`·`/safety-stock-*`·`/holders`·`/locations` |
| `manage` | 58 | sku-catalog 6W, sku-group 6W, sku-managers 4W, locations 7W, holders 3W, barcode-generation 5W, inbound 계획 생성 2W(`POST /inbound/plans`·`plans/items`), suppliers 3W+2R, supplier-categories 3W+2R, purchase-orders 11W+4R |
| `adjust` | 17 | `/inventory/stocks/adjust`·`entry-safe`·`summary/…/rebuild`·`events/:id/cancel`, `/stocktaking/sessions/:id/complete`, 창고 간 transfers 2W(`POST /inventory/transfers`·`PATCH :id/execute`), returns 4W, warehouse-transfers 4W, reservations 2W |
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

### 판단이 갈릴 수 있는 배정 5건

의도적으로 이렇게 정했다는 기록:

- **실사는 세는 것과 원장에 확정하는 것이 갈린다.** `PUT /stocktaking/lines/:id/count` ·
  `scan-location` · `scan-product` · `POST /stocktaking/sessions/:id/generate-adjustments` 는
  전부 `operate` 다. `generate-adjustments` 는 이름과 달리 **아무것도 영속하지 않는
  dry-run** 이다 — `stocktaking.service.ts::generateAdjustments` 는 라이브 delta 를 계산해
  `preview` 배열만 돌려주고 `eventsPosted: 0` 으로 끝난다. 카운트 입력도 미리보기도 PDA
  작업자의 핵심 행위다. 원장에 실제로 쓰는 것은 `POST /stocktaking/sessions/:id/complete`
  하나뿐이고(`commandService.adjustUp`/`adjustDown` 호출, 하향 경로는
  `bypassReservationGuard: true` 로 **예약 가드까지 무시**한다), 그것만 `adjust` 로 뗀다.
- **`POST /inbound/return` → `operate`.** 이름이 "반품 입고" 로 읽히지만 실제 행위는 *회송*
  이다 — `inbound.service.ts::returnInbound` 는 `ADJUST_DOWN` 이벤트를 `reason: 'RETURN'` 으로
  발행해 원위치 재고를 **깎는다**. 그럼에도 `operate` 인 이유는 방향이 아니라 **경계**다:
  특정 입고 라인 하나에 묶여 있고, 적치가 한 건이라도 발생했으면 거절되며
  (`putawayFromOriginQty > 0` → 400), 원위치 ON_HAND 를 초과할 수 없다. `/inbound/cancel` 과
  같은 계열의 **경계가 정해진 보상 행위**이지 임의 원장 조작이 아니다. 반면
  **`/inventory/returns/*` 쓰기 → `adjust`** 는 반품 레코드의 검수·처리 수명주기로, 경로
  이름만 비슷할 뿐 다른 행위다.
- **`POST /inventory/transfers/move-within-warehouse` → `operate`.**
  `transfer.service.ts::moveWithinWarehouse` 는 한 `warehouseId` 안에서
  `fromLocationId → toLocationId` 로 옮긴다 — `POST /movement/move` 와 **같은 능력**이고, 그쪽은
  현장 PDA 가 실제로 부르는 `operate` 라우트다. 한쪽만 `adjust` 로 잠가봐야 같은 일을 다른
  경로로 할 수 있으니 아무것도 막지 못한다. 창고를 **넘는** 이동(`POST /inventory/transfers`,
  `PATCH /inventory/transfers/:id/execute`)은 `adjust` 로 남긴다.
- **`/inventory/skus/*` 읽기 → `operate`, 쓰기 → `manage`.** 같은 컨트롤러 안에서 갈린다.
  데코레이터가 핸들러 단위이므로 문제없다.
- **`POST /inbound/plans`·`plans/items` → `manage`.** 입고 계획 *생성*은 데스크 업무다. PDA 는
  계획을 만들지 않는다 — `native/warehouse-app/src` 의 쓰기 호출은 `/inbound/plans/receive`,
  `/inbound/simple`, `/inbound/putaway`, `/inbound/cancel` 넷뿐이다. 현장 수령 행위인
  `plans/receive` 만 `operate` 로 남는다.

### 결과로 생기는 동작 2건

warehouse-app 이 부르는 `POST /inventory/stocks/adjust`(재고조정)와
`POST /stocktaking/sessions/:id/complete`(실사 완료 — 차이를 원장에 확정)는 `adjust` 라
**`logistics_worker` 에게 403** 이 된다. 그 두 화면은 `logistics_manager` 를 요구하게 된다.

실사 화면(`VarianceReviewScreen`)은 이 경계가 화면 하나를 가로지른다: 같은 화면의
`generate-adjustments`(미리보기)는 `operate` 라 worker 가 눌러 차이를 확인할 수 있고, 그
결과를 확정하는 `complete` 에서 403 이 난다. **의도한 모양이다** — 세는 사람과 원장을
확정하는 사람을 나누는 것이 이 분할의 목적이다.

**회귀는 아니다.** 오늘도 `AdminRealmGuard` 가 `logistics_worker` 를 그 두 경로에서 막고
있으므로 나빠지는 것은 없다. 나머지 PDA 경로(적치·입고확정·실사 카운트·미리보기·이동·조회
전반)는 `operate` 라 worker 로 열린다.

**단, "회귀 없음" 은 "새 노출 없음" 이 아니다.** 이 설계를 "단조적으로 안전" 하다고 쓰면 안
된다 — `@RequireScopes` 부착은 `AdminRealmGuard` 의 바닥을 걷어내므로(`:53`), 배포 순간
`logistics_worker` 를 들고 있는 모든 계정이 inventory 라우트 **69개를 새로 얻는다**. 기존
호출자(admin·master) 기준으로 잃는 권한이 없다는 뜻일 뿐이고, 얻는 쪽은 실재한다. 그래서
배포 선행조건으로 **라이브 role 보유자 실측**을 건다(§마이그레이션·배포).

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

### 선행조건 — 배포 전에 `logistics_*` 보유자를 센다 (필수)

배포 순간 `logistics_worker` 보유자는 inventory 라우트 69개를, `logistics_manager` 보유자는
154개 중 147개를 얻는다. 그게 의도인지는 **보유자가 실제로 있는지**에 달려 있으므로, 배포
전에 user-service DB 에서 센다:

```sql
-- user-service DB (lcnine-auth 배포). role 은 roles(role_id, name) ↔ user_roles(user_id, role_id).
SELECT r.name AS role_name, count(*) AS holders
FROM user_roles ur
JOIN roles r ON r.role_id = ur.role_id
WHERE r.name IN ('logistics_worker', 'logistics_manager')
GROUP BY r.name;
```

- **0행 / 0명** → 배포는 휴면이다. 라우트는 열리지만 그 스코프를 든 계정이 없으므로 실효
  변화가 없다. 그대로 진행한다.
- **1명 이상** → 그 계정들이 배포 즉시 위 라우트를 얻는다. **진행 전에 그게 의도인지 확인을
  받는다.** 확인 없이 배포하지 않는다.

시드는 role 을 만들지만 `admin` 유저에게는 `master`+`admin` 만 붙이므로
(`user-service.seed-step.ts:330`) 0명이 기대값이다 — 하지만 기대는 실측이 아니다.

### 롤백·중단 배포 주의 — 옛 태스크가 매핑을 지운다

`ensureRoleScopeMappings`(`libs/authorization/src/services/authorization.service.ts:127`)는
**넘겨받은 목록에 없는 매핑 행을 지운다**(`notInArray` delete). 새 매핑이 쓰인 뒤에 옛
태스크가 부팅하면 — 롤백이거나, 롤링 도중 옛 태스크가 교체되는 경우 — 그 태스크는 새
inventory 스코프 3개를 모르므로 **`admin` 의 해당 매핑 행 3개를 지운다.**

- 이미 떠 있는 태스크는 영향 없다. `AuthorizationService.scopeCache` 는 TTL 이 없어 부팅 시
  읽은 값을 그대로 들고 있다.
- 다음 신규 태스크 부팅에서 **자동 복구**된다.
- **실무 지침: 롤백했거나 배포가 중간에 끊겼으면, 새 태스크를 한 번 띄워 매핑을 복원한다.**

### 배포 후 실측

1. **매핑 누락 확인** — admin 계정으로 inventory 화면 몇 개를 눌러 403 이 없는지 확인.
   매핑 누락의 유일한 증상이 그것이다.
2. **과다 부여 확인** — `logistics_worker` 토큰으로
   `POST /stocktaking/sessions/:id/complete` 를 호출해 **403 이 나는지** 확인한다.
   1번은 매핑이 빠진 것만 잡고 **넓게 준 것은 못 잡는다** — 이 확인이 그 반대 방향의
   유일한 방어선이다. (`logistics_worker` 보유자가 0명이면 임시 계정에 role 을 붙여
   확인하고 되돌린다.)

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
  `admin` 유저에게는 `master`+`admin` 만 붙인다(`user-service.seed-step.ts:330`). role *부여*
  는 이 PR 밖이다 — 다만 role *보유자 실측*은 §마이그레이션·배포의 **배포 선행조건**이다.
  부착이 `AdminRealmGuard` 의 바닥을 걷어내므로 보유자가 있으면 배포 순간 실제로 열린다.
- **`inventory.manage` 안의 매입·거래처 분리.** 지금 `logistics_manager` 는 이 스코프 하나로
  발주 승인(`PUT /purchase-orders/:id/approve`)과 거래처 은행계좌(`GET /suppliers[/:id]` 의
  `bankAccountNo`)까지 함께 받는다. **위험도 3분할과 도메인 분할이 서로 다른 답을 내는 유일한
  지점**이다 — 매입은 물류 직무가 아니라 재무 인접 직무이므로 도메인 축에서는 떼는 게 맞다.
  그럼에도 미루는 이유는 (a) 결정 #1 에서 도메인 7분할 대신 위험도 3분할을 **의도적으로**
  골랐고, (b) 오늘 `logistics_manager` 를 받아들이는 admin-web 화면이 하나도 없어 이 부여가
  **잠재적**이기 때문이다. 매입 직무를 role 로 실제 분리하게 되면 그때
  `inventory.purchasing` 을 떼는 것이 후속이다.
- **`scope-guard-binding.spec.ts` 의 파일명 판정.** 이 core 전역 스펙은 아직 컨트롤러를
  `.controllers?.ts` 이름 패턴으로 고른다 — #551 을 만든 것과 **같은 계열의 사각지대**다.
  게다가 실패 방향이 위험한 쪽이다: 패턴에 안 맞는 파일명 안에 `@RequireScopes` 만 있고
  `ScopeGuard` 바인딩이 없으면, 그 라우트는 `AdminRealmGuard` 의 바닥은 걷어내면서 스코프는
  아무것도 검사하지 않는 상태가 되는데 이 스펙이 그걸 못 잡는다.
  (`inventory-scope-coverage.spec.ts` 는 이번에 `@Controller` 판정으로 바꿨다.) core 전역
  파일이라 이 PR 범위 밖이다.
