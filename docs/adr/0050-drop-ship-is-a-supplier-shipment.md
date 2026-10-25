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
   복합 FK `(supplier_handoff_id, supplier_id)` 가 다른 입점사의 묶음을 막는다. 상자 상태는 K2 전이표를 쓴다 — 입점사 상자가 타는 전이는 10번(`draft → shipped`)과 12번(되돌리기 `shipped → recovery_required → draft`)이고, 취소는 창고와 같이 `canceled` 다.
   «못 보냄»도 상자 라인의 기록이다 — 취소가 아니라 수량은 그대로다.
5. **입점사 발송 시도는 원장이 없다.** `dispatch_attempts.kind` 가 `'supplier'` 면 `stock_journal_id`·`reversal_journal_id` 가 반드시 NULL 이고,
   `dispatched`·`recalled` 의 원장 요구는 `'warehouse'` 에만 걸린다. 고객 추적·발송 이벤트가 창고와 같은 모양(상자 → 시도 → 송장)으로 읽게 하려는 것이다.
6. **창고 흐름은 좁힌 곳으로만 들어온다.** 예약·예약 재시도·계획·피킹·배치·합배송·채번·발송·재고 원장은 상자의 창고 id 를 `warehouseIdOf`
   (`fulfillment/shipment/shipment-owner.ts`)로만 얻고, 입점사 상자면 거기서 409 `SUPPLIER_SHIPMENT_IN_WAREHOUSE_FLOW` 다. 1차 방어선은 타입
   (`warehouse_id` 가 nullable 이라 좁혀야 컴파일된다)이고, 진입 함수 목록은 `supplier-shipment-entry.guard.spec.ts` 가 정본이다. 한진 배송 추적 폴러는
   입점사 상자를 고르지 않는다(자동 배송완료 감지는 비목표).
7. **이벤트 계약을 넓히는 것은 소비자 먼저다.** 입점사가 쓰는 택배사 8개를 `carrier` enum 에 더했고, K3 PR 3 이 소비자(channel-adapter·notification)를
   먼저 배포하며 계약 zod(`packages/event-contracts/streams/carriers.ts` 의 `CARRIERS`)를 같은 14개로 넓혔다. PR 3 과 PR 5 사이 core 는 옛 6개만 냈고,
   PR 5 가 그 문(`CONSUMER_ROLLOUT_CARRIERS`·`isConsumerRolloutCarrier`)을 지워 core 는 14개 전부를 낸다 — 송장 DTO 도 `carrier` enum 전부를 받는다.
   enum 과 계약이 같은 값·같은 순서인지는 `carrier-contract-equality.spec.ts` 가 지킨다. 값을 또 더할 때도 소비자가 먼저 라이브여야 한다.
8. **FO 생성은 입점사마다 draft 상자를 연다(PR 4).** `createV2` 가 직배 SKU 를 입점사별로 묶어 draft 상자 하나씩 연다(`direct-suppliers-of-skus.ts`, 입점사를 못 정하면 400 `DROP_SHIPPED_SKU_SUPPLIER_UNRESOLVED`). 입점사 상자 라인은 예약하지 않는다. 투영은 이를 `supplierLineQty` 로 «예약된 것과 같다» 고 세지만 `reserved_qty` 에는 확정 예약만 쓰고, `shipmentReservationTotalsSql` 의 «덜 예약된 상자» 정의는 입점사 상자를 `unreserved_qty = 0` 으로 본다. 새 FO 는 `drop_ship` 모드를 쓰지 않는다.
9. **입점사 상자 단계의 정의는 한 곳이다(PR 4).** `pending`(draft·복구 필요이고 넘김 없음) / `forwarded`(넘김 있음) / `shipped` — `fulfillment/shipment/supplier-shipment-stage.ts`. K6 수량 사실·정체 보드·직배 목록·채널 주소 변경의 SQL 은 같은 술어를 쓴다. 다만 보드는 복구 갈래가 먼저 잡는다 — `recovery_required` 상자(넘긴 뒤 회수 대기 포함)는 단계가 아니라 `unclassified`/`cancel` 로 보이고, «못 보냄»(`drop_ship_unfulfillable`)은 draft 상자에서만 서는 보드 상태라 TS 단계가 없다.
10. **입점사 상자만 `draft → shipped` 로 간다(PR 5).** 전이표 `owner` 가 입점사 상자 전용 전이를 가르고 CAS 에 `supplier_id IS NOT NULL` 이 걸린다. 입점사 발송 시도는 원장 없이(5번) 창고와 같은 이벤트(`ShipmentShipped`·`FulfillmentShipped`)를 낸다 — 발송 뒤 효과 모듈 하나를 두 갈래가 나눠 쓴다. 창고 발송·송장·되돌리기는 입점사 상자를 못 받으므로(6번) 입점사 갈래는 «재사용»이 아니라 옆 경로다. 입점사 발송과 되돌리기는 창고처럼 같은 트랜잭션에서 FO 정합성 점검을 돌린 뒤 커밋한다. 수기 송장 번호는 쓰는 한 곳(`normalizeTrackingNo`)에서 앞뒤 공백·하이픈·내부 공백을 지우고 대문자로 바꿔 저장·비교한다. 창고의 상자 나누기(`POST /shipments/:id/split`)는 입점사 상자를 줄째로만 옮긴다 — 일부 수량을 옮기면 한 FOI 에 산 입점사 라인이 둘이 되므로 409 `SUPPLIER_SHIPMENT_PARTIAL_SPLIT` 다. 밤 대사(`FulfillmentReconciliationService`)도 TS 판정기와 같이 입점사 시도는 «원천·원장 없음»만 본다.
11. **시트는 서버가 JSON 으로 내고, 적용은 미리보기 토큰으로 묶인다(PR 5).** 응답은 `{ handoffId, fileName, columns, rows, skippedShipments }` 이고 XLSX 는 admin-web 이 만든다 — 서버가 파일을 내면 접속기록 규칙(ADR-0048 §29~36)을 손으로 다시 짜야 한다. 내려받기·다시 받기는 `@PiiResponse` + `@PiiExport`(사유 헤더 필수), 열 정의 `SUPPLIER_SHEET_COLUMNS` 는 core 한 곳이고 파서도 같은 상수를 읽는다. 파서가 읽는 머리글 일곱 개만 필수이고 중복 머리글은 400 이다. 행 키는 라인 id 가 아니라 **FOI id** 다 — 합포장이 라인을 복사해 라인 id 가 바뀐다. 줄 판정(발송·합포장·못 보냄·아직·정정·그대로·오류)은 미리보기와 적용이 같은 함수이고, 적용은 미리보기 토큰(판정 + 상자 `manifest_version` 의 sha256)과 다시 돌린 판정이 같을 때만 하며 **파일 하나 = 트랜잭션 하나**다. **(택배사, 송장) 묶음은 전부 적용하거나 전부 오류**다 — 일부만 합쳐 보내면 다음 파일의 남은 줄이 영영 막힌다. 합포장의 줄 합침 규칙은 창고 합배송과 한 helper(`shipment/merged-lines-by-foi.ts`)를 쓴다. 넘김은 수령인이 온전한 상자만 묶음에 찍고, 불완전한 상자는 대기로 남겨 `skippedShipments` 로 알린다(전부 불완전하면 409 `SUPPLIER_HANDOFF_RECIPIENT_INCOMPLETE`). 발송 기록은 이미 일어난 물리 사실이라 수령인 완전성을 다시 따지지 않는다.
12. **되돌리기는 같은 명령의 입점사 갈래다(PR 5).** 같은 라우트·`shipment.dispatch.recall`·권한이고 `report` 첫머리에서 입점사 상자를 가른다. 원장·예약·추적 게이트를 건너뛰고 한 트랜잭션에서 `shipped → recovery_required → draft`, 시도 `recalled`, 수기 송장 `voided`, FOI `shipped_qty` 감소, FO `shipped_at` NULL, 투영, `ShipmentDispatchRecalled`·`FulfillmentReopened` 를 낸다. `physicalRecoveryConfirmed` 는 그대로 요구한다(입점사와 확인함). 회수 대기가 트랜잭션 밖에 보이지 않는다. 송장 정정은 이벤트를 다시 내지 않아 Medusa 메타데이터·고객 문자는 옛 번호로 남는다 — 대신 감사 기록(`shipment.waybill.correct`, 옛→새 택배사·번호)을 같은 트랜잭션에 남긴다.

13. **넘긴 입점사 상자 라인의 취소는 상자 후 출고 명령이 알릴 취소를 쓴다(PR 6).** 직배 주문에도 상자가 있으므로 판매주문 취소는 상자 후 경로(`cancelOutstanding`)로 가고, `applyDraftCancellation` 이 줄을 줄인 같은 트랜잭션에서 `recordSupplierCancelNotices` 가 `direct_ship_cancel_notices`(`supplier_id`) 행을 남긴다. 취소 id 는 판매주문이 먼저 정해 «취소 출처» 인자로 넘긴다(요청 해시 밖 — 매번 새 uuid 라 넣으면 같은 키 재전송이 불일치가 된다). 조건은 입점사 상자 ∧ 넘김 기록 ∧ «못 보냄» 아닌 라인이고, 판매주문·FO·라인은 상자가 아니라 라인에서 읽는다(되돌린 합포장 상자는 여러 주문을 담는다). 넘긴 입점사 상자를 출처 없이 줄이거나, 입점사 상자가 손질·대기·이탈 갈래로 가면 던진다 — 입점사 상자는 배치·송장 막힘이 생길 수 없다. 옛 상자 전 쓰기(holders)는 지웠다. 알릴 취소의 읽기·내려받기·완료 표시는 입점사 id 로만 찾고, CSV 는 입점사가 받은 시트의 행 키(FOI id)·주문번호를 싣는다.

ADR-0049 의 «넘긴 직배 주문의 취소 알림은 상자 전 출고 명령이 쓴다»는 문장은 K3 PR 6 이 고쳤다(13번, ADR-0049 PR 5 문단 끝).

## Consequences
- PR 2 는 휴면이다. 입점사 상자를 만드는 코드(FO 생성, PR 4)도, 직배 SKU 도 라이브에 아직 없다(2026-10-25 실측 0).
- 창고 흐름 진입 함수를 새로 만들면 `warehouseIdOf` 로 좁히고 가드 목록에 더한다. 입점사 갈래가 필요한 함수(분할·되돌리기)는 PR 5 가 그 앞에서 갈랐다. 취소는 갈래가 필요 없었다 — 입점사 라인은 예약이 0 이라 `warehouseIdOf` 를 부르는 예약 해제에 닿지 않는다(PR 6, 통합 테스트가 증거).
- `shipments` 를 창고로 거르지 않고 읽는 조회(정체 보드·예약 부족 판정·리컨실러 상자 규칙 등)는 상자 기준으로 옮겼다(PR 4) — FO 단위 직배 읽기를 상자 기준 읽기로 옮겼다(PR 4). 남은 FO 단위 읽기는 옛 쓰기 경로(`direct-ship.service.ts`·`ship()`)와 그 화면용 읽기뿐이고 PR 8 이 지운다.
- PR 5 는 마이그 없이 Core 만 바꾼다. PR 3 이 라이브가 된 뒤에만 배포하며, 라이브 뒤에는 channel-adapter·notification 을 PR 3 이전으로 롤백하지 않는다(새 값을 거절해 DLQ 로 간다). 고객 추적 링크는 새 택배사 8개가 아직 `null` 이다 — 실물 송장으로 URL 을 확인한 뒤 더한다.
- 옛 직배 쓰기 경로(`direct-ship.service.ts` 넘김·완료, `ship()`)는 admin-web 버튼이 쓰고 있어 그대로 두었다. PR 7 이 화면을 바꾼 뒤 PR 8 이 지운다.
