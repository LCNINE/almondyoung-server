# 작업 9 — dead 예약/할당 표면 소거 설계 (WS-C)

> 스프린트 현황판: `docs/logistics-backend-hardening-2026-07.md` §5 WS-C 작업 9.
> 관련 결함: P2-9(절제), dead 예약 메서드 소거, `POST /inventory/reservations` 직행 처분.
> 성격: **순수 삭제 위주 저위험 1 PR · 스키마·마이그레이션 무변경** (작업 4·5·6 판례).
> 목적: 작업 10(P1-4+P1-5 잠금·가드)이 방어할 **예약 진입점 표면을 미리 축소**한다.

---

## 1. 배경

WS-C(예약 보강)의 첫 단계. 예약 코어(`UnifiedReservationService.reserveStock`)에 잠금을 넣기(작업 10) 전에, 그 코어를 우회하거나 죽어 있는 진입점·메서드·서비스를 먼저 걷어낸다. 진입점이 적을수록 작업 10의 잠금 설계가 단순해지고, 방어 안 되는 우회로가 남지 않는다.

## 2. 착수 재확인으로 확정한 사실 (2026-07-11, develop @ `0ec29f19e`)

- **직행 `POST /inventory/reservations`**: admin-web 호출 0 (admin-web reservations.client 는 by-target·by-sku·summary·`DELETE :id`·expire-stale 만 사용).
- **`AllocationStrategyService`**: 내부 서비스 호출자 0. `allocateStock`·`getTotalAvailableQuantity`·`getAvailableQuantityByWarehouse` 는 **오직 `reservation.controller` 2개 라우트에서만** 사용. `getAvailableLocations` 호출자 0. `stock-event.service.ts:22` 주입은 본문 미사용(dead 주입).
- **dead 예약 메서드 (호출자 0)**: `StockEventService.reserveStock`(deprecated 래퍼) · `UnifiedReservationService.transferReservation` · `ReservationLifecycleService.adjustReservationOnQuantityChange`.
- **MOVEMENT_TASK 예약 = 완전 vestigial**: 예약 **생산자 0**(movement 서비스는 예약을 안 함). reader 체인 `handleMovementTaskStatusChange`(호출자 0) → `releaseMovementTaskReservations`(private, 호출자 = 죽은 상위뿐) 도 dead. MOVEMENT_TASK 예약을 만들 수 있던 유일 경로가 직행 엔드포인트(FE 0)였음.
- **테스트 영향 최소**: 삭제 대상 심볼을 참조하는 `*.spec.ts` 0. `reservation-lifecycle.service.spec.ts` 부재. (fulfillment spec 이 참조하는 `reserveStock`/`transferReservation` 은 **라이브 동명이인** — unified 코어·facade — 이며 삭제 대상 아님.)

## 3. 현황판 대비 정정 2건

1. **P2-9 "allocate 로만 노출" 은 부정확** — `GET /inventory/reservations/available/:skuId` 도 `AllocationStrategyService`(`getTotalAvailableQuantity`/`getAvailableQuantityByWarehouse`)에 물려 있다. 서비스를 지우려면 **두 라우트를 함께 은퇴**해야 한다(둘 다 FE 0). 이 서비스가 갖던 어긋난 "available 정의"(ON_HAND−예약, transit_out 미차감)도 함께 소멸 → 작업 10이 조율할 "가용 정의 불일치"가 하나 줄어든다.
2. **dead 예약 메서드는 "3종"이 아니라 5종** — 현황판이 명시한 3종 외에 MOVEMENT_TASK 라이프사이클 쌍(`handleMovementTaskStatusChange`·`releaseMovementTaskReservations`)이 같은 vestigial 계열로 추가된다.

## 4. 결정 (브레인스토밍, 2026-07-11)

- **직행 예약 엔드포인트 → 완전 은퇴.** `POST /inventory/reservations` 라우트 + 컨트롤러 DTO 제거. 근거: FE 미사용, FULFILLMENT_ORDER 예약은 전부 FO 자동경로(`tryReserveItems`·facade·retry worker)로 생성됨, 직행은 facade 불변식·FOI reservedQty 갱신 없이 그걸 중복하는 "최악 진입점". MOVEMENT_TASK 는 죽음. "facade 강제"는 FO→FOI 중심 facade 특성상 FO 없는 수동/MOVEMENT_TASK 예약에 부적합 → 기각. 수동 예약 능력이 훗날 필요하면 규칙 준수로 신규 작성(작업 4·5·6 철학).
- **MOVEMENT_TASK 잔재 → 타입까지 좁힘.** dead 메서드 삭제 후 남는 `'FULFILLMENT_ORDER' | 'MOVEMENT_TASK'` 유니온·`ReservationTargetType` enum 을 `'FULFILLMENT_ORDER'` 단일로 축소. TS 전용·비파괴(`stockReservations.targetType` 은 varchar 컬럼이라 스키마·데이터 무변경).

## 5. 스코프 — 삭제/은퇴

### A. 직행 예약 은퇴
- `reservation.controller.ts`: `reserveStock` 핸들러(`@Post()`, 라우트 `POST /inventory/reservations`) 삭제.
- `dto/reservation/reserve-stock.dto.ts`: `ReserveStockDto` **클래스**(:9) 삭제 + `ReservationTargetType` enum(:4) 삭제.
  - **불가침**: 같은 파일의 `ReleaseReservationDto`(:138) 는 `DELETE :id` 라우트가 사용 → 존치.
  - **불가침(동명이인)**: `unified-reservation.service.ts:7` 의 `export interface ReserveStockDto` 는 서비스 메서드 시그니처(FO 자동경로가 사용) → 존치, targetType 만 narrowing(§D).

### B. `AllocationStrategyService` 절제 (P2-9)
- `allocation-strategy.service.ts` 파일 삭제.
- `inventory.module.ts`: import(:23) · provider(:59) · export(:77) 제거. `ReservationController` 는 존치(조회 라우트 유지).
- `stock-event.service.ts`: import(:11) + 생성자 주입(:22) 제거(dead 주입).
- `reservation.controller.ts`: `POST allocate` 핸들러 + `GET available/:skuId` 핸들러 삭제, `AllocationStrategyService` import/주입 제거.

### C. dead 예약 메서드 5종 삭제
- `StockEventService.reserveStock` (`stock-event.service.ts:90`, `@deprecated`).
- `UnifiedReservationService.transferReservation` (`unified-reservation.service.ts:116`). ← facade 의 동명 메서드는 라이브, 불가침.
- `ReservationLifecycleService.adjustReservationOnQuantityChange` (`reservation-lifecycle.service.ts:130`).
- `ReservationLifecycleService.handleMovementTaskStatusChange` (`:45`) + `releaseMovementTaskReservations` (private, `:115`).

### D. MOVEMENT_TASK 타입 narrowing (TS 전용)
- `unified-reservation.service.ts:8` `ReserveStockDto.targetType`: 유니온 → `'FULFILLMENT_ORDER'`.
- `dto/reservation/reservation-response.dto.ts:12` `ReservationDto.targetType`: swagger enum + TS 타입 narrowing.
- `dto/reservation/reserve-stock.dto.ts`: `ReservationTargetType` enum 삭제(§A 와 동일).
- `schema/inventory.schema.ts:1327` `target_type` varchar 주석 갱신(값 제약 아님, 주석만).
- 주의: `getReservationsByTarget(targetType: string)` 등 `string` 시그니처는 유니온이 아니므로 무변경.

### E. dead DTO 부분 삭제 (파일 통삭제 아님 — 유지 export 존재)
- `reserve-stock.dto.ts`: `AllocateStockDto`(:79) 삭제. (`ReserveStockDto`·`ReservationTargetType` 은 §A. `ReleaseReservationDto` 존치.)
- `reservation-response.dto.ts`: `AllocationResultDto`(:110) + 그 전용 nested `AllocationLocationDto`(:82) 삭제, `AvailableStockResponseDto`(:210) + 전용 nested `AvailableQuantityDto`(:190) 삭제. **존치**: `ReservationDto`·`ReservationSummaryDto`·`ReservationSummaryTargetDto`(유지 라우트 사용). ⟶ 구현 시 nested DTO 배타성(부모 1개만 참조) 재확인 후 삭제.

### F. 잔존 주석 정정 (dangling 참조 제거, 계약 근거는 보존)
- `fifo-allocate.ts:9` · `location-resolution.strategy.ts:23`: 삭제된 `AllocationStrategyService` 를 문장으로 참조. **`fifoAllocate` 가 raw ON_HAND 만 보는 "불가침 계약"(available 쓰면 예약 동시 소진 경로에서 이중차감)** 설명 자체는 P2-9 노트가 강조한 핵심이므로 **삭제 금지** — 삭제된 클래스명 참조만 지우고 "available(=on_hand−reserved) 기반 할당을 쓰면 이중차감" 취지로 rephrase.

## 6. 불가침 (라이브 — 회귀 가드)

- `UnifiedReservationService`: `reserveStock`(코어) · `releaseReservation` · `getReservationsByTarget` · `getReservationsBySku` · `getReservationSummary` · `releaseExpiredReservations` · 인터페이스 `ReserveStockDto`(targetType narrowing 만).
- `FulfillmentReservationsFacade.transferReservation`(라이브).
- `ReservationLifecycleService`: `handleFulfillmentOrderStatusChange`(cancel 경로 3곳) · `consumeFulfillmentOrderReservations`(출고소진).
- `reservation.controller` 유지 라우트: `DELETE :id` · `GET by-target` · `GET by-sku/:skuId` · `GET summary/:warehouseId` · `POST expire-stale`.

## 7. 경계 (작업 10/11 과의 분리)

- **작업 10**: 본 작업 후 `reserveStock` 라이브 진입점 = FO 자동경로(`tryReserveItems`·facade·retry worker)뿐. 작업 10은 `reserveStock` 내부 sku×warehouse 잠금 하나로 전 진입점 커버.
- **작업 11 소유 — 손대지 않음**: `POST expire-stale`(FE 라이브) · `timeoutAt` 컬럼 · 10분 만료 크론. 직행 은퇴로 `timeoutAt` 세터가 사라지지만 어차피 FE 미사용 — timeout 기계의 존치/절제는 작업 11 결정. 본 작업은 `timeoutAt` 컬럼·크론·expire-stale 을 **건드리지 않는다**.

## 8. 비목표 (out of scope)

- `reserveStock` 잠금/가드(작업 10), timeout 기계 정리(작업 11).
- 스키마 변경/마이그레이션. `stockReservations.targetType` varchar 는 데이터·제약 무변경(narrowing 은 TS·주석만).
- unrelated 리팩터.

## 9. 리스크 / 검증

- **최대 리스크 = 동명이인 오삭제.** 파일 경로로 엄격 구분:
  - `ReserveStockDto`: 컨트롤러 DTO 클래스(`dto/…/reserve-stock.dto.ts`, 삭제) vs 서비스 인터페이스(`unified-reservation.service.ts:7`, 존치).
  - `reserveStock`: `UnifiedReservationService`(코어, 존치) vs `StockEventService`(deprecated 래퍼, 삭제).
  - `transferReservation`: `FulfillmentReservationsFacade`(라이브, 존치) vs `UnifiedReservationService`(dead, 삭제).
- 순수 삭제·스키마 무변경 → **dev DB 의존 ⏸ 항목 없음**(작업 4·5·6 과 동일).
- 검증 게이트: `nest build core`(tsc/webpack) exit 0 · arch 경계 spec(`inventory-write-boundary.arch.spec.ts`) PASS · 삭제 심볼 저장소 전역 참조 0 · fulfillment 단위 spec PASS(라이브 reserveStock/transferReservation 목업 무영향) · admin-web `type-check` 신규 에러 0(유지 라우트 무변경, 은퇴 라우트 FE 0) · 변경 파일 신규 eslint error 0.
- admin-web: 은퇴 라우트(reserve POST·allocate·available) FE 호출 0 → 클라이언트 수정 불요. reservations.client 의 유지 라우트만 사용하므로 무영향.

## 10. 테스트

- 삭제 위주라 신규 테스트 최소. 회귀 커버는 기존 arch spec + fulfillment 단위 spec + `nest build` 로 충분.
- 라우트 은퇴는 라우트 자체 제거(404 자연 발생)라, 작업 7 식 "미광고 회귀 가드"는 불필요.
- 선택(있으면 좋음): `reservation.controller` 유지 라우트가 여전히 컴파일·응답 형태 유지되는지 확인하는 가벼운 컨트롤러 스펙 — 필수 아님.

## 11. 제안 브랜치/커밋

- 브랜치 `feat/dead-reservation-surface-sweep`.
- 커밋 분할(선택): `[inventory]` AllocationStrategyService 절제 + dead 메서드 / `[inventory]` 직행 은퇴 + DTO/타입 narrowing. 또는 단일 커밋(순수 삭제라 무방).
