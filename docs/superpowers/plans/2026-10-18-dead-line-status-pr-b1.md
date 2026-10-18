# 생산자 없는 라인 상태 읽기 중단 · 외부 출고 (PR ⓑ-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `sales_order_lines.status`(와 같은 처지 칼럼 셋)를 읽는 곳을 모두 실제 출처로 옮기고, 셀메이트 출고분을 일별 통계·주문 화면에서 «외부 출고»로 따로 보인다. 칼럼은 아직 지우지 않는다(ⓑ-2).

**Architecture:** 주문 단위 «출고 단계»(결제대기·준비중·배송중·배송완료·외부 출고·취소)를 SQL 한 벌(`orderShipmentPhaseSql`)로 정의하고, 일별 통계·주문 목록·주문 상세가 같이 쓴다. 주문내역·CS 조회의 라인 상태 배지는 이 단계 배지로 바뀐다. 발주 수요는 부분취소를 기존 라인 단위 계산(`cancelledQuantitySql`)으로 뺀다.

**Tech Stack:** NestJS, Drizzle, Jest, Next.js admin-web.

**Spec:** `docs/superpowers/specs/2026-10-18-stock-shortage-and-dead-line-status-design.md` (§1.1·§1.2, §5.1·§5.2, §6 ⓑ-1 줄, D5·D6·D10·D12)

## Global Constraints

- PR ⓐ 와 순서 의존 없음. 마이그 없음.
- 셀메이트 의미로 `sales_orders.status IN ('shipped','delivered')` 를 읽는 곳 넷은 **건드리지 않는다**: `order-progress.judge-sql.ts:189`, `channel-order-change.manager.ts:32`, `store-sales-orders.service.ts:390`, `store-return-exchange.service.ts:1516`.
- `typeGroup` 의 `ready`·`partial`·`hold` 는 `ORDER_TYPE_GROUPS` 에 **남긴다**(옛 admin-web 이 400 을 받지 않게) — 값은 ⓑ-2 에서 지운다.
- «외부 출고» 기준은 정체 보드 D3 와 같다: `sales_orders.status IN ('shipped','delivered')`.
- 레이어·트랜잭션·`any` 금지·`describeIfDb`·admin-web 순수 함수 규칙은 PR ⓐ 계획의 Global Constraints 와 같다.
- 게이트: `npm run type-check` 0, `npx jest --maxWorkers=2` 0, `npm run test:admin-web` 통과, `(cd apps/admin-web && npx tsc --noEmit)` 0.

## Review Focus

- **상자도 FO 도 없는 셀메이트 출고 주문** — «외부 출고», 준비중에 안 센다 → Task 1 스펙.
- **셀메이트 `shipped` 인데 core 상자도 있는 주문(과도기 이중)** — 외부 출고가 이긴다(정체 보드 D3 와 같은 우선) → Task 1 스펙.
- **취소된 주문의 남은 상자** — «취소» → Task 1 스펙.
- **부분취소가 라인 수량 전부인 라인** — 발주 수요 0, 음수 아님 → Task 3 스펙.
- **옛 admin-web 이 `typeGroup=hold` 로 부름** — 200 + 빈 목록 → Task 2 스펙.

---

### Task 1: 주문 출고 단계 SQL 한 벌 + 일별 통계 «외부 출고»

**Files:**
- Create: `apps/core/src/modules/sales-order/services/order-shipment-phase.sql.ts`
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.service.ts:1165-1215` (`getDailyStatusStats`)
- Modify: `apps/core/src/modules/sales-order/utils/daily-order-status.ts` (`externalShipped`)
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts:163-169` (주석, D12)
- Test: `apps/core/src/modules/sales-order/services/order-shipment-phase.integration.spec.ts`, `apps/core/src/modules/sales-order/utils/daily-order-status.spec.ts`(있으면 수정, 없으면 생성)

**Interfaces:**
- Produces: `type OrderShipmentPhase = 'pending' | 'preparing' | 'shipping' | 'delivered' | 'external_shipped' | 'cancelled'`
- Produces: `orderShipmentPhaseSql(scope: SQL): SQL` — `scope` 는 판매주문 id 한 열 SELECT. 결과 열 `sales_order_id`, `phase`. 규칙(위가 이긴다):
  1. `status IN ('cancelled','timeout')` → `cancelled`
  2. `status = 'pending'` → `pending`
  3. `status IN ('shipped','delivered')` → `external_shipped`
  4. 지금 `getDailyStatusStats` 의 `units`·`phase` CTE(상자 `canceled`·`superseded` 제외 + 직배 `direct_ship_status`) 그대로: 전부 delivered → `delivered`, 하나라도 움직임 → `shipping`, 그 밖 → `preparing`
- Produces: `DailyOrderStatusPoint.externalShipped: number` (응답 `series[].externalShipped`)
- D12 주석 문구: `// 'shipped'·'delivered' — 코드 producer 0. 셀메이트 스크립트(scripts/sellmate/mark-shipped-from-csv.ts)가 쓴다. 읽는 곳은 «core 밖에서 나갔다(외부 출고)» 뜻으로 읽는다 — 정체 보드 D3. core 출고의 진실은 FO·상자다(ADR-0017)`

- [ ] **Step 1: 실패하는 통합 스펙** — 규칙 1~4 각각 한 주문 + Review Focus 첫 셋:

```ts
it('상자 없는 셀메이트 shipped 주문은 external_shipped', ...);
it('셀메이트 shipped 인데 core 상자도 있으면 external_shipped 가 이긴다', ...);
it('취소 주문은 남은 상자가 있어도 cancelled', ...);
it('상자 둘 중 하나만 발송이면 shipping, 둘 다 delivered 면 delivered, 상자 없는 confirmed 는 preparing', ...);
it('일별 통계는 셀메이트 출고분을 externalShipped 로 세고 preparing 에서 뺀다', ...);
```

- [ ] **Step 2: 실패 확인** — Run: `npm run test:core:integration:local -- order-shipment-phase` / FAIL
- [ ] **Step 3: `orderShipmentPhaseSql` 구현, `getDailyStatusStats` 의 order 쿼리를 `count(*) FILTER (WHERE phase = …)` 로 다시 쓴다(`total` 은 그대로 전체), `buildDailyOrderStatusSeries` 에 `externalShipped` 추가, D12 주석**
- [ ] **Step 4: 통과 확인** — 같은 명령 + `npx jest apps/core/src/modules/sales-order/utils` / PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(core): 주문 출고 단계 한 벌과 일별 통계 외부 출고 (#1016 15번)"`

---

### Task 2: 주문 목록·상세에 `shipmentPhase`, 라인 상태 필터 무력화

**Files:**
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.service.ts:933-947` (`typeGroup` 분기), `:1149-1152` (목록 `data`), `:773` (`getOne`)
- Modify: `apps/core/src/modules/sales-order/dto/sales-order-response.dto.ts` (주문에 `shipmentPhase`, 라인에서 `status`·`suggestedQuantity`·`unavailableSkuIds`·`deductedAt` 문서 제거)
- Modify: `apps/core/src/modules/sales-order/dto/sales-order-filter.dto.ts:13-21` (주석: `ready`·`partial`·`hold` 는 옛 화면 호환용 — 늘 빈 결과, ⓑ-2 에서 제거)
- Test: `apps/core/src/modules/sales-order/services/sales-orders.list.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 `orderShipmentPhaseSql`, `OrderShipmentPhase`
- Produces: 목록 `data[].shipmentPhase: OrderShipmentPhase`, `getOne(id).shipmentPhase: OrderShipmentPhase` — 목록은 페이지 주문 id 로 한 번 조회(N+1 금지)
- Produces: `typeGroup ∈ {'ready','partial','hold'}` → 조건 `sql\`false\`` (빈 결과, 200)

- [ ] **Step 1: 실패하는 스펙** — 라인 상태로 `ready`·`partial`·`hold` 를 검증하던 기존 케이스를 «늘 빈 결과»로 바꾸고, `shipmentPhase` 가 목록·상세에 실리는 케이스 추가
- [ ] **Step 2: 실패 확인** — Run: `npm run test:core:integration:local -- sales-orders.list` / FAIL
- [ ] **Step 3: 구현** — `typeGroup` 세 분기를 `conditions.push(sql\`false\`)` 로, 목록·상세에 단계 붙이기
- [ ] **Step 4: 통과 확인** — 같은 명령 / PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(core): 주문 응답에 출고 단계, 라인 상태 필터는 빈 결과 (#1016 15번)"`

---

### Task 3: 발주 수요·인쇄 판정·매칭 응답에서 라인 상태 떼기, 생성 쓰기 멈춤

**Files:**
- Modify: `apps/core/src/modules/inventory/replenishment/demand/demand-series.writer.ts:88-103`
- Modify: `apps/core/src/modules/print-order/services/print-order.reader.ts:97,223` (`lineStatus` 제거), `print-order-admin.manager.ts:142`
- Modify: `apps/core/src/modules/product-matching/services/product-matching.service.ts:793` (`lineStatus` 제거 — 응답 소비처가 쓰면 같이)
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.service.ts:304-325` (생성: `status`·`suggestedQuantity`·`unavailableSkuIds`·`deductedAt` 쓰기와 그 값만을 위한 `getVariantPolicy` 호출 제거 — 호출 결과를 다른 곳에서 쓰면 남긴다)
- Test: `apps/core/src/modules/inventory/replenishment/demand/demand-series.writer.integration.spec.ts`(있으면 추가, 없으면 생성)

**Interfaces:**
- Consumes: `cancelledQuantitySql(salesOrderId: SQLWrapper, salesOrderLineId: SQLWrapper): SQL` (`print-order/services/print-order.reader.ts:70`) — 모듈 경계가 어색하면 `sales-order` 쪽 공용 위치로 옮기고 두 곳이 import 한다(계산은 한 벌)
- Produces: 수요 `line_qty = sol.quantity − cancelledQuantitySql(o.id, sol.id)`, `line_qty <= 0` 라인 제외. `line_amount` 는 그대로(금액 비례 조정은 범위 밖 — 빌더가 바꾸지 않는다)

- [ ] **Step 1: 실패하는 수요 스펙**

```ts
it('부분취소된 수량만큼 수요가 준다', ...);           // qty 5, 부분취소 2 → 3
it('전량 부분취소된 라인은 수요에 없다', ...);         // qty 2, 부분취소 2 → 행 없음
it('묶음 상품 라인은 줄인 수량으로 SKU 에 펼친다', ...); // qty 2, 취소 1, 링크 ×3 → SKU 3
```

- [ ] **Step 2: 실패 확인** — Run: `npm run test:core:integration:local -- demand-series` / FAIL
- [ ] **Step 3: 구현 + 인쇄·매칭·생성 정리** (인쇄 판정은 동작이 바뀌지 않는다 — `print-order` 스펙이 그대로 통과해야 한다)
- [ ] **Step 4: 통과 확인** — Run: `npm run test:core:integration:local -- demand-series print-order sales-orders` 그리고 `npx jest apps/core/src/modules/print-order apps/core/src/modules/product-matching` / PASS
- [ ] **Step 5: 커밋** — `git commit -m "fix(core): 발주 수요가 부분취소분을 빼고, 라인 상태 읽기·쓰기를 멈춘다 (#1016 15번)"`

---

### Task 4: admin-web — 주문내역·CS 조회·일별 통계

**Files:**
- Create: `apps/admin-web/src/lib/api/domains/orders/shipment-phase.shape.ts` (+ `.spec.ts`)
- Modify: `apps/admin-web/src/features/order/history/hooks/use-order-rows.ts` (+ `.spec.ts`), `components/table/index.tsx`, `contexts/filter.context.tsx`, `components/filter-box/index.tsx`
- Delete: `apps/admin-web/src/features/order/history/components/modals/split-order-modal.tsx`, `split-quantity-modal.tsx` (+ 버튼·상태)
- Modify: `apps/admin-web/src/features/cs/order-lookup/index.tsx`
- Modify: `apps/admin-web/src/features/main/DailyBoards.tsx:257-266`, `apps/admin-web/src/lib/types/dto/orders.ts:404-416`

**Interfaces:**
- Consumes: Task 2 `shipmentPhase`, Task 1 `series[].externalShipped`
- Produces: `toShipmentPhase(v: unknown): ShipmentPhase | null` (모르는 값·옛 응답 → null), `shipmentPhaseLabel(p: ShipmentPhase | null): string` → `pending:'결제대기' · preparing:'준비중' · shipping:'배송중' · delivered:'배송완료' · external_shipped:'외부 출고' · cancelled:'취소' · null:''`
- 주문내역 `OrderLineRow`: `lineStatus`·`isReadyToShip`·`isUnavailable`·`isOrderFullyAllocated` 제거, `shipmentPhase: ShipmentPhase | null` 추가
- 주문내역 «C/S 상태» 칸: `stock_unavailable` 분기를 지우고 늘 버튼
- 일별 표: `ORDER_COLUMNS` 의 `delivered` 뒤에 `{ key: 'externalShipped', label: '외부 출고' }`

- [ ] **Step 1: 실패하는 shape 스펙** — `toShipmentPhase`·`shipmentPhaseLabel` 전 값, `use-order-rows.spec.ts` 의 기대 행에서 라인 상태 칸 제거·`shipmentPhase` 추가
- [ ] **Step 2: 실패 확인** — Run: `npm run test:admin-web -- shipment-phase use-order-rows` / FAIL
- [ ] **Step 3: 구현 + 화면 정리** — 배지(`StatusBadge`)는 `shipmentPhaseLabel(row.shipmentPhase)`, 미매칭 배지는 그대로. 필터 «완전출고·부분출고·출고불가» 항목 제거. 줄 선택(`selectedOrderIds`·`isOrderSelectable`·`selectedRowKeys`) 제거. CS 조회는 `LINE_STATUS_LABEL` 과 라인 상태 칸을 지우고 주문 머리에 단계 배지
- [ ] **Step 4: 확인** — Run: `npm run test:admin-web` 그리고 `(cd apps/admin-web && npx tsc --noEmit)` / PASS, 0
- [ ] **Step 5: 커밋** — `git commit -m "feat(admin-web): 라인 상태 대신 출고 단계, 일별 통계 외부 출고 (#1016 15번)"`

---

### Task 5: 게이트와 PR

- [ ] **Step 1:** `npm run type-check` → 0 / `npx jest --maxWorkers=2` → 0
- [ ] **Step 2:** `grep -rnE "salesOrderLines\.status|lineStatus|stock_deducted|stock_unavailable" apps/core/src apps/admin-web/src --include=*.ts --include=*.tsx | grep -v "\.spec\.\|inventory.schema.ts"` → 0 줄 (남는 건 스키마 정의뿐)
- [ ] **Step 3:** PR 생성. 본문에 «마이그 0, 순서 무관. ⓑ-2(DROP) 는 이 PR 이 라이브에 실리고 배포가 한 번 더 끝난 뒤» 를 적고, #1016 «남은 운영 작업»에 «15번 ⓑ-2 — ⓑ-1 배포 뒤 다음 배포가 끝나면 DROP PR 머지 → `sst deploy` → `db:migrate`(contract)» 줄을 단다.
