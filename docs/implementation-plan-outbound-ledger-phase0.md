# 구현 계획 — Phase 0: 출고 고리 닫기 (Outbound Ledger Closure)

> 상위 RFC: [`docs/outbound-shipment-ledger-rfc.md`](./outbound-shipment-ledger-rfc.md) · 결정: [ADR-0027](./adr/0027-outbound-shipment-consumes-stock-ledger.md)
> 작성 2026-06-29.

## 목표 / 범위

현재 1:1 모델(운송장=FO) **그대로** 위에서, 출고가 재고원장을 차감하지 않는 누수(review §3)를 막는다. **Additive 전용 — 스키마 변경/마이그레이션 없음.** 상자 라인·packing·송장분할·FO 스냅샷은 Phase 1+ (이 PR 비범위).

**성공 기준 (테스트로 고정):** 예약된 재고를 가진 FO 를 출고하면 — `on_hand` 가 출고 수량만큼 감소하고, 예약이 소진되며, **`available` 는 불변**이고, FOI 별 SHIP `stock_event` 가 1건씩 남는다.

## 변경 요약

1. **로케이션 결정 seam 도입** (inventory/core, export)
   - `LocationResolutionStrategy` 포트: `resolve(skuId, warehouseId, qty, tx) → {locationId, qty}[]`.
   - `FifoLocationStrategy` 어댑터: `stock_ledgers` 의 `ON_HAND` 행을 `locations.fifoRank`(nulls last) → `updatedAt` 순으로 그리디 할당. 부족하면 `throw`.
   - ⚠️ `AllocationStrategyService.getAvailableLocations` **재사용 금지** — 그건 `available = on_hand − reserved` 를 빼므로, 예약을 동시에 소진하는 이 경로에서 쓰면 **이중 차감**된다. raw ON_HAND 를 본다.

2. **`OutboundConsumptionService` 신설** (fulfillment 모듈 — 순환 의존 회피)
   - `consumeFulfillmentOrder(foId, tx)` = Phase 1 의 `consumeShipment` 의 Phase 0 stand-in.
   - FOI 별: `chunks = locationStrategy.resolve(skuId, FO.warehouseId, shippedQty, tx)` → 각 chunk 마다 `inventoryCommand.ship({skuId, warehouseId, locationId, quantity, idempotencyKey: \`ship:${foId}:${foiId}:${locationId}\`, reason})`.
   - 그다음 예약 **소진**: 해당 FO 의 예약 row 를 닫고 `FOI.reservedQty`/`FO.totalReservedQty` 0 처리. (현 `releaseFulfillmentOrderReservations` 와 동일 closure — SHIP 이벤트가 emit 됐다는 점이 소진 vs 환원의 차이.)

3. **`FulfillmentsService.ship()` 재배선**
   - 현재 `reservationLifecycle.handleFulfillmentOrderStatusChange(id, fo.status, 'shipped', trx)` (release = 버그) 호출을 `outboundConsumption.consumeFulfillmentOrder(id, trx)` 로 교체.
   - **취소 경로는 그대로** (`handleFulfillmentOrderStatusChange('canceled')` = 환원 유지).

4. **dead `InventoryCommandService.ship()` 부활** — 이미 SHIP 이벤트 append + `stock_ledgers` 차감 + `StockShipped` outbox 를 한다. 코드 변경 없이 호출자만 생김.

## 모듈 배선 (확인 포인트)

- `OutboundConsumptionService` 는 **fulfillment 모듈** 에 둔다. fulfillment 은 이미 `SharedModule`(예약 서비스) 을 import 하고, `InventoryCommandService`/`AllocationStrategyService` 는 inventory/core 가 **export** 한다 → fulfillment.module 이 inventory-core 모듈을 import 하는지 확인하고, 없으면 추가. (inventory→fulfillment 역방향 import 없음 → 순환 없음.)
- `LocationResolutionStrategy` 포트/FIFO 어댑터는 inventory/core providers+exports 에 등록.

## TDD 순서 (red → green, 좁힌 실행)

> 실행은 전체 스위트 금지 — `jest --testPathPattern=<해당 spec>` 로만. 기존 `inventory-command.service.adjust.integration.spec.ts` 패턴(테스트 DB) 따름.

1. **FIFO 할당 순수 함수 단위 테스트** — `fifo-allocate.spec.ts`
   - 입력(ledger 행 + qty) → chunk 배열. fifoRank 순서, 다중 로케이션 분할, 정확 소진.
   - 부족분 → `throw`. **(red→green: 순수 할당 함수 먼저.)**

2. **소진 통합 테스트** — `outbound-consumption.integration.spec.ts`
   - 셋업: SKU+창고+로케이션에 `RECEIVE` 로 on_hand=100, FO+FOI(qty=10)+예약 confirmed 10. → available=90.
   - **red**: `consumeFulfillmentOrder(foId)` 미구현/release 상태 → on_hand 그대로(100)·available 100. assert 실패.
   - **green**: 구현 후 → on_hand=90, 예약 소진, **available=90 유지**, `stock_events`에 SHIP 1건(qty=10, fromState=ON_HAND).

3. **available 불변 회귀 테스트** (핵심 버그 고정) — 같은 spec
   - 출고 전/후 `stock_summary_view.availableQty` 동일(90). (현재 버그면 100 으로 튐.)

4. **멱등 테스트** — 같은 spec
   - `ship()` 2회 호출 → on_hand 1회만 차감(=90), SHIP 이벤트 중복 없음(idempotencyKey).

5. **엣지 — 재고 부족** — 같은 spec
   - on_hand < shippedQty 인 상태에서 소진 → `throw` (불변식 위반). 정상 흐름엔 예약이 막지만 가드 확인.

## 검증

- 좁힌 jest 실행(위 spec 들), `tsc --noEmit`(또는 `nest build core`), `npm run lint`.
- 전체 스위트 실행 금지(OOM).

## 명시적 비범위 (Phase 1+)

- `shipment`/`shipment_line`/packing/송장분할/FO=스냅샷/`uqActivePerFo` 제거 — 전부 후속.
- `reservation_status` 에 `consumed` enum 추가(감사용) — 지금은 release closure 재사용, **스키마 무변경 유지**.
- 로케이션 전략의 피킹-로케이션 어댑터(토탈피킹) — 포트만, 어댑터는 후속.

## 산출물

- **PR 1개, additive.** 마이그레이션 없음 → expand-contract 후속 phase 와 독립적으로 머지/배포 가능. 이 PR 하나로 review §3 누수가 닫힌다.
