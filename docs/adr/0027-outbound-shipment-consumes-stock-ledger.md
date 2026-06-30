# 출고는 상자(shipment) 단위로 재고원장을 소진한다 — FO 는 박스가 아니라 SKU 스냅샷

## Status

Accepted (구현 대기). 2026-06-29. 상황판: `docs/outbound-shipment-ledger-rfc.md`.

**Amended 2026-06-30** — 종결 트리거 변경: 이전엔 "송장(상자 라벨) 스캔 = 종결 트리거"로 결정했으나, 물류팀 요구로 **송장 스캔 = 박스 open**, **종결 트리거 = 박스 전 라인의 검수 자동완료**로 바꿈. 소진 *단위*가 상자라는 핵심 결정은 불변, 트리거 *타이밍*만 이동(#1·#4 반영). 상세 = RFC §Phase 2 (클러스터 A).

## Context

재고는 event-sourced 원장(`stock_events` → `stock_ledgers` → `stock_summary_view`)으로 관리한다. 원본 설계(`docs/inventory_event_mutable.md`)는 출고작업 종결 시 단일 "출고완료" 이벤트를 append 해 원장 일관성을 유지하도록 의도했다.

검증(`docs/inventory-ledger-binding-review.md` §3)에서 드러난 사실:

- 정상 출고 경로(`FulfillmentsService.ship()`)가 `stock_events` 를 append 하지 않고 `on_hand` 를 차감하지 않는다. 예약만 `released` 되어 **출고된 수량이 다시 가용으로 살아나는 누수**가 있다. 즉 종결 이벤트(e3)가 누락되었다.
- `on_hand` 를 차감하는 `InventoryCommandService.ship()` 은 존재하지만 어디서도 호출되지 않는 dead code 다.

동시에 운영 현실(물류팀 인터뷰):

- 출고 종결의 물리 단위는 **상자 = 송장(라벨) 한 장**이다. (트리거 타이밍은 Decision #1 참조 — 송장 스캔 = 박스 open, 검수 자동완료 = 종결. 2026-06-30 변경.)
- 한 주문이 여러 상자로 나뉠 수 있고(**송장분할**, 박스에 안 들어갈 때), 향후 여러 주문을 한 상자로 합칠 수도 있다(**합배송**).
- 기존 모델은 FO 를 박스로 보아 송장분할을 **FO 분할**(`split()`)로 처리했고, 그 결과 한 SO 가 여러 FO 로 쪼개졌다.

## Decision

1. **출고 종결(재고 소진)의 단위는 상자(shipment)** = 송장 한 장. **종결 트리거는 박스의 모든 라인이 검수 완료되는 자동완료**이며, 송장(상자 라벨) 스캔은 박스를 **open** 하는 동작이다(종결 아님). *[2026-06-30 변경: 이전엔 "상자 라벨 스캔이 종결 트리거"였으나 물류팀 요구로 검수 자동완료 트리거로 이동. 소진 단위=상자는 불변.]*
2. **출고주문(FO)은 박스가 아니라, 판매주문을 상품매칭 규칙으로 재고상품(SKU)으로 변환한 스냅샷**이다. SO ↔ FO = 0..1 : 0..1 (디지털-only 주문은 FO 없음, 보상출고 등 단독 FO 는 SO 없음).
3. **FO ↔ 상자 = M:N.** `shipment_line {shipmentId, fulfillmentOrderItemId, skuId, qty}` 이 source FOI 를 참조한다 (M:N join 메커니즘). 한 **FO 가 여러 상자로 나뉘면 송장분할** — 정의는 FO 레벨이라 FOI ↔ line 이 1:1 이어도 성립하고, 한 FOI 의 수량까지 여러 상자에 걸치는 건 모델이 함께 허용하는 하위 케이스다. 한 상자에 여러 FO 의 라인이 모이면 합배송 — 같은 모델로 표현.
4. **박스의 모든 라인이 검수 완료되면(자동완료)** 각 상자 라인에 대해 **단일 SHIP 이벤트를 원장에 append**(on_hand 차감)하고 예약을 **소진(consume)** 한다. 차감할 로케이션은 **교체 가능한 전략**이 정한다 — 지금은 FIFO(`allocation-strategy` 재활용), 나중에 토탈피킹이 잡은 실제 로케이션. *[2026-06-30: "상자 스캔 시" → "검수 자동완료 시"로 변경, #1 참조.]*
5. **예약의 종결을 소진(consume) vs 환원(release)으로 구분한다.** 소진 = `on_hand -= q` + `reserved -= q` (출고로 실제 나감, available 불변). 환원 = `reserved -= q` 만 (취소/만료, on_hand 유지). 출고는 소진, 취소/만료는 환원.
6. **운송장번호(invoice)** 는 상자에 발급되는 택배사 운송장번호의 발급 이력이다 (shipment 1:N, active 1). 기존 FO-분할(`split()` / `handleFulfillmentOrderSplit` / 예약 FO간 이동)은 **은퇴**한다 — 분할·병합은 상자 레이어(packing)로 내려간다.
7. 소진 시 ON_HAND 가 부족하면 **불변식 위반으로 throw**(fail loud). 예약이 창고 단위로 가용을 보장하므로 정상 흐름에선 발생하지 않는다.

## Consequences

- 원장이 출고를 반영해 **재고의 단일 진실**(ADR-0001 정합)을 회복한다. "상자 N개 출고 → on_hand 정확히 N 감소, available 불변" 이 seam 단위로 테스트 가능해진다.
- 종결 seam `consumeShipment(shipmentId)` 하나 뒤에 로케이션 결정·per-location SHIP 이벤트·예약 소진·멱등이 숨는다(deep). dead `InventoryCommandService.ship()` 가 ledger-write adapter 로 부활한다.
- **destructive 스키마 변경** → expand-contract(ADR-0005 §5): `shipment_lines` 신설(additive), `shipments` 를 라인 보유 상자 본체로 승격, `invoices` 를 shipment 1:N 으로 재배치, `uqActivePerFo`·`shipments.uqFulfillmentOrder` 제거.
- `reservation-lifecycle` 의 split/merge 분기와 `fulfillments.service.split()` 은 제거 대상. 대신 packing 연산(상자+라인 생성)이 새로 필요하다.
- **토탈피킹**(피킹-로케이션 전략)·**합배송**(M FO → 1 상자)은 이 모델이 *막지 않되* 흐름 구현은 후속(Non-Goal).
- 멱등성은 상자 status 전이(`FOR UPDATE`) + SHIP `idempotencyKey = f(shipmentId, lineId)` 로 보장.

## Follow-ups (out of scope)

- packing 연산의 인터페이스, FOI 부분출고 상태값 모델, 작업자(actor) → SHIP journal 귀속은 RFC 의 Open Questions 에서 확정한다.
- 본 ADR 을 "FO 재정의"와 "소진/환원"으로 분리할지 여부는 구현 착수 시 재검토.
