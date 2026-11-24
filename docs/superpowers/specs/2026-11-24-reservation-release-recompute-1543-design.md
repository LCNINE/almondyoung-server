# 재고 예약 화면의 해제가 상자·출고주문을 함께 맞춘다 (#1543)

상위 #1544. 기준 커밋 `80ab9a2c8`.

## 왜

재고관리 → 재고 예약에서 상자 줄의 예약을 풀면 `stock_reservations` 행만 `released` 가 되고
`shipment_lines.reserved_qty`·출고주문 투영(«부분 예약» 등)은 그대로 남는다. 예약 재시도나 다른 명령이
그 상자를 건드릴 때까지 현장은 틀린 값을 본다.

원인: `DELETE /inventory/reservations/:id` → `UnifiedReservationService.releaseReservation` 은 판매 가능 수량
재계산과 줄 상태 더러움 표시만 하고 `ShipmentReservationService.recompute` 를 부르지 않는다. 그리고 fulfillment
모듈이 `CoreInventoryModule` 을 import 하므로 inventory 쪽에서 `ShipmentReservationService` 를 부를 수 없다.

## 목표

- 화면에서 상자 줄 예약을 풀면 **같은 트랜잭션에서** 그 행 `released`, 판매 가능 수량, 상자 예약 버전,
  상자 줄 `reserved_qty`, 출고주문 투영(→ 줄 상태 더러움 표시)이 함께 맞는다.
- `draft` 가 아닌 상자(피킹·포장 등 작업이 시작된 상자)의 예약은 화면에서 풀 수 없다 — 409 와 현장 말 사유.
  (사용자 결정 2026-11-24, 안 (가))

## 하지 않는 것

- admin-web 변경 없음 — URL·메서드·응답(204) 그대로. 409 의 문구를 화면에 보여 주는 개선은 #1420 몫이다.
- 해제 직후 예약 재시도 워커가 같은 재고를 다시 잡는 동작은 건드리지 않는다.
- 옛 FO 대상 예약(상자 줄 없는 행)의 해제 동작은 바꾸지 않는다.

## 방법 후보

1. **(채택)** 해제 라우트를 fulfillment 모듈 컨트롤러로 옮기고, `ShipmentReservationService` 에 «예약 행 하나
   풀기»를 새로 둔다. 고른 행을 정확히 풀고 기존 예약 명령과 같은 잠금 순서를 쓴다.
2. 라우트가 `releasePartial(줄, 그 행 수량)` 을 부른다. 코드는 가장 적지만 `releasePartial` 은 가장 오래된
   행부터 풀어서, 한 줄에 확정 행이 여럿이면(예약 옮기기로 생김) 고른 행이 아닌 행이 풀린다. 기각.
3. `recompute` 를 함수로 빼서 inventory 에서 직접 부른다. 상자 묶음·재고 잠금 순서를 건너뛰어 다른 예약 명령과
   교착 위험. 기각.

## 설계 (채택안)

- **라우트**: `DELETE /inventory/reservations/:id` 처리를 `ReservationController` 에서 빼서 fulfillment 모듈의
  컨트롤러로 옮긴다. 권한 `inventory.stock.adjust`, 204, 본문 `ReleaseReservationDto`(선택 `reason`) 그대로.
  없는 id 는 404. 컨트롤러는 try/catch 로 상태를 매핑하지 않는다(도메인 예외 → 전역 필터).
- **분기**: 행을 읽어 `targetType='SHIPMENT_LINE'` 이고 `shipmentLineId` 가 있으면 새 메서드로,
  아니면(옛 FO 대상) 지금처럼 `UnifiedReservationService.releaseReservation`.
- **새 메서드** `ShipmentReservationService` 의 행 단위 해제 — `releasePartial` 과 같은 순서:
  줄 맥락 읽기 → 상자 묶음 잠금 → 맥락 재확인 → `draft` 확인(아니면 409) → `(sku, 창고)` 재고 잠금 →
  잠금 아래서 그 행이 아직 `confirmed` 인지 다시 읽기(이미 풀렸으면 409) → `released`·`stateReason`·
  `invalidatedAt` 기록 → 판매 가능 수량 재계산 → 예약 버전 올림 → `recompute`.
  `stateReason` 은 본문 `reason` 이 있으면 그것, 없으면 고정 기본값(관리자 해제임을 알 수 있는 값).
- **재발 막기**: `UnifiedReservationService.releaseReservation` 은 상자 줄 예약 행을 받으면 거절한다.
  지금 이 메서드를 부르는 곳은 옛 FO 예약 정리(`ReservationLifecycleService`)와 deprecated
  `StockEventService.releaseReservation` 뿐이다. 거절하면 그 안의 `markLineStateDirtyForShipmentLines` 호출은
  죽은 코드가 되므로 지운다 — 새 경로에선 `recompute` → `reprojectFulfillmentOrders` 가 표시한다.

## 함께 고칠 스펙

- `line-state-dirty.guard.spec.ts` — 세 번째 표시 지점(Unified 해제) 단언을 새 경로 기준으로 바꾼다.
- `line-state-dirty.integration.spec.ts`·`unified-reservation.service.lifecycle.integration.spec.ts` — 상자 줄 예약을
  Unified 로 풀던 케이스를 새 메서드로 옮기거나 «거절된다»로 바꾼다.
- `route-classification.spec.ts` 등 라우트 게이트가 옮긴 라우트를 그대로 인정하는지 확인한다.

## 완료 판정

- 통합 스펙: 5개 줄에 1개 잡힌 상자 예약을 행 id 로 풀면 같은 트랜잭션 안에서 행 `released`, 줄 `reserved_qty` 0,
  출고주문 투영이 «예약 없음» 쪽으로 바뀌고, 줄 상태 더러움 표시가 하나 더해진다.
- `draft` 아닌 상자의 행 → 409, 아무것도 바뀌지 않는다. 이미 풀린 행 → 409. 없는 id → 404.
- `npm run type-check`·`npx jest` 0.

## 빌더에게 남긴 것

- 옮겨 갈 fulfillment 컨트롤러의 선택(기존 컨트롤러에 더할지 새 파일일지), 기본 `stateReason` 문자열,
  409 문구.
- 배포: 마이그 없음, core 만.
