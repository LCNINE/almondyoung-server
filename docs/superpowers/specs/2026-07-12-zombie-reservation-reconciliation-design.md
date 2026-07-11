# 작업 11 — P1-3 좀비 예약 해소 (FO 상태↔예약 대사) 설계 (WS-C)

> 스프린트 현황판: `docs/logistics-backend-hardening-2026-07.md` §5 WS-C 작업 11.
> 관련 결함: **P1-3**(FO 예약 `timeoutAt=null` → 만료 크론 영구 배제 → terminal FO 의 잔존 confirmed 예약이 `available` 을 영구 잠금 = 과소판매).
> 성격: **발생원 봉합 + auto-heal 대사 잡 + inert timeout 기계 절제·재배선 · 스키마·마이그레이션 무변경**(작업 4·5·6·7·9·10 판례). dev DB 없이 머지 가능, 통합 테스트만 dev DB 복구 시(⏸).
> 목적: terminal FO(`shipped`/`completed`/`canceled`)의 잔존 `confirmed` 예약을 (1) 발생원에서 막고 (2) 대사 잡으로 자동 해제하여 잠긴 `available` 을 되돌린다.

---

## 1. 배경

WS-C(예약 보강)의 세 번째 작업. 작업 9 가 예약 진입점 표면을 축소하고, 작업 10 이 reserve/adjustDown 경로에 `(sku,warehouse)` 잠금과 `on_hand≥reserved` 가드를 세운 위에서, **정상 종결되지 못한 예약(좀비)** 을 정리한다.

**좀비의 정의**: FO 가 terminal 상태에 도달했는데도 그 FO 를 target 으로 하는 예약이 `status='confirmed'` 로 남아있는 것. `available = SUM(ON_HAND) − SUM(confirmed 예약)` 이므로(작업 10 §2), 이런 잔존 confirmed 는 이미 끝난 주문 몫으로 재고를 영구 잠가 **과소판매**를 낸다.

**왜 배치 timeout 부여가 아니라 대사인가**: 예약에 일괄 timeout 을 부여하면 *정당한 출고대기 FO 예약*까지 만료 해제되어 초과판매 위험이 생긴다(현황판 P1-3 서술). FO 예약의 정상 종결 2경로(ship 소진 / cancel 환원)가 건재하므로, "**FO 상태를 진실로 삼아 예약을 맞추는 대사**"가 자연스럽다. 시간이 아니라 **FO 상태**가 예약 수명의 기준이다.

## 2. 착수 재확인으로 확정한 사실 (2026-07-12, develop @ `69da56fff`, 작업 10 머지 직후)

### 2.1 좀비 메커니즘 — 감사 서술 유지 + 발생원 특정

- **모든 라이브 예약 생성 경로가 `timeoutAt=null`**: 물리 INSERT 는 2곳뿐 — `UnifiedReservationService.reserveStock`(`inventory/shared/services/unified-reservation.service.ts:71`, `timeoutAt: dto.timeoutAt` @ `:80`, `status:'confirmed'` @ `:79`)과 `FulfillmentReservationsFacade.transferReservation`(`fulfillment/services/fulfillment-reservations.facade.ts:387-396`, `timeoutAt` 미지정). 두 호출자(`facade.reserve` @ `:92`, `fulfillments.service.tryReserveItems` @ `:813`)와 retry 워커(`fulfillment-order-reservation-retry.worker.ts:117`)는 모두 `timeoutAt` 을 넘기지 않음 → 항상 NULL. 컬럼은 nullable·default 없음(`inventory.schema.ts:1346`).
- **만료 파이프라인은 좀비를 구조적으로 배제**: `releaseExpiredReservations`(`unified-reservation.service.ts:238-265`) 필터가 `status='confirmed' AND timeoutAt IS NOT NULL AND timeoutAt < now`(`:251-252`). `isNotNull(timeoutAt)` 때문에 NULL 행은 **절대 매치 안 됨** → 10분 크론도, admin 버튼도 항상 0건. **timeout 기계 전체가 inert.**

### 2.2 발생원 2곳 (감사가 "방치된 FO"로 뭉친 것을 특정)

FO status enum(`inventory.schema.ts:156-174`, 컬럼 `fulfillmentOrders.status` @ `:1250`)에서 **terminal = `shipped`·`completed`·`canceled`** (가드 절 기준, naming 아님). 각 전이 지점과 예약 해제 여부:

| terminal 전이 | 위치 | 예약 해제? |
|---|---|---|
| `shipped` | `outbound-consumption.service.ts:145` (사내/3pl 소진) | **YES** — 직전 `:136` `consumeFulfillmentOrderReservations` |
| `shipped` | `fulfillments.service.ts:905` (`ship()`, **drop_ship 전용**) | **NO** — 메서드 내 해제 호출 없음 |
| `completed` | `fulfillments.service.ts:957` (`markDelivered()`) | **NO** — 해제 호출 없음, `shipped` 였는지만 가드(`:948`) |
| `canceled` | `fulfillments.service.ts:1032` (`cancel()`) | YES — `:1035` |
| `canceled` | `fulfillment-order-transaction.service.ts:36` | YES — `:39` |
| `canceled` | `sales-orders.service.ts:481` (SO 취소 캐스케이드) | YES |

→ **좀비 발생원 = 위 표의 NO 2곳**:
- **`ship()` drop_ship**(`:905`): "직배는 자사 재고 예약 없음" 불변식(주석 `:863-865`)에만 의존 — 그 불변식이 깨지면 잔존.
- **`markDelivered()`**(`:957`): `shipped→completed` 로 오는데 consume 이 안 된 케이스(위 drop_ship 경로 등)를 검증 없이 `completed` 로 운반.

### 2.3 heal 프리미티브가 이미 존재 (핵심)

`reservation-lifecycle.service.ts`(`inventory/shared/services/`):
- private `releaseFulfillmentOrderReservations(foId, reason, tx)`(`:57-86`): FO 의 `confirmed` 예약 로드(`getReservationsByTarget('FULFILLMENT_ORDER', ...)` @ `:63`, 이미 `status='confirmed'` 필터 @ `unified-reservation.service.ts:127`) → 행마다 `releaseReservation`(`:71`) → FOI `reservedQty=0`(`:77`) → FO `totalReservedQty=0`(`:80-83`).
- public 진입 2곳이 이걸 감쌈: `consumeFulfillmentOrderReservations`(ship, `:53`)·`handleFulfillmentOrderStatusChange` case `'canceled'`(`:34`).

**결정적 사실**: 이 프리미티브는 **SHIP 원장을 append 하지 않는다** — `releaseReservation` 은 `stock_reservations.status='released'` 로만 바꾼다(`unified-reservation.service.ts:101`). 실제 SHIP 이벤트 append(on_hand 차감)는 `outbound-consumption.service.ts:95-110` 이 예약 해제와 **별개로, 먼저** 수행. 즉 reservation-lifecycle 의 consume/cancel 차이는 **reason 문자열뿐**, 둘 다 동일한 "예약행 release" 다.

⟶ 그러므로 **terminal 상태(shipped/completed/canceled) 무엇이든 heal = 단순 release 로 균일**하고 **on_hand 를 절대 건드리지 않는다** → 이미 SHIP 된 FO 의 잔존 예약을 release 해도 **on_hand 이중차감 위험 0**. auto-heal 안전성의 근거.

### 2.4 대사 인프라 (작업 10)

- `LedgerReconciliationService`(`inventory/core/services/ledger-reconciliation.service.ts`): `reconcile`(`:85`, events↔ledgers)·`reconcileReservations`(`:153`, `on_hand<reserved` raw 합 대사)·`scheduledReconcile`(`:199`, `@Cron('0 3 * * *')` 03:00 KST). 게이지 `wms_ledger_drift_grains`·`wms_reserved_over_onhand_grains`(`metrics.service.ts:96,104`). 온디맨드 `GET /inventory/ledger-reconciliation[/reservations]`. **전부 탐지 전용(read-only)**.
- 새 좀비 대사는 이 형태(CTE 합산/조인 → Report + 게이지 + 야간 크론)를 따르되, **조인 대상이 `stock_ledgers` 가 아니라 `fulfillmentOrders` 상태**이고 **write(heal)를 수행**하므로 **별도 서비스**로 둔다(§3.4).
- `sellable 재계산`: `ProductSellableQuantityService.recalculateAndPublishForSku(skuId, tx?)`(`product-sellable-quantity.service.ts:373`). `releaseReservation` 내부(`:111`)가 이미 호출 → heal 루프가 자동으로 sellable 재계산을 태움. 고아 래퍼 `recalculateSellableQuantityForReservationSku`(`reservation-lifecycle.service.ts:18-20`)는 호출자 0(작업 9 잔여) — §4.A-4 로 함께 삭제.

### 2.5 timeout 기계 배선 전모 (절제 대상)

fully wired but inert. core: `releaseExpiredReservations`(`unified-reservation.service.ts:238`) + 10분 크론(`reservation-cron.service.ts:17-35`) + `POST expire-stale`(`reservation.controller.ts:150-174`) + 빈 스텁 크론 `monitorReservationStats`(`reservation-cron.service.ts:42-57`, `@Cron EVERY_HOUR`, no-op). admin-web: client `expireStaleReservations`(`reservations.client.ts:49-54`) + hook `useExpireStaleReservations`(`mutations.ts:597-605`) + 버튼 "만료된 예약 일괄 해제"(`features/inventory/reservations/template/index.tsx:38,52-59,81-89`, 페이지 최상단 우측) + 읽기전용 "만료 시각" 컬럼(`use-reservations-table-columns.tsx:90-96`, 항상 "-") + 타입 `ExpireStaleReservationsResponseDto`(`types/dto/inventory.ts:1261`).

`timeoutAt` 을 채우는 코드가 없어 전체가 no-op. 컬럼(`inventory.schema.ts:1346`)·응답 DTO 필드(`reservation-response.dto.ts:60`)는 스키마/계약이라 **존치**, 나머지 배선은 절제.

## 3. 결정 (브레인스토밍, 2026-07-12)

### 3.1 대사 처리 = auto-heal (탐지 전용 아님)

Task 2·Task 10 은 의도적으로 탐지 전용이었으나, P1-3 은 *라이브 과소판매* 이고 §2.3 에 의해 heal(release)이 on_hand 무터치라 안전하다. 대사 잡은 terminal FO 의 잔존 confirmed 를 **실제 해제**한다. terminal FO 는 정당한 동시 활동이 없고, 정상 경로는 전이+해제가 동일 tx(§2.2 표의 YES 행)라 "terminal 이지만 아직 미해제" 의 torn read 가 없다.

### 3.2 janitor + 발생원 봉합 (P1-4/P1-5 판례)

대사 잡만 두지 않고 발생원 2곳도 봉합한다 → 과소판매 창 "제거", 대사 잡은 진짜 safety-net(정상 시 0건). `markDelivered`·`ship()` drop_ship 에 **동일 tx 방어 sweep**(leftover release + 발견 시 warn)을 넣는다. 발생원 봉합의 sweep 은 §2.3 의 동일 프리미티브를 재사용하므로 heal 과 일관.

### 3.3 timeout 기계 절제 + 버튼 재배선

inert expiry 경로(`releaseExpiredReservations` + 10분 크론 + `POST expire-stale` + 빈 스텁 크론)를 제거하고, admin 버튼을 신규 on-demand 대사(heal) 엔드포인트로 재배선·리라벨한다("예약 정합성 정리"). WS-B 의 "레거시 경로 은퇴·올바른 경로 재배선" 에토스와 일관. 작동하는 operator affordance 를 유지하되 placebo 를 제거. `timeoutAt` 컬럼·응답 DTO 필드는 존치(expand-contract, 미래 재사용 여지).

### 3.4 서비스 배치 = 별도 `ReservationReconciliationService`

heal 은 write 라 read-only `LedgerReconciliationService` 에 얹지 않고 **별도 서비스**로 분리(탐지=읽기 / heal=쓰기 성격 혼재 회피). 위치는 `inventory/core/services/`(대사 형제) — core→shared import 로 reservation-lifecycle 재사용(작업 10 근거: 순환 없음). 자체 `@Cron`(03:05 KST, Task 10 야간 잡 뒤 staggered).

## 4. 스코프 — 변경 사항

### A. 발생원 봉합 (fulfillment)

**A-1. reservation-lifecycle 에 public heal 진입 추가** (`reservation-lifecycle.service.ts`):
```ts
// private releaseFulfillmentOrderReservations 를 대사·발생원-sweep 용으로 노출.
// reason 은 감사 흔적용 자유 문자열. 반환 = 실제 release 된 예약 행 수.
async releaseLeftoverReservations(foId: string, reason: string, tx: DbTx): Promise<number>
```
- 기존 private 을 그대로 위임(행 수 반환만 추가). `handleFulfillmentOrderStatusChange(foId,'canceled')` 재사용은 **금지**(의미 왜곡 — 대사는 FO 를 취소하는 게 아님).

**A-2. `markDelivered()`** (`fulfillments.service.ts:948-957`): `completed` 세팅과 **동일 tx** 에서 `releaseLeftoverReservations(foId, 'reconcile: FO delivered leftover', tx)` 호출. 정상 경로(이미 소진)는 0건 no-op, 비정상 잔존은 자동 해제. `released > 0` 이면 `logger.warn`(foId 포함) — 발생원 노출.

**A-3. `ship()` drop_ship** (`fulfillments.service.ts:866-936`, `shipped` 세팅 `:905`): 동일 tx sweep `releaseLeftoverReservations(foId, 'reconcile: drop_ship invariant sweep', tx)`. drop_ship 불변식("예약 없음")이 참이면 항상 0건(저비용 no-op), 위반 시 자동 해제 + `logger.warn`. **구현 선행 확인**: retry 워커 drop_ship 분기(`reservation-retry.worker.ts:89`)와 `tryReserveItems` 가 drop_ship 품목에 실제 예약을 만드는지 grep 확인 — 만들지 않으면 sweep 은 순수 방어(assert 성격), 만들면 실 heal 경로.

**A-4. 고아 래퍼 정리** (`reservation-lifecycle.service.ts`, 착수 재확인으로 주입 연쇄 없음 확정): private `recalculateSellableQuantityForReservationSku`(`:18-20`, 호출자 0 — 작업 9 잔여) + 그 유일 사용처였던 `ProductSellableQuantityService` 주입(`:15`)·import(`:6`) 삭제. heal 의 sellable 재계산은 `releaseReservation`(`unified-reservation.service.ts:111`) 경유로 전이되므로 주입 제거 무영향. private `releaseFulfillmentOrderReservations`(`:57-86`)는 현재 `void` 반환 → A-1 을 위해 `reservations.length` 반환으로 변경(기존 consume/cancel 호출자는 무시).

### B. 좀비 대사 서비스 (신규, `inventory/core/services/reservation-reconciliation.service.ts`)

**B-1. 탐지** `detectZombieReservations(filter?, tx?)`:
- 단일 SQL 스냅샷: `stock_reservations`(`status='confirmed'`) ⋈ `fulfillmentOrders`(`status IN ('shipped','completed','canceled')`) on `targetType='FULFILLMENT_ORDER' AND targetId = fo.id`. 선택 필터 `warehouseId`/`skuId`.
- 반환 `ZombieReservationReport { checkedAt, totalZombieFos, totalZombieQty, rows: ZombieRow[] }`, `ZombieRow = { foId, foStatus, skuId, warehouseId, quantity, reservationId }`. Task 10 `*DriftReport` 형태 미러.

**B-2. heal** `reconcileAndHeal(filter?, tx?)`:
- `detectZombieReservations` → **FO 단위로 그룹** → FO 별 `this.dbService.run(trx => reservationLifecycle.releaseLeftoverReservations(foId, 'reconcile: terminal FO leftover', trx), tx)`.
- 멱등: `confirmed` 필터 기반이라 재실행 시 0건. **락 불요** — release 는 `available` 을 늘려 over-sell 불가(작업 10 §5 "available 증가 경로는 락 면제"와 일관). FO 단위 tx 분리로 한 FO 실패가 나머지를 안 막음(작업 10 대사 격리 패턴).
- 반환 `{ healedFos, healedReservations, report }`.

**B-3. 크론** `@Cron('5 3 * * *', { name:'zombie-reservation-reconciliation', timeZone:'Asia/Seoul' })` → `reconcileAndHeal()` 전량. try/catch 로 스케줄러 보호(작업 2 패턴). 게이지 set + healed 로그(상위 N).

**B-4. 메트릭** (`metrics.service.ts` 확장):
- `wms_zombie_reservations_grains`(Gauge, 라벨 없음) — 직전 대사에서 **heal 전 탐지된** 좀비 예약 행 수. 정상 시 0 명시 set(작업 2 게이지 컨벤션).
- `wms_zombie_reservations_healed_total`(Counter) — 누적 heal 행 수.

**B-5. 온디맨드 엔드포인트** (`reservation.controller.ts`): `POST /inventory/reservations/reconcile` → `reconcileAndHeal()` → `{ healedFos, healedReservations }`. (expire-stale 자리 대체.)

### C. timeout 기계 절제

- **삭제**: `UnifiedReservationService.releaseExpiredReservations`(`:238-265`, 호출자 = 크론·expire-stale 둘 다 이번에 제거 → dead) · `POST expire-stale` 라우트+핸들러(`reservation.controller.ts:150-174`) · `ReservationCronService` **클래스째**(`reservation-cron.service.ts` — expiry 크론·빈 스텁 크론 둘 다 소멸) + `inventory.module.ts:24,59` 배선.
- **존치**: `timeoutAt` 컬럼(`inventory.schema.ts:1346`) · 응답 DTO 필드(`reservation-response.dto.ts:60`) · 서비스 인터페이스 `ReserveStockDto.timeoutAt?`(`unified-reservation.service.ts:15`, INSERT 는 계속 `undefined`→NULL). 스키마·계약 무변경으로 남겨 미래 단기예약 재사용 여지.

### D. admin-web 재배선

- `reservations.client.ts:49-54`: `expireStaleReservations()` → `reconcileReservations()` (`POST /inventory/reservations/reconcile`).
- `mutations.ts:597-605`: `useExpireStaleReservations` → `useReconcileReservations`(성공 토스트 "예약 정합성 정리 완료: N건 해제").
- `features/inventory/reservations/template/index.tsx:38,52-59,81-89`: 버튼 라벨 "만료된 예약 일괄 해제" → **"예약 정합성 정리"**, 핸들러·토스트 문구 갱신.
- `use-reservations-table-columns.tsx:90-96`: 읽기전용 "만료 시각" 컬럼 **제거**(항상 "-", 의미 소멸).
- `types/dto/inventory.ts:1261`: `ExpireStaleReservationsResponseDto` → `ReconcileReservationsResponseDto`(`healedFos`/`healedReservations`). `ReservationDto.timeoutAt`(`:1242`)은 응답 DTO 존치와 맞춰 유지(무해).

## 5. 불가침 (라이브 — 회귀 가드)

- **정상 종결 2경로 유지**: ship 소진(`outbound-consumption:136` → consume)·cancel 환원(`fulfillments:1035`/`fulfillment-order-transaction:39`/`sales-orders:481`). 발생원 sweep 은 이들 **뒤/밖**에 얹는 방어일 뿐, 정상 경로는 sweep 이 0건 no-op 이어야 한다.
- **heal 은 release 만, SHIP append 없음**(§2.3): 이미 SHIP 된 FO 의 잔존 예약을 heal 해도 on_hand 불변. 대사가 원장을 건드리지 않음 — 원장 정합은 작업 2/10 소관.
- **작업 10 잠금·가드 불간섭**: reserve/adjustDown/transferShip 경로 무변경. release 는 락 면제 경로(작업 10 §5)라 좀비 대사도 락 불필요 — 일관.
- **`in-flight` FO 예약 불가침**: 대사 필터는 terminal 3상태만. `created/reserving/ready/pending/allocated/picking/picked/inspecting/inspected/invoiced/labeled/forwarded` 의 예약은 절대 건드리지 않음(정당한 출고대기 몫).
- **arch 경계 회귀**: `inventory-write-boundary.arch.spec.ts` PASS 유지(heal 은 `stockEvents` 직접 INSERT 아님 — 무관하게 GREEN).
- **`unfulfillable`**(`fulfillments.service.ts:432`, 예약 실패 시)은 terminal 아님·해제할 예약 없음 → 대사 대상 제외 확인.

## 6. 테스트

- **단위**:
  - `detectZombieReservations`: terminal FO + confirmed → 검출, in-flight FO 의 confirmed → 제외, terminal FO 의 released → 제외, warehouseId/skuId 필터.
  - `reconcileAndHeal`: FO 별 `releaseLeftoverReservations` 호출·행 수 집계·재실행 멱등(2회차 0건)·한 FO 실패 격리.
  - `releaseLeftoverReservations`: confirmed 로드→released·FOI reservedQty 0·FO totalReservedQty 0·sellable 재계산 호출·반환 행 수.
  - `markDelivered` sweep: shipped(미소진) leftover → completed 전이 시 released; 정상 소진 경로 → 0건 no-op·warn 없음.
  - `ship()` drop_ship sweep: leftover 유무별 동작·warn.
  - 게이지 set(정상 0 명시)·counter 증가.
  - admin-web: 버튼→`reconcileReservations` client 호출, 토스트 문구.
- **arch**: write-boundary spec 회귀 GREEN.
- **통합 ⏸(dev DB 복구 시)**: 좀비 heal end-to-end(터미널 FO 잔존→해제→available 복구)·멱등·발생원 sweep·`isolatedModules` 우회 타입체크(작업 10 판례).

## 7. 비목표 / 후속

- **배치 timeout 부여** — over-sell 위험, 현황판·§1 기각.
- **`timeoutAt` 컬럼 물리 제거** — expand-contract·저가치, 존치.
- **P2-1 라인 단위 소진** — 작업 12 소관.
- **실사발 `on_hand<reserved` drift 자동 해제·조회 UI** — 작업 10 이 WS-D 로 이연한 별개 항목(좀비 대사와 무관, 물리 사실 기반).
- **`reverseEvent` 미가드 잔여**(작업 10 §5 I-2) — WS-D.
- **admin-web 예약 UI `MOVEMENT_TASK` 필터 잔재**(작업 9 잔여 (b)) — 별개 FE 티켓.

> 고아 래퍼 `recalculateSellableQuantityForReservationSku` 삭제는 **본 작업 범위로 승격**(§4.A-4) — 착수 재확인에서 `ProductSellableQuantityService` 주입 연쇄 없음 확정.

## 8. 검증 게이트

`nest build core` exit 0 · 삭제 심볼(`releaseExpiredReservations`·`ReservationCronService`·`expireStaleReservations`) 저장소 전역 참조 0 · arch 경계 spec PASS · fulfillment/inventory 단위 spec GREEN · 변경 파일 신규 eslint 0 · admin-web `type-check` 신규 0 · 통합 ⏸(dev DB). 스키마 무변경이라 dev DB 의존 항목은 통합 spec 뿐.
