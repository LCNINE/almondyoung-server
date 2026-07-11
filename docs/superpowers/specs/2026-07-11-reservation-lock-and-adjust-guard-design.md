# 작업 10 — 예약 TOCTOU 잠금 + ON_HAND 감소 예약 가드 설계 (WS-C)

> 스프린트 현황판: `docs/logistics-backend-hardening-2026-07.md` §5 WS-C 작업 10.
> 관련 결함: **P1-4**(reserve TOCTOU 초과판매), **P1-5**(adjustDown 이 예약 무시 → `on_hand<reserved`).
> 성격: **잠금·가드 한 세트 · 스키마·마이그레이션 무변경**(작업 4·5·6·7 판례). dev DB 없이 머지 가능, 통합 테스트만 dev DB 복구 시(⏸).
> 목적: `available` 을 소비하는 모든 경로를 `(sku, warehouse)` 단위로 **직렬화**하고, ON_HAND 를 예약 해제 없이 줄이는 경로에 **불변식 가드**를 세운다.

---

## 1. 배경

WS-C(예약 보강)의 코어. 작업 9 가 예약 진입점 표면을 축소(직행 `POST /inventory/reservations` 은퇴, dead 메서드 5종 삭제)한 위에서, 남은 라이브 경로에 잠금과 가드를 넣는다.

지키려는 **불변식**: `(sku, warehouse)` 단위로 **`SUM(ON_HAND 원장) ≥ SUM(confirmed 예약)`**. 이게 깨지면(`on_hand<reserved`) 그 예약을 출고 소진할 때 차감할 ON_HAND 가 없어 FIFO 가 throw(일반 Error=500) → tx 롤백 → **해당 박스 영구 출고 불가**.

P1-4 와 P1-5 를 **한 세트**로 묶는 이유: 둘 다 이 불변식을 깨며, **같은 `(sku, warehouse)` 잠금을 공유**해야 직렬화된다. P1-4 는 reserve↔reserve 레이스, P1-5 는 adjustDown↔reserve 레이스 — 셋(reserve·adjustDown·transferShip)이 같은 락을 잡아야 서로 못 끼어든다.

## 2. 착수 재확인으로 확정한 사실 (2026-07-11, develop @ `d3412b882`)

- **작업 9 머지 확인**: `AllocationStrategyService`·`adjustReservationOnQuantityChange`·`handleMovementTaskStatusChange`·`ReserveStockDto`(컨트롤러)·`ReservationTargetType` 전역 참조 0 → squash 머지 완료. 직행 예약 라우트 부재 재확인.
- **P1-4 재현**: `reserveStock`(`unified-reservation.service.ts:56-87`)은 `getAvailableStock`(`:215`, ON_HAND 원장 합 − confirmed 예약 합) 읽고 → `INSERT` 까지 **락 전무**. READ COMMITTED 라 두 tx 무충돌 커밋 = 초과예약.
- **reserve 라이브 진입점(작업 9 후)**: `FulfillmentReservationsFacade.reserve`(`fulfillment-reservations.facade.ts:92`, 컨트롤러·retry worker 경유) + `fulfillments.service.ts:805`(`tryReserveItems`). 둘 다 `unified.reserveStock` 도달. `tryReserveItems`(`:796`)는 **items 순서 멀티-SKU 루프** = 교차 데드락 근거.
- **P1-5 재현**: `adjustDown`(`inventory-command.service.ts:366-477`)은 **location grain** ON_HAND 만 검증(`:412-427`), 예약 무시. `adjustDown` 라이브 호출자 3곳: 수동 조정 API(`inventory.controller.ts:38`) · 파손 `processDamage`(`stock-event.service.ts:186`) · 실사 `completeSession`(`stocktaking.service.ts:438`).
- **`completeSession`(`stocktaking.service.ts:392-467`)**: 단일 tx, session·lines `FOR UPDATE`, variance 라인마다 `adjustUp/adjustDown`(line.locationId) **원자 적용** → 한 라인 throw = 세션 전체 롤백.
- **transferShip 도 불변식 위반 경로**: `transferShip`(`inventory-command.service.ts:196-230`)이 ON_HAND→IN_TRANSFER 로 출발창고 ON_HAND 를 예약 해제 없이 감소. 라이브 배선: `inventory/transfers`(admin-web) → `transferBetweenWarehouses`(`stock-event.service.ts:105`) → `transferShip`(`:125`). **작업 6 이 살린 Path B**.
- **집계 부품 존재**: `getTotalReservedQuantity(skuId, warehouseId, tx)`(`unified-reservation.service.ts:155`) — 창고 grain confirmed 예약 합. 단 core 의 `adjustDown` 은 `stockReservations` 직접 쿼리로 계산(주입 순환 회피).
- **가용 정의 3종**: `getAvailableStock`(unified) ≈ `AvailabilityService.getAvailableQuantity`(`availability.service.ts:10`) = ON_HAND−reserved(transit_out 미차감) vs 뷰 `stock_summary.availableQty`(`inventory.schema.ts:882`) = ON_HAND−reserved−transit_out. `transit_out`(`:920-933`)은 **IN_TRANSFER 원장이 아니라** pending 이송 inbound_plan(`expected−received`, W11 크로스보더)에서 계산.
- **`ship()`(`inventory-command.service.ts:108`, "예약 없이 직접 출고")는 라이브** — `outbound-consumption.service.ts:98`(SHIP 소진)이 호출(최초 서술 "dead" 정정, 최종리뷰). 락 미획득이나 on_hand·reserved 를 함께 감소 → reserve/guard 의 available 읽기가 **단일 스냅샷**이면 무해(§5·최종리뷰 I-1 참조).
- **스키마 무변경**: 잠금=advisory(스키마 불요), 가드=기존 테이블 쿼리, drift=쿼리, bypass=코드 파라미터. 마이그레이션 없음.

## 3. 결정 (브레인스토밍, 2026-07-11)

### 3.1 가드 범위(Q3) — adjustDown + transferShip, transfer=출고

`available`(미예약 ON_HAND)을 소비하며 예약을 해제하지 않는 경로 둘 다 능동 가드. **transfer 는 출발지 관점의 출고** → available 만 이동, 예약분은 못 건드림(초과 시 reject). 예약 이관(작업 9 에서 삭제된 `transferReservation`)은 **부활 안 함** — transfer 가 available 만 옮기므로 이관할 예약이 애초에 없음(작업 9 삭제와 일관).

### 3.2 실사 정책(Q1) — 실물 우선 + drift 탐지, 예약 자동해제 이연

실사 카운트가 예약보다 적음 = **그 재고는 물리적으로 이미 없음**. 어떤 처리도 그 FO 를 출고 가능하게 만들 수 없다. 셋 중 **"실물 반영 + 대사잡 감지"** 선택:
- `completeSession` 은 가드를 **bypass** 하고 실측 delta 를 그대로 적용(`on_hand<reserved` 허용), 예약 무터치.
- 대사잡에 `on_hand<reserved` 감지 축 추가(+완료 시점 인라인 신호). **예약 자동 해제·초과예약 조회 화면은 WS-D 후속**(silent 아님 — 문서 명시).

### 3.3 파손 = 실물 버킷 (bypass)

`adjustDown` 3 호출자의 가드 분류:
- **guard(reject) = 기본값**: 수동 조정 API(운영자 재량 감소) · `transferShip`(출고성 이동).
- **bypass(실물 우선) = 명시 플래그**: `completeSession`(실사) · `processDamage`(파손). 파손도 물리적 사실(물건이 깨져 없어짐)이라 reject 는 원장을 거짓 유지시킬 뿐 — 실사와 동일 취급.
- **bypass 는 THROW 만 건너뜀. 락은 여전히 획득**(직렬화·drift 일관성 유지).

### 3.4 잠금(Q2) — advisory xact lock + shared 헬퍼 + 정렬 내장 배치형

- **프리미티브**: `pg_advisory_xact_lock` 키 = `hashtext('${skuId}:${warehouseId}')` (선례 `product-sellable-quantity.service.ts:272` 미러 — 구현 시 `hashtextextended` 에서 `hashtext` 로 확정). 불변식이 물리 row 없는 `(sku,warehouse)` **논리 집계**라 advisory 가 적합(예약은 INSERT 라 FOR UPDATE 앵커 row 없음). tx 종료 시 자동 해제. 충돌은 32-bit(birthday ~77k) 라도 드문 오탐 직렬화만(정확성 안전).
- **위치**: `inventory/shared` 무상태 헬퍼 한 곳(키 파생 단일화). core 는 이미 shared 를 import(`OutboxService`) → 순환 없음.
- **정렬**: 멀티키 tx 는 정렬 내장 배치 헬퍼로 일괄 획득 → 규율 누수 없음.

### 3.5 가용 정의(Q4) — reserve-time 유지, 통일은 W11

reserve-time 은 transit_out 무시 유지. **Q3 가드가 불변식 백스톱**이라 "먼저 커밋한 쪽이 이김"이 성립(firm 예약 > 미실행 이송 plan). 통일의 올바른 방법은 "**이송을 실제 예약으로 모델링**"(삭제된 MOVEMENT_TASK 예약 계열)이며 W11(이송 재설계)과 한 몸 → 이연. 단 문서로 목표 모델 명시.

## 4. 스코프 — 변경 사항

### A. 공유 잠금 헬퍼 (신규, `inventory/shared`)

`inventory/shared/locks/stock-availability-lock.ts` (또는 동급 위치):

```ts
// 단일 (sku,warehouse) advisory xact lock. tx 종료 시 자동 해제.
export async function acquireStockAvailabilityLock(
  trx: DbTx, skuId: string, warehouseId: string,
): Promise<void> {
  await trx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`${skuId}:${warehouseId}`}))`,
  );
}

// 멀티키: (skuId, warehouseId) 오름차순 정렬 + dedup 후 순차 획득 → 교차 데드락 방지.
export async function acquireStockAvailabilityLocks(
  trx: DbTx, pairs: { skuId: string; warehouseId: string }[],
): Promise<void> { /* 정렬·dedup·루프 */ }
```

- 무상태 함수(DI 없음, `trx` 스코프). 정렬·키 파생은 여기에만 존재.

### B. 잠금 배선

**단일-op 진입점 (내부에서 단일 락 획득):**
- `UnifiedReservationService.reserveStock`(`:57`): `run` 콜백 진입 직후 `acquireStockAvailabilityLock(trx, dto.skuId, dto.warehouseId)` → 기존 available 확인 + INSERT.
- `InventoryCommandService.adjustDown`(`:379`): `exec` 진입 직후 락(effectiveLocationId 결정 전에도 sku·warehouse 는 확정) → 가드(§C) → 이벤트.
- `InventoryCommandService.transferShip`(`:209`): `exec` 진입 직후 락 → 가드(§C) → 이벤트.

**멀티키 tx (배치 헬퍼로 up-front 일괄 획득):**
- `fulfillments.service.tryReserveItems`(`:796`): 루프 전에 `items` 의 `{skuId, warehouseId}` 집합으로 배치 락. (내부 `reserveStock` 의 단일 락은 같은 tx 재획득 = 무해.)
- `fulfillment-order-reservation-retry.worker.retryOne`: FOI 부족분 집합으로 배치 락(단일 FO 라 warehouseId 동일, skuId 다수).
- `stocktaking.completeSession`(`:392`): variance 라인 로드 후, 라인들의 `{skuId, warehouseId=session.warehouseId}` 집합으로 배치 락(기존 session·lines `FOR UPDATE` **이후**, 라인별 adjustDown **이전**).

### C. 예약 불변식 가드 (`InventoryCommandService` private)

`adjustDown`·`transferShip` 공용 private 헬퍼:

```ts
// 락 획득 후 호출. 창고 합산 불변식.
private async assertReservationInvariant(
  trx: DbTx, skuId: string, warehouseId: string, removingQty: number,
): Promise<void> {
  const onHandSum = /* SUM(stockLedgers.qty) WHERE sku,wh,ON_HAND */;
  const reservedSum = /* SUM(stockReservations.quantity) WHERE sku,wh,confirmed */;
  if (onHandSum - removingQty < reservedSum) {
    throw new ConflictError(
      `예약된 재고는 감소/이동할 수 없습니다. 창고 ON_HAND ${onHandSum} − ${removingQty} < 예약 ${reservedSum}`,
    );
  }
}
```

- **창고 합산** 형태(예약은 sku×warehouse grain, adjustDown/transferShip 은 location 에서 차감하지만 비교는 창고 총합).
- 예약 합은 `stockReservations` **직접 쿼리**(core → shared 주입 회피).
- **bypass 파라미터**: `adjustDown` input 에 `bypassReservationGuard?: boolean` 추가. `completeSession`·`processDamage` 만 `true`. 수동 조정 API·transferShip 은 미전달(가드 적용). bypass 여도 §B 락은 획득.
- 기존 location 단위 부족 검증(`adjustDown:412-427`)은 **존치**(원장 per-row 음수 방지). 신규 가드는 그 위에 창고합산 예약 체크를 추가.

### D. drift 감지 확장 (`LedgerReconciliationService`, 작업 2 확장)

- 기존 events↔ledgers 대사에 **`on_hand<reserved` 감지 축 추가**: `(sku, warehouse)` 별 `SUM(ON_HAND 원장) < SUM(confirmed 예약)` grain 을 산출.
- **raw 합 비교** — 뷰 `availableQty`(transit_out 반영) **사용 금지**(거짓 경보 방지, §3.5). 원장·예약 테이블 직접 집계.
- 노출: 기존 야간 크론(03:00 KST) + 온디맨드 엔드포인트에 편승. Prometheus 게이지(예: `wms_reserved_over_onhand_grains`, severity 라벨, 정상 시 0 명시 set) — 작업 2 게이지 패턴 재사용.
- **인라인 신호(포함)**: `completeSession` 이 bypass 로 적용 후, 방금 조정한 `(sku,wh)` 가 `on_hand<reserved` 면 즉시 `logger.warn`(sku·창고·on_hand·reserved 포함) — 야간 크론까지 안 기다림. 저비용이라 본 작업에 포함.

## 5. 불가침 (라이브 — 회귀 가드)

- **락 면제 경로**(불변식 무해 — 문서 근거 남김):
  - **SHIP 소진**(`outbound-consumption:98` → `inventoryCommand.ship()`, 라이브): on_hand·reserved 를 함께 감소(reserved→shipped) → available 불변이라 **락 없이도 불변식 무해**. 단 전제조건: reserve/guard 의 available 읽기가 **단일 스냅샷**이어야 함 — 2-statement 읽기면 SHIP 커밋이 두 읽기 사이 끼어 torn read(초과예약) 발생. 최종리뷰 I-1 로 `getAvailableStock`·`getWarehouseReservationBalance` 를 단일 statement 화하여 해소.
- **알려진 미가드 잔여(WS-D — 최종리뷰 I-2)**: `reverseEvent`(`stock-event.store.ts:300`, RECEIVE→ADJUST_DOWN projection 직접 적용 — `InventoryCommandService` 우회로 락·가드 모두 없음)가 당일 입고취소(`inbound.service.ts:1010`)·`stock-projection.manager.ts:10` 로 라이브. 예약 걸린 당일 입고분 취소 시 on_hand<reserved 가능. **능동 가드 안 함**(lower-level 프리미티브·좁은 경로) — 대사잡 게이지 `wms_reserved_over_onhand_grains` 가 탐지, 능동 처분은 WS-D 잔여.
  - **`transferReceive`**(`:232`): ON_HAND 증가.
  - **`moveInternal`**(`:479`): 창고 내 이동, 창고 합 불변.
  - **`releaseReservation`·`releaseExpiredReservations`**: available 증가.
  - **`adjustUp`**: ON_HAND 증가.
- **가드 미적용(정상)**: 수동 조정 API 의 adjustUp, transferReceive — ON_HAND 를 안 줄임.
- `reserveStock` 코어 로직(available 확인 + INSERT + sellable 재계산) 계약 유지 — 락은 그 **앞**에 추가만.
- `completeSession` 의 세션 상태기계·원자성·멱등(`onConflictDoNothing`, 작업 1) 유지 — 배치 락·bypass 는 그 안에 얹음.

## 6. 경계 (W11 / WS-D 분리 — 손대지 않음)

- **WS-D / 작업 11 소유**: 실사·파손발 `on_hand<reserved` 의 **예약 자동 해제**, FO unfulfillable 다운스트림(재소싱·백오더·알림), 초과예약 조회 화면/알림. 본 작업은 **탐지 신호까지만**.
- **W11 소유**: 가용 정의 통일, 이송=예약 모델링, transit_out 신뢰화(멈춘 destination 플랜), retry worker under-selection 교정.
- **작업 11 소유**: timeout 기계(`timeoutAt`·만료 크론·expire-stale), 좀비 예약 대사.

## 7. 비목표 (out of scope)

- 예약 자동 해제, unfulfillable 처리, 조회 UI(§6).
- 가용 정의 변경/뷰 통일, transit_out 반영(§3.5, W11).
- 스키마 변경/마이그레이션 — 없음. `stockReservations`·`stockLedgers` 무변경.
- SHIP 소진·moveInternal·release 경로 로직 변경(락 면제).
- P2-1 라인 단위 소진(작업 12), unrelated 리팩터.

## 8. 리스크 / 검증

- **advisory 락 규율 의존**: DB CHECK 로 강제 불가 → 새 ON_HAND 감소/예약 경로가 락을 빠뜨릴 위험. 완화: 락·가드를 `reserveStock`/`adjustDown`/`transferShip` 세 지점에 봉인(신규 경로는 이 셋 중 하나 경유가 컨벤션), arch 경계 spec(`inventory-write-boundary.arch.spec.ts`)에 "on_hand 감소 write 는 헬퍼 참조" 베스트-에포트 체크 추가 검토.
- **데드락**: 멀티키 tx 3종(tryReserveItems·retry·completeSession)이 배치 헬퍼 정렬 획득 → 교차 데드락 불가. 단일-op 는 락 1개라 무관. 배치와 내부 단일 락의 키 중복은 같은 tx 재획득 = 무해.
- **성능**: advisory 락은 row 락 아님(리더 미차단). 경합은 동일 `(sku,wh)` 동시 쓰기에만. 무시 가능.
- **검증 게이트**: `nest build core` exit 0 · arch 경계 spec PASS · fulfillment/inventory 단위 spec GREEN · 변경 파일 신규 eslint 0. 스키마 무변경이라 dev DB 의존 ⏸ 없음(단 §9 통합은 dev DB).

## 9. 테스트

**단위:**
- 배치 락 헬퍼: 정렬·dedup 순서 단언.
- 가드: adjustDown/transferShip 이 `on_hand−removing < reserved` 에서 `ConflictError`. bypass=true 면 미throw.
- 가드 미적용: reserved=0 이면 통과. adjustUp/transferReceive 무영향.

**통합(dev DB 복구 시 ⏸):**
- **TOCTOU**: available=10 에 동시 reserve 10×2 → 정확히 1건 성공, 1건 Conflict(락 직렬화).
- **transferShip 예약 거부**: 전량 예약된 sku 이동 시도 → reject, 원장 불변.
- **adjustDown**: 예약 초과 감소 → reject. bypass → 적용 + drift grain 산출.
- **실사**: 예약 걸린 sku 실물<예약 카운트 → 실물 적용(on_hand<reserved) + drift 감지 + 인라인 warn.
- **데드락 부재**: 두 tx 가 겹치는 SKU 를 반대 입력 순서로 예약 → 배치 정렬로 데드락 없이 직렬 완료.

## 10. 제안 브랜치/커밋

- 브랜치 `feat/reservation-lock-and-adjust-guard`.
- 커밋 슬라이스(SDD): (1) `[inventory]` 공유 락 헬퍼 (2) `[inventory]` reserve/adjustDown/transferShip 락+가드+bypass (3) `[fulfillment]` 멀티키 배치 락 배선(tryReserveItems·retry) (4) `[inventory]` completeSession 배치 락+bypass (5) `[inventory]` 대사잡 on_hand<reserved 축 (6) 문서(현황판 작업 10 완료 기록 + Q4 목표모델 주석).
- 스키마 무변경 → 단일 PR, expand-contract 불요.
