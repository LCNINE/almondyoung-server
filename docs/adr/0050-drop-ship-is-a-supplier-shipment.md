# 직배는 입점사가 보내는 상자다

## Status
Accepted (2026-10-25). 설계 스펙 `docs/superpowers/specs/2026-10-25-k3-drop-ship-supplier-shipments-design.md`(K3), 출발점은 구조 감사
`docs/order-logistics-architecture-audit-2026-10.md` 의 K3. [[0027-outbound-shipment-consumes-stock-ledger]] 이 남긴 «직배 예외»를 대체한다. 이 문서는 K3 PR 2(expand)가 정한 것을 적고,
뒤 PR 이 동작을 옮길 때마다 덧붙인다.

## Context
[[0027-outbound-shipment-consumes-stock-ledger]] 은 FO 를 «판매주문을 SKU 로 옮긴 스냅샷», 나가는 단위를 상자로 바꿨지만 직배만 옛 모델(FO 하나 = 업체 하나, `holders` 를 이름으로 고름,
송장 없음, FO status 직접 쓰기)에 남겼다. 창고 상품과 직배 상품이 섞인 주문은 FO 생성이 거절됐고, 입점사 둘의 상품이 한 주문에 있으면 한 업체로만 넘어갔다.
직배는 앞으로 늘어난다(입점 제조사 위탁 발송, 스펙 §1.1).

## Decision
1. **직배 = 입점사가 싸서 보내는 상자.** 주문 하나 = FO 하나이고, 그 안에서 창고분은 창고 상자로, 직배분은 입점사마다 상자 하나로 간다.
   입점사는 `suppliers`(`is_direct_delivery = true`) 행이다. `holders` 는 직배에 쓰지 않는다(옛 경로의 칸은 K3 PR 8 이 걷는다).
2. **판별자는 상자의 주인 하나다.** `shipments.warehouse_id`·`supplier_id` 중 정확히 하나(CHECK `ck_shipments_owner`). FO 의 `fulfillment_mode` 나
   SKU `stock_type` 으로 판별하지 않고, 새 FO 에 `drop_ship` 모드를 쓰지 않는다 — 한 FO 에 창고분과 직배분이 섞이므로 FO 단위 모드는 뜻이 없다.
3. **입점사는 SKU 에서 저절로 정해진다.** `drop_shipped` SKU 는 직배 공급사 연결이 정확히 하나다(`sku-direct-supplier.rule.ts`, 값이 바뀔 때만 검사).
   공급사 쪽도 그 연결을 깨지 못한다 — 직배 SKU 가 묶인 공급사의 «직배 아님» 전환·삭제는 409.
4. **«넘김»은 상태가 아니라 기록이다.** 운영자가 입점사 하나의 엑셀을 내려받으면 `supplier_handoffs` 행 하나가 생기고 상자가 그 묶음을 가리킨다.
   복합 FK `(supplier_handoff_id, supplier_id)` 가 다른 입점사의 묶음을 막는다. 상자 상태는 K2 전이표 그대로 `draft → shipped → (canceled)` 이다.
   «못 보냄»도 상자 라인의 기록이다 — 취소가 아니라 수량은 그대로다.
5. **입점사 발송 시도는 원장이 없다.** `dispatch_attempts.kind` 가 `'supplier'` 면 `stock_journal_id`·`reversal_journal_id` 가 반드시 NULL 이고,
   `dispatched`·`recalled` 의 원장 요구는 `'warehouse'` 에만 걸린다. 고객 추적·발송 이벤트가 창고와 같은 모양(상자 → 시도 → 송장)으로 읽게 하려는 것이다.
6. **창고 흐름은 좁힌 곳으로만 들어온다.** 예약·예약 재시도·계획·피킹·배치·합배송·채번·발송·재고 원장은 상자의 창고 id 를 `warehouseIdOf`
   (`fulfillment/shipment/shipment-owner.ts`)로만 얻고, 입점사 상자면 거기서 409 `SUPPLIER_SHIPMENT_IN_WAREHOUSE_FLOW` 다. 1차 방어선은 타입
   (`warehouse_id` 가 nullable 이라 좁혀야 컴파일된다)이고, 진입 함수 목록은 `supplier-shipment-entry.guard.spec.ts` 가 정본이다. 한진 배송 추적 폴러는
   입점사 상자를 고르지 않는다(자동 배송완료 감지는 비목표).
7. **이벤트 계약을 넓히는 것은 소비자 먼저다.** 입점사가 쓰는 택배사 8개를 `carrier` enum 에 더했지만 계약 zod 는 아직 6개다. 그 사이 창고 경로
   (송장 DTO·발송 이벤트)는 `EVENT_CONTRACT_CARRIERS` 6개만 낸다. K3 PR 3 이 소비자(channel-adapter·notification)를 먼저 배포하고 계약을 넓힌다.
8. **FO 생성은 입점사마다 draft 상자를 연다(PR 4).** `createV2` 가 직배 SKU 를 입점사별로 묶어 draft 상자 하나씩 연다(`direct-suppliers-of-skus.ts`, 입점사를 못 정하면 400 `DROP_SHIPPED_SKU_SUPPLIER_UNRESOLVED`). 입점사 상자 라인은 예약하지 않는다. 투영은 이를 `supplierLineQty` 로 «예약된 것과 같다» 고 세지만 `reserved_qty` 에는 확정 예약만 쓰고, `shipmentReservationTotalsSql` 의 «덜 예약된 상자» 정의는 입점사 상자를 `unreserved_qty = 0` 으로 본다. 새 FO 는 `drop_ship` 모드를 쓰지 않는다.
9. **입점사 상자 단계의 정의는 한 곳이다(PR 4).** `pending`(draft·복구 필요이고 넘김 없음) / `forwarded`(넘김 있음) / `shipped` — `fulfillment/shipment/supplier-shipment-stage.ts`. K6 수량 사실·정체 보드·직배 목록·채널 주소 변경의 SQL 은 같은 술어를 쓴다. 다만 보드는 복구 갈래가 먼저 잡는다 — `recovery_required` 상자(넘긴 뒤 회수 대기 포함)는 단계가 아니라 `unclassified`/`cancel` 로 보이고, «못 보냄»(`drop_ship_unfulfillable`)은 draft 상자에서만 서는 보드 상태라 TS 단계가 없다.

ADR-0049 의 «넘긴 직배 주문의 취소 알림은 상자 전 출고 명령이 쓴다»는 문장은 K3 PR 6 이 알릴 취소를 상자 후 경로로 옮길 때 고친다 — PR 2 는 동작을 바꾸지 않는다.

## Consequences
- PR 2 는 휴면이다. 입점사 상자를 만드는 코드(FO 생성, PR 4)도, 직배 SKU 도 라이브에 아직 없다(2026-10-25 실측 0).
- 창고 흐름 진입 함수를 새로 만들면 `warehouseIdOf` 로 좁히고 가드 목록에 더한다. 입점사 갈래가 필요한 함수(분할·취소·되돌리기)는 PR 5·6 이 그 앞에서 가른다.
- `shipments` 를 창고로 거르지 않고 읽는 조회(정체 보드·예약 부족 판정·리컨실러 상자 규칙 등)는 상자 기준으로 옮겼다(PR 4) — FO 단위 직배 읽기를 상자 기준 읽기로 옮겼다(PR 4). 남은 FO 단위 읽기는 옛 쓰기 경로(`direct-ship.service.ts`·`ship()`)와 그 화면용 읽기뿐이고 PR 8 이 지운다.
