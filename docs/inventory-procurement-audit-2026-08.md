# core 발주(Purchase Order) 도메인 진단 (2026-08-25)

> 출처: 2026-08-25 `apps/core` 발주 관련 코드 전수 읽기.
> **이 문서는 "사실"만 담는다 — 진행 상태는 담지 않는다.** 상태의 정본(SoT)은 엄브렐러 이슈 **#724** 다.
> 계획서는 착수 직전에 `docs/superpowers/plans/` 에 항목별로 따로 쓴다.
>
> 범위: **core 백엔드만.** admin-web 은 이번 감사 범위 밖이나, 프론트 증상 2건의
> 근본 원인이 core 에 있어 §2-⑤ 에 함께 적는다.

## 0. 한 줄 요약

발주는 `inventory/inbound` 하위에 얹혀 있는 **997줄 God service** 하나가 사실상 전부다.
심사(audit) 워크플로가 있으나 **권한 분리·행위자 기록·승인 후 잠금 셋 다 없어 장식**이고,
입고예정일 자동 확정 크론은 **drizzle raw sql 의 `Date` 바인딩 함정으로 매일 밤 조용히
예외를 삼키고 있다(로컬 DB 실측 확인)**. 발주와 입고는 코드상 이미 남남이라 모듈 분리
비용은 낮지만, 선을 긋기 전에 `inbound_plans` 의 **writer 이원화**를 먼저 없애야 한다.

---

## 1. 현재 구조 (사실 지도)

### 1.1 파일 배치

```
apps/core/src/modules/inventory/
├── inbound/                                    총 3,978줄 (spec 제외)
│   ├── controllers/purchase-order.controller.ts    338줄  @Controller('purchase-orders')
│   ├── controllers/inbound.controllers.ts          302줄  @Controller('inbound')
│   ├── services/purchase-order.service.ts          997줄  ← 발주 전부
│   ├── services/purchase-order-cron.service.ts      76줄  자동 확정 크론
│   ├── services/inbound.service.ts               1,142줄  입고예정 + 실입고
│   ├── services/inbound-putaway.reader.ts
│   └── dto/purchase-order.dto.ts (200줄), dto/purchase-order/audit-po.dto.ts
├── suppliers/                                  총 1,176줄  공급처 (발주의 전제)
├── warehouse-transfer/                         총   726줄  해외 발주 뒷구간
└── stock-projection/services/inbound-pipeline.reader.ts   발주 잔량 가시화
```

### 1.2 데이터 모델

`apps/core/src/modules/inventory/schema/inventory.schema.ts`

| 테이블 | 줄 | 비고 |
|---|---|---|
| `purchase_orders` | 1860 | 헤더. 창고 3종 + 상태 2축 |
| `purchase_order_lines` | 1888 | **PK = (po_id, sku_id)** — 같은 SKU 두 줄 불가, 라인 id 없음 |
| `purchase_order_cart` | 1909 | 발주대기리스트. `created_by` 로 **사용자별 격리**. 유니크 제약 없음 |
| `inbound_plans` | 2023 | `linked_purchase_order_id` **NOT NULL** — 발주 없는 입고 계획은 불가 |
| `inbound_plan_items` | 2061 | `expected_qty` / `received_qty` |

`purchase_orders` 핵심 컬럼:

- **창고 3종**: `source_warehouse_id`(공급처가 직접 넣는 창고), `destination_warehouse_id`(최종 목적지), `requires_transfer`(둘이 다르면 true)
- **상태 2축(독립)**: `status` = `created` / `confirmed` / `received`, `audit_status` = `draft` / `pending_audit` / `approved` / `rejected`
- **감사 흔적**: `submitted_for_audit_at/by`, `audited_at/by`, `audit_notes`

enum 정의는 schema.ts:99–116.

### 1.3 생명주기

```
생성        status=created,  audit_status=draft
  ↓ PUT /:id/submit-for-audit
            audit_status=pending_audit
  ↓ PUT /:id/approve                      ↓ PUT /:id/reject
            audit_status=approved                audit_status=draft (+ auditNotes="REJECTED: …")
  ↓ PUT /:id/status {confirmed}   ← 유일한 두 축 교차 게이트 (service:150)
            status=confirmed  ⇒ inbound_plans + inbound_plan_items 자동 생성
  ↓ POST /inbound/plans/receive (반복)
            inbound_plan_items.received_qty 누적, 다 차면 item.status='confirmed'
```

- `rejected` enum 값은 **실제로 쓰이지 않는다** — 거부는 `draft` 로 되돌린다(service:945).
- `status='received'` 로 보내는 코드는 **저장소 전체에 없다**. 수동 API 호출만이 유일한 경로.

### 1.4 발주 → 입고 분기

`createInboundPlanFromPO` (purchase-order.service.ts:276)

- **국내** (`requiresTransfer=false`): `planType='destination'` 계획 1개를 목적지 창고에
- **해외** (`requiresTransfer=true`): `planType='source'` 계획 **1개만** 출발 창고에.
  출발→목적지 구간은 `transfer_orders` 가 소유

"해외는 하나만" 은 과거 버그 수정 결과이고
`inbound/services/purchase-order-single-plan.integration.spec.ts` 가 고정한다.
예전엔 source/destination 두 계획을 만들면서 둘 다 `destination_warehouse_id` 를 채워
**입고예정 2배 + destination plan 수령이 무조건 `RECEIVE` 라 이중계상**이 났다.

소스 창고는 DTO 가 아니라 **`suppliers.default_warehouse_id`** 가 정한다
(`getSupplierDefaultWarehouseId`, service:370). 비어 있으면 발주 생성이 한국어 안내와 함께 400.

### 1.5 API 표면

전부 `@RequireScopes(INVENTORY_SCOPE.MANAGE)` — `admin` / `logistics_manager` 만.

| 그룹 | 라우트 |
|---|---|
| 발주 | `POST /purchase-orders`, `POST /from-cart`, `GET /`, `GET /:id`, `PUT /:id/status`, `PUT /:id/lines` |
| 심사 | `PUT /:id/submit-for-audit`, `PUT /:id/approve`, `PUT /:id/reject` |
| 카트 | `POST\|GET\|DELETE /cart`, `PUT\|DELETE /cart/:itemId` |
| 제안 | `GET /suggestions/reorder` |

### 1.6 결합도 실측 (모듈 분리 비용)

| 항목 | 실측 |
|---|---|
| `InboundModule` 을 import 하는 외부 모듈 | **0** (`InventoryModule` 뿐) |
| `PurchaseOrderService` 를 주입하는 외부 클래스 | **0** (export 돼 있으나 미사용) |
| `PurchaseOrderService` → `InboundService` 참조 | 없음 |
| `InboundService` → `PurchaseOrderService` 참조 | 없음 |
| 실제 연결 | `purchase_orders` / `inbound_plans` **테이블 직접 쓰기**뿐 |

재현: `grep -rn "InboundModule\|PurchaseOrderService" apps/core/src --include=*.ts | grep -v "modules/inventory/inbound/"`

### 1.7 계층 규약 준수 현황 (inventory 내부)

| 모듈 | service/manager/reader | `@app/shared` 도메인 예외 |
|---|---|---|
| warehouse, warehouse-transfer, sku-catalog, sku-group, stock-projection | ✅ | ✅ |
| **inbound, suppliers, stocktaking, movement** | ❌ service 단일 | ❌ Nest `NotFoundException` 직접 |

`PurchaseOrderService` 는 컨트롤러가 직접 부르는 God service 로, 검증·비즈니스로직·SQL 을
한 클래스에서 처리한다. CLAUDE.md 의 `Controller → Service → Reader/Manager → Repository`
와 도메인 예외 규약 **양쪽 다** 어긋난다. 선례로 삼을 모듈은 `warehouse-transfer`.

---

## 2. 발견 사항

각 항목: **증상 → 근거(파일:줄) → 확인 방법/여부 → 영향**.

### 🔴 ① 자동 확정 크론 — 매일 밤 죽고 있고, 살아나도 축이 틀렸다

**근거**: `inbound/services/purchase-order-cron.service.ts:47`

```ts
sql`DATE(${wmsTables.purchaseOrders.expectedArrival}) = ${todayDateOnly}`
//                                                      ^^^^^^^^^^^^^ JS Date
```

raw `sql` 템플릿에 JS `Date` 를 바인딩하는 형태. drizzle 의 postgres-js 드라이버가 날짜
OID(1082/1083/1114/1184)의 직렬화기를 pass-through 로 교체하는데, raw `sql` 조각에는
컬럼 타입 정보가 없어 `Date` 객체가 그대로 postgres.js `Bind` 에 도달한다.

**확인**: 2026-08-25 로컬 `core` DB(5432 compose)로 재현.

```
RAW-DATE-BIND: THREW -> Failed query: SELECT 1 AS hit WHERE DATE(NOW()) = $1
  cause: TypeError | The "string" argument must be of type string or an
         instance of Buffer or ArrayBuffer. Received an instance of Date
STRING-BIND:   OK, rows = 1
```

**영향**: 예외가 `catch` 로 삼켜져 `Auto-confirm job failed:` 로그만 남는다
(cron.service.ts:70). **입고예정일 자동 확정이 한 번도 동작한 적 없을 가능성이 높다.**
라이브 확인법 — CloudWatch Insights 로 core 로그에서 `Auto-confirm job failed` 를 검색
(⚠️ Insights `@timestamp` 는 UTC 다).

**참고**: 같은 함정의 미수정 사례가 `apps/notification/src/shared/services/metrics.service.ts:54`
에도 있다(이번 범위 밖).

#### 같은 한 줄에 있던 두 번째 결함 — 프로세스 TZ 의존 (수정 과정에서 발견)

```ts
const today = nowSeoul();                                             // KST 달력 필드
const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
```

`new Date(y, m, d)` 는 **프로세스 로컬 TZ** 로 순간을 만든다. 그래서 이 값을 어떻게
직렬화하든 결과가 서버 TZ 를 탄다. 바인딩만 문자열로 바꾸는 최소 수정이었다면 이 결함이
그대로 남았을 것이다.

| 프로세스 TZ | `todayDateOnly` 의 UTC 순간 | 날짜 |
|---|---|---|
| UTC (배포 컨테이너 — `TZ` 미설정, `node:22-alpine`) | KST 날짜 00:00Z | 맞음 |
| Asia/Seoul (개발 머신 실측) | 전날 15:00Z | **하루 어긋남** |

빨간 테스트가 실제로 찍어낸 바인딩 값이 이 둘을 한꺼번에 보여준다:

```
params: created,approved,Tue Aug 25 2026 00:00:00 GMT+0900 (한국 표준시)
                         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ Date 객체 원본 + KST 자정
```

**남은 사실**: `audit_status` 기본값은 `'draft'` 이고 크론은 `'approved'` 만 고른다. 발견 ②
때문에 심사 워크플로가 사실상 돌지 않으므로, **크래시를 없애도 승인된 발주가 없으면 크론은
계속 0건을 고른다.** 자동 확정이 실제로 발주를 움직이려면 항목 3(D1) 이 먼저 정해져야 한다.

#### 더 큰 사실 — 크래시가 아니라 트리거 축이 틀렸다 (2026-08-25 설계 검토)

크래시를 고치면 도착예정일 0시에 발주 헤더가 통째로 `confirmed` 가 되고 입고 계획이 생긴다.
그 동작 자체가 운영과 맞지 않는다. 근거는 셋 다 코드에 있다.

**(1) `confirmed` 가 곧 가시성의 스위치다.** `stock_summary_view.on_order_qty` 는 하드코딩
`0` 이다(`inventory.schema.ts:1123`, 라이브 뷰 정의로도 확인). 계획을 만드는 것은
`createInboundPlanFromPO` 뿐이고 그건 확정 시점에만 돈다. 즉 **`created` 상태 발주는 어느
화면에도 존재하지 않는다.**

**(2) 그 가시성을 소비하는 리더가 확정된 발주만 본다.** `InboundPipelineReader`
(`GET /stocks/inbound-pipeline`)의 ①발주 잔량은 `inbound_plan_items` 의 pending 에서 나온다
(`inbound-pipeline.reader.ts:69~`). 그 파일 주석이 이 API 의 존재 이유를 *"②를 빼면 재고 0,
입고예정 0 으로 보여 **중복 발주가 난다**"* 라고 적어 두었는데, 같은 논증이 ①에 더 강하게
적용된다. 크론은 주문~도착 구간(중국 해상 운송이면 수 주~수 개월) 전체를 사각지대로 만든다.

**(3) `expected_arrival` 은 nullable 인데 크론 조건은 날짜 일치다.** 도착예정일을 모르는
발주는 **영원히 자동 확정되지 않는다 = 영원히 안 보인다.** 반면 파이프라인 리더는 이미
*"예정일이 없는 단계는 숨기지 않고 null 로 낸다 — 숨기면 그 구간이 다시 사각지대가 된다"*
로 이 경우를 감당한다. 데이터 모델이 "모른다"에 더 준비돼 있다.

**덤**: 중국 창고 도착일은 업무상 이정표가 아니다. 중국은 비판매 창고라 도착해도 팔 수 있게
되지 않는다 — 판매 가능 시점은 부천 도착이다. 도착일은 파이프라인 ①이 ②로 바뀌는 순간일 뿐인데
크론은 하필 그 순간을 상태 전이 트리거로 삼는다.

**그리고 크론은 능력을 주지도 않는다.** `PUT /:id/status` 와 admin-web 상세 드로어 버튼이
이미 있다. 크론은 새 기능이 아니라 **타이밍 정책**이고, 그 정책이 위 이유로 틀렸다.

**"오늘 입고 작업 목록"이 필요했던 것이라면 그건 조회다** — `inbound_plans WHERE
expected_date = 오늘`. 그걸 얻자고 발주 상태를 바꿀 이유가 없다.

**또 하나의 미강제 전제**: 읽기 쪽을 어떻게 고치든, `DATE(expected_arrival)` 가 사용자가 고른
달력 날짜와 같다는 보장은 없다. `CreatePurchaseOrderDto.expectedArrival` 이 `@IsDateString()`
이라 `'2026-08-26T00:00:00+09:00'` 이나 오프셋 없는 `'2026-08-26T00:00:00'` 도 통과하는데
(실측), 전자는 `new Date(...).toISOString()` 이 `'2026-08-25T15:00:00.000Z'` 라 naive
`timestamp` 컬럼에 `'2026-08-25 15:00'` 으로 저장된다 — **하루 앞 날짜로 잡힌다.** 후자는
서버 TZ 에 따라 갈린다. admin-web 은 `<input type="date">` 라 `'YYYY-MM-DD'` 만 보내므로
현재 UI 경로로는 안 나지만, API 계약이 막고 있지는 않다.

### 🔴 ② 심사 워크플로가 장식이다 — 세 겹으로 무력화

1. **권한 분리 없음.** `submit-for-audit` / `approve` / `reject` 가 생성과 **동일한
   `INVENTORY_SCOPE.MANAGE`** (controller:246/276/306). 발주 작성자가 자기 발주를 승인할 수 있다.
2. **행위자 미기록.** 컨트롤러가 `submitForAudit(id, dto)` 로 호출(controller:272/302/336)하는데
   서비스 시그니처는 `(poId, dto, userId?, tx?)` (service:839/891/945). `@User()` 를 안 넘겨
   `submitted_for_audit_by` / `audited_by` 가 **영구 NULL**.
3. **승인 후 잠금 없음.** `PUT /:id/lines` 는 `received` 만 막는다(service:213). 승인받은
   발주의 수량·단가를 `confirmed` 상태에서 전부 교체해도 재승인이 필요 없다.

**영향**: `status='confirmed'` 전환 시의 승인 게이트(service:161)가 통째로 무의미하다.

### 🟠 ③ `inbound_plans` writer 가 둘, 불변식은 한쪽만 지킨다

| writer | 위치 | 불변식 |
|---|---|---|
| 자동 | `createInboundPlanFromPO` (purchase-order.service.ts:276) | 해외 = source 1개 (spec 으로 고정) |
| 수동 | `createInboundPlan` (inbound.service.ts:639), `POST /inbound/plans` | **호출자가 `planType`/`requiresTransfer`/`destinationWarehouseId` 를 그냥 넘김** |

**영향**: 수동 API 로 해외 PO 에 `planType='destination'` 계획을 붙이면
`purchase-order-single-plan.integration.spec.ts` 가 막으려던 **입고예정 2배 + 이중계상**이
그대로 재현된다. 스펙은 자동 경로만 지킨다.

**덤**: `createInboundPlan` 은 PO 미존재에 `throw new Error(...)` (inbound.service.ts:651)
→ 404 가 아니라 **500**.

**설계상 중요**: `InboundService.createInboundPlan()` + `addInboundPlanItems()` 는 이미
`linkedPurchaseOrderId` / `planType` / `requiresTransfer` 를 받는 **완성된 포트**다.
`createInboundPlanFromPO` 는 이를 재구현한 두 번째 writer다. 하나로 합치면 발주→입고
방향이 테이블 결합에서 서비스 포트 결합으로 바뀌고, 모듈 분리가 기계적 작업이 된다.

### 🟠 ④ `syncInboundPlanItems` 가 이중계상을 만든다

**근거**: `purchase-order.service.ts:245` — `pending` 항목만 삭제하고 **새 라인 전체**를 재삽입.

```
A(전량 입고완료 status=confirmed) + B(pending) 상태에서 라인 수정
→ B 만 삭제, A·B 둘 다 재삽입
→ A 가 pending 으로 한 벌 더 생김 = 이미 받은 수량을 또 받게 됨
```

**영향**: `confirmed` 상태 PO 의 라인을 고칠 때마다 발생.

### 🟠 ⑤ 응답 계약이 `interface` 라 스키마가 없다

**근거**: `PurchaseOrderResponse` 는 DTO 클래스가 아니라 bare interface
(`dto/purchase-order.dto.ts:154`). 컨트롤러는 `type: 'object'` / `type: [Object]` 로 때운다
(controller:53, 188) — CLAUDE.md 가 금지한 형태.

**파생 결과**:
- Swagger 에 스키마가 실리지 않음
- **`auditStatus` 가 응답에 아예 없음** (service:433~ 객체 리터럴 조립 시 누락)
- 프론트 타입을 손으로 유지 → 드리프트

**admin-web 증상 2건 (범위 밖이나 원인이 여기)**:
- `GET /purchase-orders` 는 **배열**을 반환하는데 프론트는 `data?.data` / `data?.total` 로 읽는다
  (`apps/admin-web/src/features/inventory/purchase-orders/components/table/index.tsx:27`)
  → **발주 목록이 항상 빈 테이블**. `inbound/plan-create-tab` 의 PO 드롭다운도 동일.
- `audit-action-bar` 가 `po.auditStatus` 로 버튼을 분기(:56) → 항상 `undefined` → **심사 버튼 미표시**.

**즉 프론트를 고치는 게 아니라 core 에서 응답 DTO 클래스를 만드는 것이 올바른 수선이다.**

### 🟡 ⑥ 재주문 제안이 상수이고, 안전재고가 두 벌이다

- `getReorderSuggestions` (service:786) 는 안전재고 **10**, 제안수량 **20 − 현재고** 를 SQL 에 하드코딩.
- 별도로 `skus.safety_stock` 컬럼과 `core/services/safety-stock.service.ts` 가 존재하고
  `GET /inventory/below-safety-stock` 이 그쪽을 쓴다. **같은 질문에 답이 둘.**
- 반환하는 `onOrderQty` 는 **항상 0** — `stock_summary_view` 가 `0 as on_order_qty` 로
  하드코딩(schema:1123).

**영향**: **이미 발주한 물량을 모르는 채로 재발주를 권한다.**

실제로 발주 잔량을 계산하는 건 `stock-projection/services/inbound-pipeline.reader.ts` 다
(①발주 잔량 ②이동 대기 ③이동 중 3단계). 이 API 는 그걸 쓰지 않는다.
알려진 한계는 파일 상단 주석 참조 — ①②가 비판매 창고 전체 합이라 판매 창고가 둘 이상이면 중복 표시.

### 🟡 ⑦ 종결 상태가 없다

- `status='received'` 로 보내는 코드 **없음**. 전량 입고돼도 `confirmed` 에 머문다.
- `inbound_plans.status` 는 생성 후 **어디서도 update 하지 않는다**. `applied`/`receiving`/
  `confirmed` 는 계획 헤더에선 죽은 값이고 항목만 움직인다 →
  `GET /inbound/pending` 이 완결된 계획을 계속 들고 있다.
- **취소가 없다.** `po_status` 에 `cancelled` 없음. 잘못 만든 발주를 닫을 방법이 없고,
  라인을 0개로 바꾸는 것도 불가(빈 배열 insert → 에러).
- `audit_status='rejected'` 는 enum 에만 존재.

### 🟡 ⑧ 발주 쓰기에 멱등성이 없다

`InventoryIdempotencyService` 사용처: `inbound.service.ts`, `movement.service.ts`,
`warehouse-transfer.manager.ts`. **`purchase-order.service.ts` 는 미사용.**
네트워크 재시도 한 번에 발주가 둘 생긴다.

### 🟡 ⑨ 해외 발주인데 통화가 없다 — 기능 부재

- `unit_price` 는 `integer` 하나뿐. **`inventory.schema.ts` 전체에 `currency` 문자열 0건.**
- 환율·통화·총액·부가세 없음. `suppliers.payment_method`(선불/후불/월정산)는 있으나 PO 와 미연결.
- `from-cart` 경로는 `unitPrice: null` 로 고정 삽입(service:131).
- **발주를 공급처에 전달하는 수단이 없다** — 발주서 출력·메일 발송·export 전무. 순수 사내 메모.

**이것은 리팩터링 대상이 아니라 "없는 기능"이다.** 별도 제품 결정 필요.

### ⚪ ⑩ 잔가지

| 항목 | 근거 |
|---|---|
| **죽은 코드**: `TransactionService` 를 `PurchaseOrderService` 가 주입만 하고 미호출 | service:30. ADR-0025 가 금지한 per-class tx 헬퍼의 잔재 |
| **죽은 코드**: `AuditService`(339줄) 호출자 0곳 | `shared/services/audit.service.ts`. `SharedModule` 등록만 돼 있음 |
| **N+1**: 발주 1건당 라인 1쿼리 + 공급처 1쿼리 | service:487~. limit 50 이면 최대 101 쿼리 |
| **중복 SKU → 500**: create/update 가 dedupe 안 함 | `purchase_order_lines` PK=(po_id, sku_id) 위반이 그대로 전파. 400 이어야 함 |
| **카트 유니크 제약 없음**: select→update/insert 합산이 동시요청에 중복 행 생성 | schema:1909 에 index 인자 자체가 없음. `addToCart` service:547 |
| **카트가 개인 전용**: `created_by` 필터로 타인 카트 미열람 | service:657. 팀 단위 발주 준비 불가 — **의도 확인 필요** |
| **스테일 주석**: "이동 지시서 초안 자동 생성의 조건이기도 하다" | service:304. **그런 코드 없음** — `transfer_orders` 는 PO/plan 을 참조하지 않고 `warehouse-transfer.manager.ts:63` 컨트롤러 경로로만 생성 |
| **도메인 이벤트 0건**: 발주 생성/승인/확정이 Kafka 로 안 나감 | analytics·정산이 발주를 볼 수 없음 |

### 🟠 ⑪ `isSameSeoulDay(nowSeoul(), …)` 이중 변환 — 저녁 입고 취소가 막힌다

**발견 경위**: ① 수정 중 `time.util` 사용처를 훑다가. **①과 별개 버그다.**

**근거**: `apps/core/src/modules/inventory/inbound/services/inbound.service.ts:997`

```ts
if (!isSameSeoulDay(nowSeoul(), receiptRow.occurredAt)) {
  throw new BadRequestException('cancel is allowed only on the same day (Asia/Seoul)');
}
```

`isSameSeoulDay(a, b)` 는 내부에서 두 인자를 각각 `toSeoulTime` 한다. 첫 인자에 이미
변환된 `nowSeoul()` 을 넣으면 **+9h 가 두 번** 적용돼 "지금"이 9시간 미래로 밀린다.

**확인** (2026-08-25, `TZ=UTC` 로 재현):

```
실제 KST now       : 2026-08-25 20:00
실제 KST occurredAt: 2026-08-25 11:00   ← 같은 날
현재 코드  isSameSeoulDay(nowSeoul(), occurredAt) = false   ← 취소 거부
올바른 형태 isSameSeoulDay(new Date(), occurredAt) = true
```

**영향**: KST **15:00–24:00** 구간에 접수된 취소 요청이 같은 날 입고분인데도 전부
`400 cancel is allowed only on the same day` 로 거부된다. 하루의 3/8 이고, 창고 저녁
근무 시간대와 정확히 겹친다. 반대 방향 오류(전날 것을 허용)는 없다.

**고치는 법**: 첫 인자를 `new Date()` 로. 한 줄이지만 입고 취소 경로라 별도 테스트가
필요하고 ①과 위험이 다르므로 묶지 않았다.

---

## 3. 권고 — 작업 순서와 근거

| # | 항목 | 다루는 발견 | 선행 | 마이그 |
|---|---|---|---|---|
| 1 | 크론 자동 확정 **제거** | ① | — | 0 |
| 2 | 발주 응답 계약 DTO화 (`auditStatus` 포함) | ⑤ | — | 0 |
| 3 | 심사 워크플로 — 살리기 또는 제거 | ② | **⚠️ 제품 결정** | 미정 |
| 4 | `inbound_plans` writer 단일화 | ③ ④ | — | 0 |
| 5 | `procurement/` 모듈 분리 + 계층·예외 정렬 | §1.6 §1.7 | **4** | 0 |
| 6 | 재주문 제안 정리 | ⑥ | — | 0 |
| 7 | 종결·취소 상태 | ⑦ | — | **있음** |
| 8 | 잔가지 묶음 | ⑧ ⑩ | — | 소 |
| 9 | `isSameSeoulDay` 이중 변환 수정 | ⑪ | — | 0 |

### 3.1 모듈 분리안 (항목 5)

선을 **"발주 vs 입고"가 아니라 "조달 문서 vs 입고 실행"** 으로 긋는다.

```
inventory/
├── procurement/          ← 신설
│   ├── purchase-order/       PO + 심사 + 카트
│   └── suppliers/            (현 위치에서 이동)
└── inbound/              ← 실행만 남음
        입고예정 계획 · 실입고 · 적치 · 회송 · 취소 · 회차/작업로그
```

근거:

- **스코프가 이미 100% 갈려 있다.** 발주 라우트는 전부 `MANAGE`(MD·구매), 입고 라우트는
  전부 `OPERATE`(현장). 한 모듈 안에서 스코프가 깔끔히 둘로 나뉜다는 건 경계가 거기 있다는 뜻.
- **성질이 다르다.** 발주 = 사무 문서 워크플로(초안·심사·승인), 입고 = 원장 작업(멱등키·stock
  event·outbox). ⑧(발주 멱등성 부재)도 이 성질 차이를 반영 못 한 결과.
- **공급처가 발주 쪽에 붙는 게 맞다.** `suppliers` 실사용처는 발주(`default_warehouse_id` 가
  source 창고를 결정)와 catalog export 둘뿐. 발주 없이는 의미가 없는 마스터.

**⚠️ 순서를 지킬 것.** 4번(writer 단일화) 없이 5번만 하면 `createInboundPlanFromPO` 가
**남의 모듈 테이블을 직접 쓰는** 형태로 남아 지금보다 나빠진다. 결합을 옮기기만 하고 줄이지 못한다.

이 분리는 아키텍처 결정이므로 **ADR-0032** 가 따라붙는다 (0031이 최신, 0032 비어 있음 —
이 저장소는 ADR 번호 충돌 전력이 있어 착수 시 재확인할 것).

---

## 4. 열린 결정 (사람이 정해야 함)

| # | 결정 | 갈래 | 차단하는 항목 |
|---|---|---|---|
| D1 | 심사 워크플로를 살릴 것인가 | **(a) 살린다** — 승인 전용 스코프 신설(`inventory.purchase.approve`) + `@User()` 배선 + 승인 후 라인 잠금. 롤 재편 수반<br>**(b) 없앤다** — `audit_status` 축 제거. 선례: #663 승인 워크플로 제거 | 3 |
| D2 | 통화·발주서 전달(⑨)이 범위인가 | 리팩터링이 아니라 신규 기능. 범위 밖 권장 | — |
| D3 | 카트 개인 전용(⑩)이 의도인가 | 의도면 유지, 아니면 팀 단위로 전환 | 8 |

D1 은 3번 차례에 정하면 된다. **1·2·4·5는 D1 과 무관하게 진행 가능하다.**

---

## 5. 재확인 레시피

이 문서의 주장을 다시 검증할 때 쓰는 명령들.

```bash
# 결합도 (§1.6)
grep -rn "InboundModule\|PurchaseOrderService" apps/core/src --include=*.ts \
  | grep -v "modules/inventory/inbound/"

# 죽은 코드 (⑩)
grep -rn "AuditService\|TransactionService" apps/core/src --include=*.ts | grep -v spec

# on_order_qty 하드코딩 (⑥)
grep -n "0 as on_order_qty" apps/core/src/modules/inventory/schema/inventory.schema.ts

# PO status='received' 로 보내는 코드가 있는가 (⑦) — 없어야 정상(=현 상태)
grep -rn "PurchaseOrderStatus.RECEIVED" apps/core/src --include=*.ts | grep -v spec

# 검증 게이트 (둘 다 0 이 기준선)
npm run type-check
npx jest --maxWorkers=2

# 발주 관련 통합 스펙 (실 DB 필요)
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- purchase-order
```

**⚠️ 통합 스펙 주의**: 워크트리에서 돌릴 때 `COMPOSE_PROJECT_NAME=almondyoung-server` 를
빼면 5432 포트 충돌로 죽는다. 또 워크트리 이름에 `+` 가 들어가면 jest 의 정규식 무시 패턴이
조용히 안 걸려 `apps/medusa` spec 이 딸려 들어온다.
