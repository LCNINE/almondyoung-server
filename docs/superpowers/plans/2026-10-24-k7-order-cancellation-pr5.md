# K7 PR 5 — 직배송 파트너 통지 대기함: 넘긴 직배 주문의 취소가 «업체에 알릴 일» 한 줄을 남긴다 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 업체에 넘긴(`forwarded`) 직배송 출고지시가 걸린 취소가 커밋되면, 같은 트랜잭션에 «업체 ○○에 이 취소(주문·라인·수량)를 알려야 함» 행이 생긴다(D5). admin-web 직배송 화면에 업체별 「알릴 취소」 탭을 두고, 운영자가 CSV 로 내려받거나 보고 알린 뒤 «알림 완료»를 누른다. 오래 안 알린 건은 눈에 띈다(스펙 §5.6).

**Architecture:** 행은 출고 모듈이 쓴다. 상자 전 취소의 FO·FOI 쓰기를 이미 혼자 하는 `UnboxedDemandCancellation` 이 `reduce`·`cancelOrder` 안에서, 줄인 FOI 가 «넘긴 직배 FO» 소속이면 새 테이블 `direct_ship_cancel_notices` 에 한 줄씩 넣는다. 두 메서드는 취소 id 를 **필수 인자**로 받는다 — 판매주문 쪽은 직배를 몰라도 빠뜨릴 수 없다. 대기함 읽기·내려받기·알림 완료는 직배 컨트롤러 밑의 새 Service → Reader/Manager 가 한다. 통지는 한 방향이라 «알림 완료» 뒤 상태는 없다.

**Tech Stack:** NestJS(core), Drizzle(+ expand 마이그 1개), Jest(unit + `describeIfDb` 통합 — 스크래치 DB `k6_it`), Next.js(admin-web, 순수함수 spec).

**Spec:** `docs/superpowers/specs/2026-10-24-k7-order-cancellation-design.md` (§4.3·§5.6·§5.9·§6 D5·§7-5·§9). PR 1~4 결정은 `docs/adr/0049-order-cancellation-one-kernel-owns-the-sequence.md`.

## 계획을 정한 사실 (2026-10-24 develop `fe6097da3`)

- **넘긴 직배 FO 는 상자 전 취소 갈래로만 온다.** 직배 FO 는 `ready` 로 생기고 넘기기(`forwardOrdersToCompany`, `direct-ship.service.ts:268`)는 `directShipStatus`·`allocatedAt`·`ownerId` 만 바꾼다 — FO `status` 는 `ready` 그대로라 `CANCELLABLE_FULFILLMENT_STATUSES`(`unboxed-demand-cancellation.ts:14`)에 든다. 한 판매주문에 직배와 창고 SKU 가 섞이면 FO 생성이 거절하므로(`fulfillments.service.ts:194` `V2_MIXED_DIRECT_AND_WAREHOUSE_FULFILLMENT`) 직배 주문엔 상자가 없고 상자 후 갈래(`cancelAfterBoxing`)에 닿지 않는다.
- **상자 전 쓰기는 `UnboxedDemandCancellation` 하나다**(호출자 가드 `unboxed-demand-callers.guard.spec.ts` = `sales-orders.service.ts` 만). 전체 = `cancelOrder`(`sales-orders.service.ts:1286`), 부분 = `reduce`(`:2289`, 채널 수량 감소도 여기로 온다).
- **취소 id 는 효과를 다 모은 뒤 생긴다** — `recordSalesOrderCancellation(trx, values, …)`(`cancellation-record/record-cancellation.ts:57`)가 `values` 를 그대로 insert 하고 `id` 는 `defaultRandom()`. 효과 목록(FO 취소 결과가 든다)이 그 행의 칸이라 명령을 부를 때 id 가 아직 없다.
- **업체 = `fulfillment_orders.owner_id`(→ `holders`).** 넘길 때 반드시 채워진다(`direct-ship.service.ts:301`). 업체에 넘기는 엑셀(`generateCSVContent`, `:390`)의 열은 `판매주문ID·주문라인ID·상품명·수량·공급사SKU` — 고객 정보는 없다.
- **넘긴 FO 가 전량 취소돼도 `directShipStatus` 는 `forwarded` 로 남는다**(FO `status` 만 투영으로 `canceled`). 이번 PR 은 그 값을 바꾸지 않는다(아래 «범위 밖»).
- admin-web 직배 화면은 `features/order/direct-ship/template/index.tsx` 의 탭 둘(대시보드·주문 목록). 클라이언트 `lib/api/domains/orders/direct-ship.client.ts`, 훅 `lib/services/orders/mutations.ts:385~417`, 쿼리키 `query-keys.ts:83~90`. 화면 권한 `'/order/direct-ship': any('fulfillment.order.read')`.

## 이름 붙은 결정 (⛔ 사용자 확인)

- **N23. 새 테이블 `direct_ship_cancel_notices` — expand 마이그 1개(`migrate → deploy`).** 스펙 §8 이 빌더에게 맡긴 저장 위치. `business_links` 는 append-only 라 «알림 완료»를 닫는 링크로 써야 하고(PR4 환불 링크의 `completedRefundLinkId` 꼴), 업체별 미통지 목록이 매번 반-조인이 된다. 대기함은 바뀌는 상태(`notified_at`) 하나를 가진 작업 큐라 테이블이 맞다.
- **N24. 취소 id 를 미리 만든다.** 판매주문 상자 전 두 갈래가 `randomUUID()` 로 id 를 먼저 정해 명령에 넘기고 `recordSalesOrderCancellation` 의 `values.id` 로 쓴다. `order_cancellation_id` 에는 **FK 를 걸지 않는다** — 대기 행이 취소 행보다 먼저 들어간다(같은 트랜잭션이라 함께 커밋·롤백된다). 대안(명령이 결과만 돌려주고 판매주문이 취소 행 뒤에 «통지 기록»을 따로 부름)은 부르기를 잊는 길이 열리고, 판매주문이 «넘긴 직배»라는 출고 사정을 알게 된다.
- **N25. 행 하나 = 취소 하나 × FOI 하나, 수량 = 이번 취소로 줄인 수량.** 부분 취소는 `ReducedDemandItem.qty`, 전체 취소는 `새 canceledQty − 옛 canceledQty`(0 이면 행 없음). `UNIQUE (order_cancellation_id, fulfillment_order_item_id)`.
- **N26. «오래됨» = 미통지 24시간 이상.** 행 강조만, 숫자는 화면 상수 하나(`CANCEL_NOTICE_OVERDUE_HOURS = 24`).
- **N27. 대기함·내려받기에 고객 정보를 싣지 않는다.** 넘길 때 엑셀과 같은 키(판매주문ID·주문라인ID)로 업체가 찾는다. 그래서 새 라우트 셋에 `@PiiResponse` 가 없다.
- **N28. «알림 완료»는 고른 행 단위, 되돌리기 없음.** 이미 완료된 행은 건너뛴다(멱등). 다른 업체 행이나 없는 id 가 섞이면 400 — 화면은 한 업체씩 보여 준다.
- **N29. 넘긴 직배 FO 에 `owner_id` 가 비어 있으면 명령이 던진다(500, 취소 롤백).** 넘기기가 늘 채우는 불변식이다. 이름 없는 업체에 알릴 길이 없는데 취소만 커밋하면 업체가 영영 모른다 — PR3 N13(상자 전 FO 의 확정 예약 → 던짐)과 같은 fail-closed.

## 동작 변경 (스펙 §6 대조)

| | 변경 | 라이브 영향 |
|---|---|---|
| D5 | 넘긴 직배 FO 를 줄인 취소가 `direct_ship_cancel_notices` 행을 남긴다 | 새 행만 생김. 라이브 넘긴 직배 FO 수는 G1 ① |
| — | 넘긴 직배 FO 의 `owner_id` 가 비면 그 주문 취소가 500(N29) | G1 ② 가 0 이어야 한다 |
| — | 상자 전 취소의 `sales_order_cancellations.id` 를 앱이 정한다(N24) | 0 — 값의 모양(uuid v4) 같음 |

**범위 밖(기존 결함, K3 본편):** 넘긴 직배 FO 가 전량 취소되면 `directShipStatus` 가 `forwarded` 로 남아 «주문 목록»의 넘김 필터에 수량 0 으로 남고, «완료 처리»를 누르면 `ship()` 이 `Cannot ship FO … in terminal status 'canceled'` 409 를 낸다. PR 본문 «알려진 문제»에 적는다.

## Global Constraints

- 대기 행을 쓰는 비-spec 파일은 `unboxed-demand-cancellation.ts`(insert)와 새 `direct-ship-cancel-notice.manager.ts`(`notified_at` update) 둘뿐이다(Task 1·2 가드). 판매주문 모듈은 이 테이블을 쓰지 않는다(`order-cancellation.guard.spec.ts` 의 출고 테이블 목록에 추가).
- 마이그는 `npm run db:generate:core -- --name add-direct-ship-cancel-notices` 로만 만든다. 손으로 고치지 않는다. `schema.ts` + SQL + `drizzle/meta/` 는 한 커밋.
- 새 core 라우트는 `@RequirePermission` — 목록 `fulfillment.order.read`, 내려받기 `order.order.export`, 알림 완료 `fulfillment.order.write`(넘기기·완료와 같은 키). 새 권한 키 없음.
- admin-web 새 뮤테이션 훅은 `.permission` 을 선언하고 화면은 `run={…}`/`canRun(…)` 로 판정한다(`mutation-guard.gate.spec.ts`). 화면 경로는 그대로라 `screen-access.ts` 변경 없음.
- 화면 문구: 탭 `알릴 취소`, 버튼 `CSV 내려받기`·`알림 완료`, 빈 상태 `알릴 취소가 없습니다.`. 정상 상태 설명문은 달지 않는다.
- CSV 열(이 순서, 글자 그대로): `판매주문ID, 주문라인ID, 상품명, 취소수량, 공급사SKU, 취소구분, 취소일시`. 취소구분 `전체`/`부분`, 취소일시는 KST `yyyy-MM-dd HH:mm`(`date-fns-tz` `formatInTimeZone(…, 'Asia/Seoul', …)` — jest 는 UTC 로 뜬다). 파일 이름 `직배취소알림_${companyName}_${yyyyMMddHHmm}.csv`, 셀 따옴표 이스케이프는 `generateCSVContent` 와 같은 꼴, 앞에 BOM.

## Review Focus

- **롤백된 취소는 대기 행을 남기지 않는다** — 명령이 행을 쓴 뒤 같은 tx 의 다음 단계가 던지면 행도 없어야 한다. 행을 `this.dbService.db` 로 쓰면 깨진다. Task 1 명령 통합(savepoint 안에서 던진 뒤 행 0).
- **같은 멱등 키로 다시 온 취소** — 커널 `replayed` 갈래가 명령을 다시 부르지 않으므로 행이 두 벌 생기면 안 된다. Task 1 통합(같은 키로 부분취소 두 번 → 행 1).
- **넘기기 전(`pending`)·직배 아닌 FO** — 행이 생기지 않는다(스펙 §5.6 마지막 줄). Task 1 통합.
- **한 주문의 부분 취소 두 번** — 행이 둘(취소 id 별)이고 수량은 각 취소의 감소분. 누적치를 쓰면 업체가 같은 취소를 두 번 받는다. Task 1 통합.
- **알림 완료 뒤 같은 FOI 에 새 취소** — 새 행이 미통지로 다시 뜬다(옛 완료 행에 덮이지 않는다). Task 2 통합.

---

### Task 1: 넘긴 직배 FO 를 줄인 취소가 대기 행을 남긴다 (D5)

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` (테이블 + `wmsTables`·`wmsSchema` 등록 — `fulfillmentOrders` 바로 뒤)
- Create: `apps/core/drizzle/<timestamp>_add-direct-ship-cancel-notices.sql` + `drizzle/meta/` (generate 산출물)
- Modify: `apps/core/src/modules/fulfillment/unboxed-demand/unboxed-demand-cancellation.ts`
- Modify: `apps/core/src/modules/fulfillment/unboxed-demand/unboxed-demand.types.ts`
- Modify: `apps/core/src/modules/fulfillment/unboxed-demand/unboxed-demand-cancellation.integration.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/order-progress/__support__/order-progress.fixtures.ts` (`seedFo` 에 `ownerId?: string | null` — `dropShip: 'forwarded'` 이고 안 주면 `w.holderId`)
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.service.ts` (`cancelBeforeBoxingFull`·`cancelBeforeBoxingPartial`·`applyUnboxedDemandReductions`)
- Create: `apps/core/src/modules/sales-order/services/sales-orders.drop-ship-cancel-notice.integration.spec.ts` (`SalesOrdersService` 배선은 `sales-orders.cancellation-reads.integration.spec.ts` 를 따른다)
- Modify: `apps/core/src/modules/sales-order/order-cancellation/order-cancellation.guard.spec.ts` (출고 테이블 목록 `T`·raw SQL 목록에 `directShipCancelNotices`/`direct_ship_cancel_notices`)
- Create: `apps/core/src/modules/fulfillment/unboxed-demand/direct-ship-cancel-notice-writers.guard.spec.ts`

**Interfaces:**
- Produces (schema, `direct_ship_cancel_notices`):
  - `id uuid pk defaultRandom`
  - `order_cancellation_id uuid not null` — **FK 없음**(N24)
  - `sales_order_id uuid not null` → `sales_orders.id`
  - `fulfillment_order_id uuid not null` → `fulfillment_orders.id`
  - `fulfillment_order_item_id uuid not null` → `fulfillment_order_items.id`
  - `holder_id uuid not null` → `holders.id`
  - `sales_order_line_id varchar(?)` nullable — FOI 의 같은 칸과 같은 타입(varchar)
  - `sku_id uuid not null` → `skus.id`
  - `canceled_qty integer not null`, `CHECK (canceled_qty > 0)`
  - `cancellation_scope` — 기존 취소 범위 enum(`sales_order_cancellations.cancellation_scope` 와 같은 enum) not null
  - `created_at timestamptz not null defaultNow`, `notified_at timestamptz` nullable, `notified_by varchar(255)` nullable
  - `UNIQUE (order_cancellation_id, fulfillment_order_item_id)`, 부분 인덱스 `(holder_id, created_at) WHERE notified_at IS NULL`
  - TS export `directShipCancelNotices`
- Produces (명령 시그니처 변경 — 인자 순서는 이대로):
  - `reduce(salesOrderId: string, orderCancellationId: string, reductions: UnboxedDemandReduction[], tx: DbTx): Promise<ReducedDemandItem[]>`
  - `cancelOrder(salesOrderId: string, orderCancellationId: string, tx: DbTx): Promise<CanceledFulfillmentOrder[]>` (행의 범위는 `'full'` 고정, `reduce` 는 `'partial'`)
  - 반환 타입은 그대로. 행 쓰기는 명령 안쪽 private `recordPartnerNotices(trx, orderCancellationId, scope: 'full' | 'partial', changes: Array<{ item: FoiRow; qty: number }>)` — FO 를 한 번 읽어 `fulfillmentMode = 'drop_ship' AND directShipStatus = 'forwarded'` 인 FO 의 FOI 만, `qty > 0` 만 insert. `ownerId` 가 null 이면 `throw new Error(\`Forwarded drop-ship fulfillment order ${foId} has no owner — cannot record partner cancel notice\`)`(N29).
- Consumes: 없음.

- [ ] **Step 1: 명령 통합 테스트(빨강)** — `unboxed-demand-cancellation.integration.spec.ts` 에 추가하고 기존 호출을 새 시그니처로 고친다(`oc = randomUUID()`):
  - `넘긴 직배 FO 부분 감소는 대기 행 하나를 남긴다` — `dropShip: 'forwarded'`, qty 3, 1 감소 → 행 1개 `{ orderCancellationId: oc, fulfillmentOrderItemId, holderId: w.holderId, canceledQty: 1, cancellationScope: 'partial', notifiedAt: null }`.
  - `넘긴 직배 FO 전체 취소는 FOI 마다 남은 수량으로 행을 남긴다` — FOI qty 3 중 앞선 canceledQty 1 → `cancelOrder` 뒤 행 `canceledQty: 2`, `cancellationScope: 'full'`.
  - `넘기기 전 직배·창고 FO 는 행을 남기지 않는다` — `dropShip: 'pending'` 과 `dropShip` 없음 각각 → 행 0.
  - `owner 없는 넘긴 직배 FO 는 던진다` — `ownerId: null` → `rejects.toThrow('has no owner')`.
  - `행은 넘겨받은 tx 로 쓴다` — `tx.transaction(async (sp) => { await cmd.cancelOrder(so, oc, sp); throw new Error('boom'); })` 를 잡은 뒤 바깥 tx 에서 행 0(`this.dbService.db` 로 쓰면 savepoint 밖에 남아 빨갛다).
- [ ] **Step 2: 실행해 빨강 확인** — `DATABASE_URL=<k6_it> npx jest apps/core/src/modules/fulfillment/unboxed-demand --runInBand` → 컴파일/테이블 없음 실패.
- [ ] **Step 3: 스키마 + 마이그** — 테이블 추가 후 `npm run db:generate:core -- --name add-direct-ship-cancel-notices`. 생성 SQL 이 `CREATE TABLE` + FK 5개 + UNIQUE + 부분 인덱스 + CHECK 뿐인지 읽는다(DROP 이 섞이면 멈춘다). `k6_it` 에 적용.
- [ ] **Step 4: 명령 구현** — 위 Interfaces 그대로.
- [ ] **Step 5: 판매주문 통합 테스트(빨강)** `sales-orders.drop-ship-cancel-notice.integration.spec.ts`:
  - `넘긴 직배 주문 전체 취소 — 행의 취소 id 가 취소 행 id 와 같다` — `salesOrders.cancel(so, { reasonCode, idempotencyKey… }, tx)` 뒤 `direct_ship_cancel_notices.order_cancellation_id` = `sales_order_cancellations.id`.
  - `부분 취소 두 번은 행 둘, 각 감소분` — 1개, 1개 → 행 2, 각 `canceledQty: 1`, 서로 다른 취소 id.
  - `같은 멱등 키로 다시 온 부분 취소는 행을 늘리지 않는다` — 같은 `fulfillmentCommandContext.idempotencyKey`·같은 lines 로 두 번(`findAfterBoxingReplay` 가 두 번째를 돌려보낸다) → 행 1.
  - `넘기기 전 직배 주문 취소는 행이 없다` — `dropShip: 'pending'` 전체 취소 → 행 0, 취소 행은 있음.
- [ ] **Step 6: 판매주문 쪽 구현** — 두 갈래 머리에서 `const orderCancellationId = randomUUID()`, 명령에 넘기고 `cancellationValues` 에 `id: orderCancellationId`. `applyUnboxedDemandReductions` 에 인자 추가. 판매주문은 그 밖에 아무것도 모른다.
- [ ] **Step 7: 가드**
  - `order-cancellation.guard.spec.ts` — `T` 에 `directShipCancelNotices`, raw 목록에 `direct_ship_cancel_notices`. 예외 목록은 그대로(둘).
  - `direct-ship-cancel-notice-writers.guard.spec.ts` — walk 는 `unboxed-demand-callers.guard.spec.ts` 를 복사. `/\.(?:insert|update|delete)\((?:wmsTables|inventoryTables)\.directShipCancelNotices\)/` 를 가진 비-spec 파일 = `['apps/core/src/modules/fulfillment/direct-ship-cancel-notice/direct-ship-cancel-notice.manager.ts', 'apps/core/src/modules/fulfillment/unboxed-demand/unboxed-demand-cancellation.ts']`. Task 2 전까지는 manager 가 없으니 이 Task 에선 unboxed 하나로 두고 Task 2 가 한 줄 더한다.
- [ ] **Step 8: 확인** — `npm run type-check` 0, `npx jest apps/core/src/modules/sales-order apps/core/src/modules/fulfillment` 실패 0, `DATABASE_URL=<k6_it> npx jest unboxed-demand drop-ship-cancel-notice direct-ship --runInBand` 실패 0, `npx jest scripts/security` 실패 0(판매주문 서비스 줄 좌표).
- [ ] **Step 9: 커밋** `넘긴 직배 주문의 취소가 업체에 알릴 한 줄을 남긴다 — 행은 출고 명령이 같은 트랜잭션에 쓴다 (K7 PR5, D5)` (스키마·SQL·meta 같은 커밋)

### Task 2: 대기함 읽기·내려받기·알림 완료 API

**Files:**
- Create: `apps/core/src/modules/fulfillment/direct-ship-cancel-notice/direct-ship-cancel-notice.reader.ts`
- Create: `apps/core/src/modules/fulfillment/direct-ship-cancel-notice/direct-ship-cancel-notice.manager.ts`
- Create: `apps/core/src/modules/fulfillment/direct-ship-cancel-notice/direct-ship-cancel-notice.service.ts`
- Create: `apps/core/src/modules/fulfillment/direct-ship-cancel-notice/direct-ship-cancel-notice.types.ts`
- Create: `apps/core/src/modules/fulfillment/direct-ship-cancel-notice/direct-ship-cancel-notice-csv.ts` (+ `.spec.ts`)
- Create: `apps/core/src/modules/fulfillment/direct-ship-cancel-notice/direct-ship-cancel-notice.integration.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/controllers/direct-ship.controller.ts` (라우트 셋)
- Modify: `apps/core/src/modules/fulfillment/fulfillment.module.ts` (provider 셋)
- Modify: `apps/core/src/modules/fulfillment/unboxed-demand/direct-ship-cancel-notice-writers.guard.spec.ts` (manager 줄 추가)

**Interfaces:**
- Consumes: Task 1 테이블 `directShipCancelNotices`.
- Produces (`direct-ship-cancel-notice.types.ts`):
  ```ts
  export type DirectShipCancelNotice = {
    id: string;
    companyName: string;
    salesOrderId: string;
    channelOrderId: string | null;
    salesOrderLineId: string | null;
    fulfillmentOrderId: string;
    skuName: string;
    supplierSku: string | null;
    canceledQty: number;
    cancellationScope: 'full' | 'partial';
    cancelledAt: Date;       // sales_order_cancellations.occurred_at
    createdAt: Date;
    notifiedAt: Date | null;
    notifiedBy: string | null;
  };
  ```
- Produces (Reader): `listOpen(filter: { companyName?: string }): Promise<DirectShipCancelNotice[]>` — `notified_at IS NULL`, `created_at` 오름차순(오래된 것 먼저), `holders.name` = companyName. 공급사SKU 는 `getDirectShipOrders` 와 같은 `sku_suppliers` left join(여러 행이면 첫 행 — `DISTINCT ON (n.id)`). 취소 시각은 `order_cancellation_id = sales_order_cancellations.id` 로 join.
- Produces (Manager): `markNotified(companyName: string, noticeIds: string[], notifiedBy: string): Promise<{ notified: number }>` — `noticeIds` 를 `FOR UPDATE` 로 읽어 개수가 다르거나 다른 업체 행이 있으면 400 `'알림 대상이 이 업체의 알릴 취소가 아닙니다.'`; 이미 `notified_at` 이 있는 행은 건너뛰고 나머지에 `notified_at = now(), notified_by`. `notified` = 이번에 바꾼 수.
- Produces (CSV): `toCancelNoticeCsv(rows: DirectShipCancelNotice[]): string` — Global Constraints 의 열·형식.
- Produces (Service, 메서드당 한 줄 위임): `listOpen`·`exportFile(companyName): Promise<{ fileName: string; content: Buffer; mimeType: string }>`·`markNotified`.
- Produces (라우트, `DirectShipController`):
  - `GET /direct-ship/cancel-notices?companyName=` — `fulfillment.order.read` → `DirectShipCancelNotice[]`
  - `POST /direct-ship/cancel-notices/export/file` 본문 `{ companyName: string(min 1) }` — `order.order.export`, 응답은 `exportOrdersFile` 과 같은 `@Res()` 꼴(`text/csv; charset=utf-8`)
  - `POST /direct-ship/cancel-notices/notified` 본문 `{ companyName: string(min 1), noticeIds: uuid[] (min 1, max 500) }` — `fulfillment.order.write`, 행위자는 `@User()` 의 `id ?? userId`(`picking-v2.controller.ts:102` 꼴), 없으면 400.

- [ ] **Step 1: CSV 단위 테스트(빨강)** — `toCancelNoticeCsv`: 헤더 줄이 정확히 `"판매주문ID","주문라인ID","상품명","취소수량","공급사SKU","취소구분","취소일시"`; `cancelledAt = 2026-10-24T03:05:00Z` → `2026-10-24 12:05`; 상품명 `A"B` → `"A""B"`; scope `full` → `전체`.
- [ ] **Step 2: 통합 테스트(빨강)** — 대기 행은 Task 1 명령(`cancelOrder`/`reduce`)으로 만든다(직접 insert 금지 — 가드 밖 쓰기를 테스트가 보여 주지 않게):
  - `listOpen 은 미통지만, 오래된 것부터, 업체로 거른다` — 업체 둘·행 셋(하나 완료) → A 업체 필터에 A 의 미통지만.
  - `markNotified 는 미통지만 바꾸고 다시 불러도 0` — 첫 호출 `{ notified: 2 }`, 두 번째 `{ notified: 0 }`, `notifiedBy` 기록.
  - `다른 업체 행이나 없는 id 가 섞이면 400` — 문구 `'알림 대상이 이 업체의 알릴 취소가 아닙니다.'`, 아무 행도 안 바뀜.
  - `알림 완료 뒤 같은 FOI 의 새 부분 취소는 새 미통지 행` — 완료 → 다시 `reduce` → `listOpen` 에 새 행 하나.
- [ ] **Step 3: 구현** — Reader·Manager·Service·CSV·라우트. 컨트롤러는 try/catch 없이 위임. zod 스키마는 컨트롤러 파일의 기존 `ForwardOrdersSchema` 옆에.
- [ ] **Step 4: 확인** — `npx jest apps/core/src/modules/fulfillment libs/authorization scripts/security` 실패 0(`route-classification.spec.ts` 포함), 통합 `--runInBand` 실패 0, `npm run type-check` 0.
- [ ] **Step 5: 커밋** `직배송 «알릴 취소» 대기함 — 업체별 목록·CSV·알림 완료 (K7 PR5)`

### Task 3: admin-web 「알릴 취소」 탭 + 배포 점검 + 문서

**Files:**
- Modify: `apps/admin-web/src/lib/types/dto/fulfillment.ts` (`DirectShipCancelNotice` — Task 2 타입과 같은 칸, 날짜는 `string`)
- Modify: `apps/admin-web/src/lib/api/domains/orders/direct-ship.client.ts` (`getCancelNotices(companyName?)`·`exportCancelNoticesFile(companyName)`·`markCancelNoticesNotified({ companyName, noticeIds })`)
- Modify: `apps/admin-web/src/lib/services/orders/query-keys.ts` (`directShipCancelNotices: ['direct-ship', 'cancel-notices'] as const`)
- Modify: `apps/admin-web/src/lib/services/orders/queries.ts`(또는 직배 쿼리가 있는 파일) `useDirectShipCancelNotices()`
- Modify: `apps/admin-web/src/lib/services/orders/mutations.ts` — `useMarkDirectShipCancelNoticesNotified`(`.permission = ['fulfillment.order.write']`, 성공 시 `directShipCancelNotices` 무효화), `useExportDirectShipCancelNoticesFile`(`.permission = ['order.order.export']`)
- Create: `apps/admin-web/src/features/order/direct-ship/components/cancel-notices/cancel-notice-view.ts` (+ `.spec.ts`)
- Create: `apps/admin-web/src/features/order/direct-ship/components/cancel-notices/index.tsx`
- Modify: `apps/admin-web/src/features/order/direct-ship/template/index.tsx` (탭 `cancel-notices`, 라벨 `알릴 취소`, 미통지가 있으면 라벨 옆 개수)
- Create: `scripts/ops/k7-pr5-predeploy-check.js`
- Modify: `docs/adr/0049-order-cancellation-one-kernel-owns-the-sequence.md` («현재 상태»에 PR 5 한 단락: 대기 행은 출고 명령이 쓴다·취소 id 선결정·FK 없음 이유)
- Modify: `docs/superpowers/specs/2026-10-24-k7-order-cancellation-design.md` §10 에 `2026-10-24-k7-order-cancellation-pr5.md`

**Interfaces:**
- Consumes: Task 2 라우트 셋과 `DirectShipCancelNotice` 모양.
- Produces (`cancel-notice-view.ts`):
  - `export const CANCEL_NOTICE_OVERDUE_HOURS = 24;`
  - `isOverdue(createdAt: string, now: Date): boolean` — `now − createdAt ≥ 24h`
  - `groupByCompany(rows: DirectShipCancelNotice[]): Array<{ companyName: string; rows: DirectShipCancelNotice[]; overdueCount: number }>` — 업체 이름 순, 안의 행은 입력 순서 유지. `overdueCount` 는 `now` 인자로 계산 → 시그니처 `groupByCompany(rows, now: Date)`.

- [ ] **Step 1: 순수함수 spec(빨강)** — `isOverdue`: 23h59m → false, 24h → true. `groupByCompany`: 업체 `나`·`가` 섞인 3행 → `가` 먼저, `overdueCount` 정확.
- [ ] **Step 2: 구현** — 클라이언트·훅·순수함수·컴포넌트. 컴포넌트: 업체 고르기(행이 있는 업체만) → 표(주문번호 = `channelOrderId ?? salesOrderId`, 상품, 취소수량, 구분, 취소 시각, 경과) → 오래된 행 강조(배경색) → 체크박스 → `CSV 내려받기`(ExportButton 꼴, `canRun(useExportDirectShipCancelNoticesFile)`)·`알림 완료`(`run={useMarkDirectShipCancelNoticesNotified}`, 고른 행 0 이면 비활성). 빈 상태 `알릴 취소가 없습니다.`
- [ ] **Step 3: G1 스크립트** `k7-pr5-predeploy-check.js` — PR4 스크립트 머리(READ ONLY·실행법·`sql.begin('read only')`)를 따른다. ① `fulfillment_mode='drop_ship' AND direct_ship_status='forwarded'` FO 수(FO status 별) — 배포 뒤 취소가 행을 남길 대상. ② 그중 `owner_id IS NULL` 수 — **0 이어야 배포한다**(N29). ③ 넘긴 직배 FO 중 FOI `canceled_qty > 0` 인 FO 수 — 이미 통지 없이 지나간 취소(대기함엔 안 뜬다, 운영자가 따로 확인). ④ 배포 뒤: `direct_ship_cancel_notices` 존재·행 수.
- [ ] **Step 4: 확인** — `npm run test:admin-web` 실패 0(`mutation-guard.gate.spec.ts`·`screen-access.gate.spec.ts` 포함), admin-web `npx tsc --noEmit -p apps/admin-web` 0(워크트리엔 node_modules 가 없으면 메인 것을 심링크), 루트 `npm run type-check` 0.
- [ ] **Step 5: 커밋** `직배송 화면에 «알릴 취소» — 업체별로 내려받고 알림 완료, 하루 넘은 건은 눈에 띄게 (K7 PR5)`

## 배포

Core·admin-web. 마이그 1개(additive) → **`migrate → deploy`**(Core 먼저, admin-web 은 그 뒤 — admin-web 이 먼저 뜨면 탭이 404). 배포 전 G1 ②가 0. 배치 배포 방침대로 `npm run deploy:preflight -- --stage live` 가 이 마이그를 expand 로 분류하는지 본다.
