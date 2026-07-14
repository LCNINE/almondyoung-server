# 작업 10b — reverseEvent 락·가드 배선 설계 (WS-C 후속 미니)

> 스프린트 현황판: `docs/logistics-backend-hardening-2026-07.md` §5 WS-C/WS-D 착수 노트 (작업 10 최종리뷰 I-2, 범위 결정 2026-07-12 처분 ①).
> 관련 결함: 작업 10 이 `adjustDown`·`transferShip`·reserve 를 `(sku,warehouse)` 락+예약 가드로 봉했으나, **`reverseEvent`(`stock-event.store.ts:300`)가 그 둘을 우회**하는 잔여 경로로 남음(I-2).
> 성격: **락·가드 배선 · 스키마·마이그레이션 무변경**(작업 4·5·6·7·9·10 판례). dev DB 없이 머지 가능, 통합 테스트만 dev DB 복구 시(⏸).
> 목적: `reverseEvent` 가 ON_HAND 를 **순감소**시키는 방향일 때만 작업 10 의 `(sku,warehouse)` 락 + 창고합산 예약 불변식 가드를 적용해, 예약 걸린 재고의 역분개를 차단한다.

---

## 1. 배경

작업 10(예약 잠금 + ON_HAND 감소 가드)의 최종리뷰(opus)가 `reverseEvent` 를 **알려진 미가드 잔여**로 명시(I-2). 작업 10 은 `StockEventStore.createEvent` 를 저레이어 프리미티브로 남기고 락·가드를 `InventoryCommandService`(adjustDown/transferShip)에 얹었는데, `reverseEvent` 는 `InventoryCommandService` 를 거치지 않고 store 에서 projection 을 **직접** 적용하는 별도 경로라 락·가드가 둘 다 없다.

지키려는 **불변식**(작업 10 과 동일): `(sku, warehouse)` 단위 **`SUM(ON_HAND 원장) ≥ SUM(confirmed 예약)`**. 깨지면 그 예약을 출고 소진할 때 차감할 ON_HAND 가 없어 FIFO throw(500) → 해당 박스 영구 출고 불가.

`reverseEvent` 는 원 이벤트의 방향을 **반전**(rev.fromState = original.toState, rev.fromWarehouseId = original.toWarehouseId)해 상쇄 이벤트를 만든다. 따라서 역분개가 ON_HAND 를 순감소시키는 경우 — 대표적으로 **RECEIVE(입고) 역분개** — 예약을 해제하지 않고 창고 ON_HAND 를 줄일 수 있어 `on_hand<reserved` 를 만든다.

## 2. 착수 재확인으로 확정한 사실 (2026-07-12)

- **표면 3종**(착수 노트 조사, 상황판 본문 ①보다 넓음):
  - **A(파생 라이브)**: 당일 입고취소 `inbound.service.ts:1010` → `eventStore.reverseEvent(line.eventId, 'CANCEL', tx)`. 상위 `dbService.run` tx 내부. RECEIVE 역분개 → 입고창고 ON_HAND 감소.
  - **B(직접 라이브·최광폭)**: `DELETE /inventory/stocks/events/:eventId/cancel`(`stock-projection.controller.ts:97`) → `StockProjectionManager.cancelEvent`(`stock-projection.manager.ts:10`) → `reverseEvent(eventId, reason)` (**tx 미전파**, 임의 eventId). admin-web 라이브(`stocks.client.ts:87`).
  - **C(dead)**: `InventoryCommandService.reverseEvent`(`inventory-command.service.ts:562-568`) 래퍼 — 저장소 전역 호출자 0.
- **방향 판정은 상태로 갈린다**(스키마 `transitionType` enum 주석 `inventory.schema.ts:38-52` + `applyProjection` `stock-event.store.ts:122-162` 로 검증): 역분개의 감소 창고 = `original.toWarehouseId`, 조건 = `original.toState === 'ON_HAND'`. `applyProjection` 은 `fromState` 위치를 감소·`toState` 위치를 증가시키며, 역분개는 `rev.fromState = original.toState` 이므로 감소측이 원 이벤트의 to-측이다.
- **전이타입별 검증**(하드코딩 리스트 불요 — 상태 규칙 하나로 커버):

  | 원 이벤트 | original.toState | 역분개 ON_HAND | 가드 |
  |---|---|---|---|
  | RECEIVE (표면 A) · ADJUST_UP · REWORK_GOOD(dead) | ON_HAND | 순감소 | ✅ |
  | SHIP · ADJUST_DOWN · SCRAP · MARK_DEFECT(dead) | null·DEFECTIVE | 증가 | ❌ |
  | MOVE(창고내, `moveInternal`) | ON_HAND | 순변화 0 (from==to 창고) | ❌ |
  | MOVE(창고간, 작업 6 은퇴) | ON_HAND | 출발지(=original.to) 감소 | ✅ |

- **RECEIVE 상태 확인**: 스키마 주석 `'RECEIVE', // null → ON_HAND (입고)`. 입고 RECEIVE 생성처 `InventoryCommandService`(`:66`, `transitionType: 'RECEIVE'`) → `toState=ON_HAND`, `toWarehouseId=창고`. 표면 A 가 역분개하는 `line.eventId` 는 RECEIVE → 가드 대상 확정.
- **레이어링 제약**: 가드 로직(`getWarehouseReservationBalance`+`assertReservationInvariant`+`violatesReservationInvariant`)이 `InventoryCommandService` 에 있는데 `InventoryCommandService → StockEventStore`(→ `createEvent`) 의존이 이미 있어, store 가 command service 를 부르면 **순환**. → 불변식 가드를 `inventory/shared` leaf 로 **추출**해야 함(작업 10 락 헬퍼 `shared/locks/stock-availability-lock.ts` 와 동형). shared 는 무상태 leaf 라 역의존이 없어 store 가 import 해도 순환 무발생(store 는 이미 타 모듈 `ProductSellableQuantityService` 를 import).
- **스키마 무변경**: 락=advisory, 가드=기존 테이블 쿼리. 마이그레이션 없음.

## 3. 결정 (브레인스토밍, 2026-07-12)

### 3.1 배선 레벨 — store 내부 일괄

락·가드를 `StockEventStore.reverseEvent` **내부**에 직접 배선한다. 근거:
- **누락 0**: 표면 B(`cancelEvent`)가 store 를 직접 호출하고 **임의 이벤트**를 넘기므로, 호출부 각개 래핑은 표면 누락 위험. store 내부가 A/B/C 전부 자동 커버.
- **방향 지식의 자연스러운 집**: 역분개 방향(감소 창고)은 store 가 원 이벤트를 반전하며 스스로 계산한다. 호출부는 원 이벤트를 다시 로드해야 방향을 안다. 가드는 그 지식이 있는 곳에 둔다.
- **저레이어 원칙과의 정합**: `reverseEvent` 는 `createEvent` 같은 thin 프리미티브가 아니라 이미 **방향추론 + insert + projection + sellable 재계산 + 로깅**을 소유한 고차 연산 — adjustDown 본문과 같은 티어. 가드가 여기 있는 게 원칙 위반이 아니라 정합.
- 착수 노트도 "내부 일괄이 누락 없는 쪽"으로 기움. → 채택. (대안: wrapper 라우팅 — store thin 유지·표면 B 누락 위험·방향 로드 중복·C 존치 필요 → 기각.)

### 3.2 방향 판정 — 순수 헬퍼 `reversalOnHandDecrement`

store 파일 하단에 free function 으로 export(테스트 가능, `violatesReservationInvariant` 선례):

```ts
export function reversalOnHandDecrement(original: {
  skuId: string;
  fromWarehouseId: string | null;
  toWarehouseId: string | null;
  fromState: StockStateEnum | null;
  toState: StockStateEnum | null;
  quantity: number;
}): { skuId: string; warehouseId: string; quantity: number } | null {
  // 역분개는 원 이벤트의 to-측을 from-측(감소)으로 반전한다.
  // ON_HAND 순감소 창고 = original.toWarehouseId (original.toState === 'ON_HAND' 일 때).
  if (original.toState !== 'ON_HAND' || original.toWarehouseId == null) return null;
  // 창고내 이동(from==to, 양쪽 ON_HAND)은 순변화 0 → 제외.
  if (original.fromState === 'ON_HAND' && original.fromWarehouseId === original.toWarehouseId) return null;
  return { skuId: original.skuId, warehouseId: original.toWarehouseId, quantity: original.quantity };
}
```

`null` = 증가 방향/net-0 → 락·가드 불요(작업 10 §5 락 면제 경로와 일관).

### 3.3 가드 = THROW (bypass 없음)

입고취소·이벤트취소는 실사·파손과 달리 **물리적 사실이 아닌 시스템 정정**이다. 예약 걸린 재고의 정정은 예약을 먼저 해제해야 정합 — 따라서 위반 시 `ConflictException`(409) **THROW**. 작업 10 의 `bypassReservationGuard`(실사·파손 전용) 는 이 경로에 도입하지 않는다.

### 3.4 레이어링 — 불변식 가드를 shared leaf 로 추출

신규 `apps/core/src/modules/inventory/shared/locks/reservation-invariant.ts`(락 헬퍼와 co-locate) 에 free function 3종:
- `readWarehouseReservationBalance(trx, skuId, warehouseId)` — 단일 statement 원자 읽기(작업 10 I-1 torn-read 방지 유지).
- `violatesReservationInvariant(onHand, reserved, removingQty)` — 순수.
- `assertReservationInvariant(trx, skuId, warehouseId, removingQty)` — 위반 시 `ConflictException`.

`InventoryCommandService` 의 세 정의를 제거하고, `adjustDown`(:471)·`transferShip`(:212)은 추출된 free fn 을 직접 호출, `stocktaking.service.ts:473`(현 `this.commandService.getWarehouseReservationBalance`)은 shared import 로 전환. **래퍼 없이 단일 홈** — 동작 불변(순수 이동).

### 3.5 dead 표면 C 절제

`InventoryCommandService.reverseEvent`(:562-568) 삭제. 호출자 0 이고, 내부 배선 후 중복(작업 4·5·9 dead 절제 판례).

## 4. 스코프 — 변경 사항

1. **신규** `shared/locks/reservation-invariant.ts` — 불변식 가드 3종(§3.4).
2. **`stock-event.store.ts`**: `reversalOnHandDecrement` export(§3.2) + `reverseEvent` 에 락·가드 배선(원 이벤트 로드·POSTED 검증 직후, insert 전):
   ```ts
   const dec = reversalOnHandDecrement(original);
   if (dec) {
     await acquireStockAvailabilityLock(trx, dec.skuId, dec.warehouseId);
     await assertReservationInvariant(trx, dec.skuId, dec.warehouseId, dec.quantity);
   }
   ```
3. **`inventory-command.service.ts`**: `getWarehouseReservationBalance`·`assertReservationInvariant`·`violatesReservationInvariant` 제거(shared 이동), `adjustDown`(:471)·`transferShip`(:212) 호출부를 free fn 으로 전환, dead `reverseEvent`(§3.5) 삭제.
4. **`stocktaking.service.ts:473`**: `this.commandService.getWarehouseReservationBalance` 를 shared import 로 전환.
5. **기존 테스트 `inventory-command.reservation-guard.spec.ts`**: `violatesReservationInvariant` import 를 shared leaf 로 리다이렉트하고 신규 `reservation-invariant.spec.ts` 로 이전(§7). 이전 후 빈 파일이면 삭제.
6. **테스트**(§7).

## 5. 불가침 (라이브 — 회귀 가드)

- **표면 A 기존 선행검증 존치**: `inbound.service.ts:996-1004`(원위치 ON_HAND 전량 검증)는 location 단위 친화 조기검사 — 그대로. 신규 예약 가드는 그 위에 창고합산 체크를 얹음. 락은 `reverseEvent` 내부(A 의 외곽 tx 안)에서 획득 → 예약 가드가 락 하에 읽으므로 선행검증과 락 사이 reserve 끼어들어도 가드가 잡음(백스톱).
- **증가/net-0 방향 무가드**: SHIP·ADJUST_DOWN·SCRAP 역분개(ON_HAND 증가), 창고내 MOVE 역분개(net 0) 는 `reversalOnHandDecrement`=null → 락·가드 미적용(작업 10 §5 락 면제와 일관).
- **작업 10 가드 동작 불변**: adjustDown·transferShip·reserve·completeSession·processDamage 의 락·가드·bypass 는 로직 변경 없이 free fn 으로 **참조만** 이동. `violatesReservationInvariant` 시맨틱 동일.
- **arch 경계 spec**(`inventory-write-boundary.arch.spec.ts`): `reverseEvent` 의 `stockEvents` 직접 INSERT 는 store 내부라 허용 — 무변경 PASS.
- **reverseEvent 시그니처·반환 불변**: `(eventId, reason, tx?)` → 역분개 이벤트 row. 표면 A/B 호출부 무수정.

## 6. 경계 / 비목표 (out of scope)

- **스키마·마이그레이션 무변경** — `stockReservations`·`stockLedgers`·enum 무변경.
- **예약 자동해제·초과예약 조회 UI 없음** — 실사발 `on_hand<reserved` 자동처분은 상황판 처분 ②(게이지 실측 후 정책 결정, 보류)와 동일 계열. 본 작업은 **선제 차단(THROW)까지만**.
- **admin-web 무변경(원칙)** — 표면 B(`DELETE .../cancel`)가 409 를 새로 반환할 수 있으나 기존 에러 토스트 경로. verify 에서 하드브레이크만 확인, UI 로직 변경은 비목표.
- **대사잡 축 신규 없음** — 작업 10 이 `wms_reserved_over_onhand_grains` 탐지를 이미 세움. 본 작업은 그 위반을 **생성 시점에 막는** 능동 가드일 뿐, 별도 탐지 축 추가 안 함.
- **SHIP·adjustUp·release·transferReceive·moveInternal 로직 변경 없음**(락 면제·증가 경로).

## 7. 검증 / 테스트

공통 규약(현황판 §281): `nest build core` exit 0 · arch 경계 spec PASS · 삭제 심볼(`InventoryCommandService.reverseEvent`) 전역 참조 0 · **변경 파일 신규 eslint error 만**(repo 전역 lint 상시 debt) · admin-web 무변경.

- **Unit** — `reversalOnHandDecrement` 순수 케이스:
  - RECEIVE(null→ON_HAND) → `{warehouseId: to, qty}`
  - ADJUST_UP(null→ON_HAND) → dec
  - SHIP(ON_HAND→null) → null
  - ADJUST_DOWN(ON_HAND→null) → null
  - SCRAP(ON_HAND→null) → null
  - 창고내 MOVE(W:ON_HAND→W:ON_HAND) → null
  - 창고간 MOVE(W1:ON_HAND→W2:ON_HAND) → `{warehouseId: W2, qty}`
  - toState=ON_HAND·toWarehouseId=null(malformed) → null
- **Unit** — `violatesReservationInvariant` 테스트를 기존 `inventory-command.reservation-guard.spec.ts` 에서 신규 `shared/locks/reservation-invariant.spec.ts` 로 이전(경계값: `onHand-removing == reserved` false, `< reserved` true) — 회귀 커버리지 무손실.
- **통합 spec ⏸(dev DB 복구 시)** — RECEIVE 역분개: 예약 有(reserved=onHand)→409·insert 롤백 / 예약 無→성공 / SHIP 역분개 예약 有→성공(가드 없음). `isolatedModules` off tsc 로 타입체크(작업 10 발견 관행).

## 8. 리스크

- **표면 B 임의 이벤트의 과도 차단?** — 감소 방향(RECEIVE/ADJUST_UP/REWORK_GOOD/창고간MOVE 역분개)만 가드. 증가·net-0 은 통과. 예약 걸린 재고를 역분개로 빼는 것은 정의상 막아야 할 동작이므로 과도 아님.
- **표면 A 당일 입고취소가 예약 후 막힘** — 의도된 동작(예약 먼저 해제). 운영 흐름: 예약 해제 → 입고취소. 409 메시지로 안내.
- **락 순서 데드락?** — `reverseEvent` 는 단일 `(sku,warehouse)` 락(표면 A/B 모두 이벤트 1건). 멀티키 아님 → 교차 데드락 무관. reserve·adjustDown 이 같은 advisory 키를 먼저 잡는 순서와 정합(작업 10 §3.4).
