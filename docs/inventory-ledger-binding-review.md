# 재고원장 ↔ 출고작업(묶인 재고) 설계 검증 메모

> 작성일: 2026-06-28
> 대상: `apps/core/src/modules/inventory` (재고원장) + `apps/core/src/modules/fulfillment` (출고작업)
> 기준 문서: [`docs/inventory_event_mutable.md`](./inventory_event_mutable.md) (원래 의도한 설계, "동영")
> 관련 ADR: [ADR-0001](./adr/0001-no-current-stock-cache-on-sku.md) (재고의 진실은 `stock_summary` 뿐), [ADR-0012](./adr/0012-fulfillment-order-creation-is-separate-from-reservation.md)

이 메모는 "원래 의도한 설계"가 실제 코드에 어디까지 구현됐는지 대조한 결과다. 결론: **절반만 구현됐고, 고리를 닫는 종결 이벤트가 빠져 있다.**

---

## 1. 원래 의도한 설계 (요약)

`inventory_event_mutable.md` 가 그리는 그림:

1. **append-only 이벤트 원장 + 조회용 재고 테이블.** 모든 재고 변동은 이벤트로 append. 취소도 삭제가 아니라 반대 이벤트 append. 조회는 b(생성)/d(소멸) 마커로 특정 시점 재고를 추적.
2. **출고작업이 재고를 "묶는다".** 출고작업이 시작되면 해당 수량이 원장에서 **임시 mutable 테이블(`outbound_task_stocks`)** 로 옮겨지고, 그 작업이 재고의 세부 상태(`출고대기 → 출고작업중 → 출고완료`)를 위임받아 관리한다.
3. **묶인 동안은 이벤트 대신 counter update.** 바코드 한 번 = row update(숫자 +1), 이벤트 append 아님. (수백 번 스캔이 수백 개 이벤트가 되는 걸 피하려는 것이 이 설계의 핵심 동기.)
4. **완료 시 단일 종결 이벤트(e3, "출고완료")를 원장에 한 번 append.** 임시 테이블은 expire되고, 원장에 출고완료 이벤트가 찍히며 **재고 일관성이 유지된다.** → 즉 출고작업은 **시작(e2)과 종료(e3) 두 이벤트로 bracket** 되고, 그 사이를 mutable 작업 테이블이 채운다.
5. **조회 시 묶은 주체에 질의.** 원장 기반 재고를 먼저 보고, 어딘가 묶인 재고가 있으면 묶은 주체(출고작업)에 세부 상태를 질의해 전체를 합성한다.

---

## 2. 실제 구현 매핑

| 원래 설계 개념 | 실제 구현 | 위치 |
|---|---|---|
| append-only 이벤트 원장 | `stock_events` (불변, POSTED/VOIDED, 반대 이벤트로 역분개) | `schema/inventory.schema.ts:772`, `core/repositories/stock-event.store.ts:51` |
| 조회용 재고 테이블 (b/d) | `stock_ledgers` (grain별 qty 투영, mutable) + `stock_summary_view` (조회 뷰) — b/d 마커가 아니라 **수량 투영** 방식 | `schema/inventory.schema.ts:824`, `:849` |
| 임시 mutable 작업 테이블 `outbound_task_stocks` | **둘로 쪼개짐**: 재고예약 `stock_reservations`(묶음=점유) + 출고주문 counter `fulfillment_order_items.{reservedQty,pickedQty,shippedQty}` + 검수 counter `inspection_items.{inspectedQty,approvedQty,rejectedQty}` | `schema/inventory.schema.ts:1337`, `:2020`, `:2090` |
| 피킹 = counter update | ✅ `FOI.pickedQty += n` (이벤트 없음) | `fulfillment/services/picking-process.service.ts:228, 444` |
| 검수 = counter update | ✅ `inspection_items.*`, `FOI.shippedQty` (이벤트 없음) | `fulfillment/services/inspection.service.ts:295, 336` |
| **완료 시 종결 이벤트(e3)** | ❌ **없음.** 완료 시 예약만 `released`, FO/FOI counter 갱신, Kafka `FulfillmentShipped` 발행 — `stock_events` append 0건, `stock_ledgers` 차감 0 | `fulfillment/services/fulfillments.service.ts:1158` |

---

## 3. 검증 결과

| 원래 설계 | 판정 | 근거 |
|---|---|---|
| ① 이벤트 원장 + 조회 뷰 | ✅ 구현됨 | `stock_events`→`stock_ledgers`→`stock_summary_view` |
| ② 출고작업이 묶고, 세부 상태를 counter로 관리 | ✅ 구현됨 (단 메커니즘이 예약+작업 counter 둘로 쪼개짐) | 위 매핑 |
| ③ 완료 시 단일 종결 이벤트 append | ❌ **미구현 (핵심 갭)** | 아래 |
| ④ 조회 시 묶은 주체에 질의해 합성 | ◐ 부분 — 예약 차원만 뷰의 SQL JOIN으로 접힘. 피킹/검수 세부 상태는 작업 객체에만 있고 합성 조회 없음 | `stock_summary_view`의 reserved JOIN; `unified-reservation.service.ts:175` `getReservationsBySku` 는 역조회 primitive로만 존재 |

### 핵심 갭: 고리가 닫히지 않았다 (③)

원래 설계의 **bracket 중 "종료(e3)" 가 빠졌다.** 출고작업 시작 쪽 묶음(예약)은 있는데, 완료 시 원장에 출고완료 이벤트가 안 찍히고 차감도 안 된다.

정상 출고 경로 `FulfillmentsService.ship()` (`fulfillments.service.ts:1158`)가 하는 일:
- FOI counter 갱신 (`shippedQty = qty`, `:1220`)
- FO 상태 `shipped` 전이
- 재고예약 `released` 처리 (`reservation-lifecycle.service.ts:39` → `unified-reservation.service.ts:97`)
- Kafka `FulfillmentShipped` outbox 발행 (`:1260`)
- **`stock_events` append 없음 / `stock_ledgers.on_hand` 차감 없음**

전수 조사:
- 원장을 차감하는 SHIP 이벤트 생성 코드 `InventoryCommandService.ship()` (`inventory-command.service.ts:108`)는 **존재하지만 코어 어디서도 호출되지 않는다** (주입처는 입고·이동·반품·`adjustDown`뿐, ship 호출자 0).
- `FulfillmentShipped` 이벤트를 소비해 원장을 차감하는 consumer **없음** (소비처는 판매주문 표시상태 파생용뿐).
- 유일 주문 이벤트 소비자 `order-events.consumer.ts` 도 재고 차감 안 함.

**결과:** 재고원장은 입고(RECEIVE)·반품·수동조정·이동으로만 줄고, **정상 출고로는 절대 줄지 않는다.** 예약이 `available = on_hand − reserved` 로 잠깐 가려주지만, 출고 시 그 예약마저 `released` 되므로 출고된 수량이 **다시 가용 재고로 살아난다.** ADR-0001("재고의 진실은 `stock_summary`")·CONTEXT.md(출고주문 = "재고 차감 대상", `CONTEXT.md:153`)와 정면으로 어긋나는 누수.

---

## 4. 추가로 발견한 설계 제약 (1번 작업의 쟁점)

종결 이벤트를 구현하려면 풀어야 하는 grain 불일치:

- **재고원장은 로케이션 단위**: `stock_events`/`stock_ledgers` 는 `(sku, warehouse, location, state)` grain. SHIP 이벤트는 `fromWarehouseId` + `fromLocationId` + `fromState` 가 **필수** (`stock-event.store.ts:124`).
- **재고예약은 창고 단위**: `stock_reservations` 에 `locationId` 가 없다 (`schema:1337`~). 창고까지만 묶는다.
- **피킹은 로케이션을 알 수도 있다**: `outbound_task_lines.locationId` / `scannedBarcode` (`schema:1439`). 단 모든 출고가 `outbound_tasks` 를 거치진 않는다 (direct-ship, individual pick 등 별도 경로 존재).

→ "완료 시 어느 로케이션에서 차감할 것인가?" 가 1번의 핵심 설계 질문. (예약을 로케이션 단위로 올릴지 / 피킹 스캔에서 잡은 로케이션을 쓸지 / FIFO 등 할당 전략으로 정할지.)

기타 쟁점: 멱등성(중복 ship 방지 — `stock_events.idempotencyKey` 활용), 부분 출고(`handlePartialShipment`), 이벤트 1건/FOI 묶음 단위, 출고 경로가 여럿(ship/direct-ship/invoice)이라 seam을 어디 한 곳에 둘지.

---

## 5. 개선 후보 (deepening opportunities)

근본 friction 하나: **재고의 진실이 두 메커니즘(원장 / 예약+작업 counter)으로 쪼개졌는데 둘을 잇는 seam이 없다.**

1. **출고 완료 → 재고원장 차감 seam을 닫기 (빠진 종결 이벤트).** ← *먼저 깊게 판다.*
   FO ship(또는 `FulfillmentShipped` 소비자)이 FOI별 SHIP/OUT_ORDER 이벤트 1건씩 append + 예약 종결. dead 상태인 `InventoryCommandService.ship()` 를 이 seam의 adapter로 재활용. 효과: 원장이 단일 진실(ADR-0001 정합), "10개 출고 → on_hand 10 감소"가 단위 테스트로 표현 가능.
2. **"묶인 재고(Bound Stock)"를 1급 추상으로.** 예약·FOI·검수 counter에 흩어진 "이 SKU가 어디에 얼마나, 어떤 세부 상태로 묶였나"를 한 reader가 합성해 반환(원래 설계의 "묶은 주체에 질의"의 실체화).
3. **dead 예약 이벤트 enum 정리.** `eventTypeEnum` 의 `RESERVE/CONFIRM/RELEASE/CANCEL` 은 선언만 되고 `stock_events.transitionType` 은 안 씀 → "예약도 이벤트 소싱"이라는 착시. overlay임을 ADR화하고 dead enum 제거(또는 원장 상태로 승격).
4. **`stock_summary_view` 비용.** `skus CROSS JOIN warehouses` + 5개 집계 서브쿼리를 매 조회 — replay 회피용 뷰가 또 다른 전수 집계. materialized view/증분 read model로(ADR-0001이 허용). 단 1번 선행 필요.

---

## 6. 확정 설계 → RFC 로 이전

1번의 확정 설계(엔티티 재모델·종결 seam·소진/환원·로케이션 전략·마이그레이션·지금/나중)는 살아있는 상황판인 **[`docs/outbound-shipment-ledger-rfc.md`](./outbound-shipment-ledger-rfc.md)** 로 이전했다. 결정의 *이유*는 **[ADR-0027](./adr/0027-outbound-shipment-consumes-stock-ledger.md)**. 본 문서(§1–5)는 그 출발점인 **검증 기록**으로 남는다.
