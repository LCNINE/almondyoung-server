# 재고 예약 해제가 상자·출고주문을 함께 맞춘다 (#1543) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 재고 예약 화면에서 상자 줄 예약 한 행을 풀면 같은 트랜잭션에서 상자 줄 `reserved_qty`·출고주문 투영이 맞고, 작업이 시작된 상자는 막히며, 막힌 사유가 화면 토스트에 뜬다.

**Architecture:** `DELETE /inventory/reservations/:id` 를 inventory 의 `ReservationController` 에서 fulfillment 모듈의 새 컨트롤러로 옮긴다(fulfillment 가 inventory 를 import 하므로 역방향 호출 불가). 새 `ReservationReleaseService` 가 행을 읽어 상자 줄 행은 `ShipmentReservationService.releaseReservation`(새, `releasePartial` 과 같은 잠금 순서 + `recompute`)으로, 옛 FO 대상 행은 `UnifiedReservationService.releaseReservation` 으로 보낸다. Unified 는 상자 줄 행을 거절한다.

**Tech Stack:** NestJS 11, Drizzle(postgres.js), Jest(ts-jest), Next.js admin-web.

**Spec:** `docs/superpowers/specs/2026-11-24-reservation-release-recompute-1543-design.md`

## Global Constraints

- URL·메서드·권한·성공 응답 그대로: `DELETE /inventory/reservations/:id`, `@RequirePermission('inventory.stock.adjust')`, 204, 본문 `ReleaseReservationDto`(선택 `reason`).
- 상자 줄 행 판정은 한 가지로 통일한다: `targetType === 'SHIPMENT_LINE'`(`shipment_line_id` 는 2026-07 부터 NOT NULL 이라 null 로는 가를 수 없다). 분기(Task 2)와 Unified 거절(Task 3)이 같은 조건을 쓴다.
- 문구(현장 말, 그대로 쓴다):
  - `draft` 아닌 상자 → `ConflictError('작업이 시작된 상자의 예약은 풀 수 없습니다')`
  - 이미 풀린 행 → `ConflictError('이미 풀린 예약입니다')`
  - 없는 id → `NotFoundError('예약을 찾을 수 없습니다')`
  - 화면 기본 실패 문구(지금 것) → `'예약 해제에 실패했습니다.'`
- 본문 `reason` 이 비었거나 공백뿐이면 `stateReason` 기본값 `'admin-release'`.
- 새 코드의 예외는 `@app/shared` 의 `NotFoundError`/`ConflictError`. 컨트롤러에 try/catch 없음.
- 트랜잭션: `this.db.run(async (trx) => …, tx)`, 공개 메서드는 `tx?: DbTx` 마지막 인자(ADR-0025).
- 마이그 없음. 배포 core → admin-web.
- 🔴 로컬 E2E 스택이 떠 있으면 전체 jest·type-check 를 돌리지 않는다. jest 는 `--maxWorkers=2`.
- 통합 스펙은 `describeIfDb` 가드 아래에 둔다. 실행은 `npm run test:core:integration:local -- <패턴>` (로컬 `core` DB 마이그가 깨져 있으면 `LOCAL_PG` 로 스크래치 DB 를 가리킨다).

## Review Focus

1. **한 줄에 확정 행이 둘 이상** — 고른 행만 풀리고 다른 행·줄 `reserved_qty` 는 남은 행 합으로 맞아야 한다 → Task 1 테스트 `releases only the chosen row when a line holds two confirmed rows`.
2. **두 사람이 같은 행을 동시에/연달아 해제** — 두 번째는 409 «이미 풀린 예약입니다», 판매 가능 수량이 두 번 오르지 않는다 → Task 1 테스트 `rejects a second release of the same row`.
3. **피킹 중(`planned` 등) 상자** — 409 이고 행·줄·FO·예약 버전 모두 그대로 → Task 1 테스트 `rejects release on a non-draft shipment and changes nothing`.
4. **UUID 가 아닌 id** — 지금은 DB 캐스트 오류로 500 이 날 수 있다. 400 이어야 한다 → Task 2 컨트롤러의 `@Param('id', ParseUUIDPipe)`. 유닛 호출은 파이프를 돌리지 않으므로 리뷰에서 시그니처로 확인한다.
5. **옛 FO 대상 행** — 동작이 그대로여야 한다(상자 재계산 없이 Unified 경로) → Task 2 테스트 `routes a legacy row without shipment line to UnifiedReservationService`.

---

### Task 1: `ShipmentReservationService.releaseReservation` — 행 하나를 풀고 상자를 재계산

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/shipment-reservation.service.ts` (클래스 안, `releasePartial` 바로 아래)
- Test: `apps/core/src/modules/fulfillment/services/shipment-reservation.integration.spec.ts` (기존 `physicalOrder`·`loadV2` 헬퍼 재사용)

**Interfaces:**
- Produces:
  ```ts
  export type ReservationRowReleaseResult = {
    reservationId: string;
    shipmentLineId: string;
    releasedQty: number;
    reservationVersion: number;
  };
  async releaseReservation(reservationId: string, reason: string, tx?: DbTx): Promise<ReservationRowReleaseResult>
  ```
  `targetType` 이 `'SHIPMENT_LINE'` 이 아닌 행을 받으면 `Error('releaseReservation: reservation <id> is not a shipment-line reservation')`(프로그래밍 오류 → 500). 분기는 Task 2 의 몫이다.

- [ ] **Step 1: 실패하는 통합 테스트 다섯 개를 쓴다** (`describeIfDb` 블록 안, `inRollbackTx` 로)

  ```ts
  it('releases a 1-of-5 shipment-line reservation and recomputes line and FO in the same transaction', async () => {
    // physicalOrder({ quantity: 5, onHand: 1 }) → fulfillments.create → loadV2
    // 전제: line.reservedQty 1, fo { status: 'partially_reserved', totalReservedQty: 1 }
    const [row] = /* confirmed row of loaded.line.id */;
    const result = await wired.shipmentReservations.releaseReservation(row.id, '현장 해제', tx);
    expect(result).toMatchObject({ reservationId: row.id, shipmentLineId: loaded.line.id, releasedQty: 1, reservationVersion: before.shipment.reservationVersion + 1 });
    // row: { status: 'released', stateReason: '현장 해제' }, invalidatedAt 이 null 아님
    const after = await loadV2(tx, fixture.salesOrderId);
    expect(after.line.reservedQty).toBe(0);
    expect(after.fo).toMatchObject({ status: 'created', totalReservedQty: 0 });
  });

  it('releases only the chosen row when a line holds two confirmed rows', async () => {
    // physicalOrder({ quantity: 5, onHand: 3 }) → 예약 행 A(qty 3)
    // 같은 줄에 확정 행 B(qty 1)를 직접 insert 하려면 먼저 ledger qty 를 4 로 올리고,
    // B 는 targetType 'SHIPMENT_LINE', targetId/shipmentLineId = line.id, status 'confirmed', requestedAt = line.createdAt
    // 그 뒤 shipmentReservations.recompute(line.shipmentId, tx) 로 줄을 4 로 맞춘다
    await wired.shipmentReservations.releaseReservation(B.id, 'b only', tx);
    // A.status 'confirmed' qty 3, B.status 'released', line.reservedQty 3, fo.totalReservedQty 3
  });

  it('rejects release on a non-draft shipment and changes nothing', async () => {
    // quantity 2 onHand 2 → shipments.status 를 'planned' 로
    await expect(wired.shipmentReservations.releaseReservation(row.id, 'x', tx)).rejects.toThrow('작업이 시작된 상자의 예약은 풀 수 없습니다');
    // row.status 'confirmed', line.reservedQty 2, shipment.reservationVersion 변화 없음
  });

  it('rejects a second release of the same row', async () => {
    await wired.shipmentReservations.releaseReservation(row.id, 'first', tx);
    await expect(wired.shipmentReservations.releaseReservation(row.id, 'second', tx)).rejects.toThrow('이미 풀린 예약입니다');
    // row.stateReason 은 'first' 그대로
  });

  it('rejects an unknown reservation id', async () => {
    await expect(wired.shipmentReservations.releaseReservation(randomUUID(), 'x', tx)).rejects.toThrow('예약을 찾을 수 없습니다');
  });
  ```

- [ ] **Step 2: 실패 확인**

  Run: `npm run test:core:integration:local -- shipment-reservation.integration`
  Expected: 새 다섯 개가 `releaseReservation is not a function` 류로 FAIL, 기존 케이스는 PASS.

- [ ] **Step 3: `releaseReservation` 구현**

  순서(`releasePartial` 과 같은 잠금 순서를 지킨다 — 상자 묶음 → 재고 → 예약 행):
  1. 행을 id 로 읽는다(잠금 없이). 없으면 `NotFoundError('예약을 찾을 수 없습니다')`. `targetType !== 'SHIPMENT_LINE'` 이면 위 `Error`.
  2. `initial = loadLineContext(row.shipmentLineId)` → `lockConnectedComponents([initial])` → `line = loadLineContext(...)` → `assertStableContext(initial, line)`.
  3. `line.shipmentStatus !== 'draft'` 이면 `ConflictError('작업이 시작된 상자의 예약은 풀 수 없습니다')` (기존 영어 `assertDraft` 는 쓰지 않는다 — 화면에 뜨는 문구다).
  4. `acquireStockAvailabilityLock(trx, line.skuId, line.warehouseId)`.
  5. `loadConfirmedReservations(line.id)` 로 잠근 확정 행 목록에서 `reservationId` 를 찾는다. 없으면(이미 풀렸거나 다른 줄로 옮겨짐) `ConflictError('이미 풀린 예약입니다')`.
  6. 그 행을 `{ status: 'released', stateReason: reason, invalidatedAt: now, updatedAt: now }` 로.
  7. `unifiedReservation.recalculateSellableForSku(line.skuId, trx)` → `bumpReservationVersions([line.shipmentId], trx)` → `recompute(line.shipmentId, trx)`.
  8. `{ reservationId, shipmentLineId: line.id, releasedQty: row.quantity, reservationVersion: await loadReservationVersion(line.shipmentId, trx) }`.

  `NotFoundError`·`ConflictError` 는 `@app/shared` 에서 import.

- [ ] **Step 4: 통과 확인**

  Run: `npm run test:core:integration:local -- shipment-reservation.integration`
  Expected: 전부 PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/core/src/modules/fulfillment/services/shipment-reservation.service.ts apps/core/src/modules/fulfillment/services/shipment-reservation.integration.spec.ts
  git commit -m "[core] #1543 상자 줄 예약 한 행을 풀면 같은 트랜잭션에서 상자·출고주문을 다시 계산한다"
  ```

---

### Task 2: 해제 라우트를 fulfillment 로 옮기고 행 종류로 나눈다

**Files:**
- Create: `apps/core/src/modules/fulfillment/services/reservation-release.service.ts`
- Create: `apps/core/src/modules/fulfillment/services/reservation-release.service.spec.ts`
- Create: `apps/core/src/modules/fulfillment/controllers/reservation-release.controller.ts`
- Create: `apps/core/src/modules/fulfillment/controllers/reservation-release.controller.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/fulfillment.module.ts` (controllers·providers 배열에 추가)
- Modify: `apps/core/src/modules/inventory/core/controllers/reservation.controller.ts` (`@Delete(':id')` 핸들러와 쓰지 않게 된 import 제거)

**Interfaces:**
- Consumes: Task 1 `ShipmentReservationService.releaseReservation(reservationId, reason, tx?)`; 기존 `UnifiedReservationService.releaseReservation(id, tx?)`.
- Produces:
  ```ts
  @Injectable() export class ReservationReleaseService {
    constructor(db: DbService<typeof wmsSchema>, shipmentReservations: ShipmentReservationService, unifiedReservation: UnifiedReservationService)
    release(reservationId: string, reason?: string): Promise<void>
  }
  @Controller('inventory/reservations') export class ReservationReleaseController {
    @RequirePermission('inventory.stock.adjust') @Delete(':id') @HttpCode(HttpStatus.NO_CONTENT)
    release(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReleaseReservationDto): Promise<void>
  }
  ```
  `ReleaseReservationDto` 는 `apps/core/src/modules/inventory/core/dto/reservation/reserve-stock.dto.ts` 의 기존 것을 import 한다. 기존 Swagger 데코레이터(`@ApiTags('Inventory - Reservations')`, `@ApiOperation`, 204/404/403 + 409 응답)를 옮겨 단다.

- [ ] **Step 1: 실패하는 유닛 스펙을 쓴다**

  `reservation-release.service.spec.ts` (db 는 `select().from().where().limit()` 체인이 `[row]` 또는 `[]` 를 돌려주는 가짜):
  ```ts
  it('routes a shipment-line row to ShipmentReservationService with the given reason', …
    // row { id, targetType: 'SHIPMENT_LINE' }, release(id, '  재고 이동 ') → shipmentReservations.releaseReservation(id, '재고 이동') 1회, unified 0회
  it('uses admin-release when reason is missing or blank', …
    // release(id) 와 release(id, '   ') 둘 다 → releaseReservation(id, 'admin-release')
  it('routes a legacy row without shipment line to UnifiedReservationService', …
    // row { id, targetType: 'FULFILLMENT_ORDER' } → unifiedReservation.releaseReservation(id) 1회, shipmentReservations 0회
  it('throws NotFoundError when the reservation does not exist', …
    // [] → rejects.toBeInstanceOf(NotFoundError), message '예약을 찾을 수 없습니다'
  ```
  `reservation-release.controller.spec.ts`:
  ```ts
  it('requires inventory.stock.adjust and forwards id and reason', …
    // Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, ReservationReleaseController.prototype.release) → ['inventory.stock.adjust']
    // controller.release(id, { reason: 'r' }) → service.release(id, 'r')
  ```

- [ ] **Step 2: 실패 확인**

  Run: `npx jest apps/core/src/modules/fulfillment/services/reservation-release apps/core/src/modules/fulfillment/controllers/reservation-release --maxWorkers=2`
  Expected: 모듈을 찾지 못해 FAIL.

- [ ] **Step 3: 서비스·컨트롤러 구현, 모듈 등록, inventory 쪽 DELETE 제거**

  서비스는 `wmsTables.stockReservations` 에서 `{ id, targetType }` 만 읽어 분기한다(트랜잭션 없이 — 행이 상자 줄 행인지는 바뀌지 않는다. 각 경로가 자기 트랜잭션과 잠금을 쥔다). 컨트롤러는 `return this.service.release(id, dto?.reason)` 한 줄.

- [ ] **Step 4: 통과 확인 + 라우트 게이트**

  Run: `npx jest apps/core/src/modules/fulfillment/services/reservation-release apps/core/src/modules/fulfillment/controllers/reservation-release scripts/security --maxWorkers=2`
  Expected: PASS (`scripts/security/route-classification.spec.ts` 포함 — 옮긴 라우트에 `@RequirePermission` 이 있다).

- [ ] **Step 5: Commit**

  ```bash
  git add apps/core/src/modules/fulfillment/services/reservation-release.service.ts apps/core/src/modules/fulfillment/services/reservation-release.service.spec.ts apps/core/src/modules/fulfillment/controllers/reservation-release.controller.ts apps/core/src/modules/fulfillment/controllers/reservation-release.controller.spec.ts apps/core/src/modules/fulfillment/fulfillment.module.ts apps/core/src/modules/inventory/core/controllers/reservation.controller.ts
  git commit -m "[core] #1543 재고 예약 해제 라우트를 출고 쪽으로 옮겨 상자 줄 예약은 상자 재계산 경로로 보낸다"
  ```

---

### Task 3: Unified 해제가 상자 줄 예약을 거절하고, 줄 상태 표시 스펙을 새 경로로 옮긴다

**Files:**
- Modify: `apps/core/src/modules/inventory/shared/services/unified-reservation.service.ts:118-142`
- Modify: `apps/core/src/modules/sales-order/line-reservation-state/line-state-dirty.guard.spec.ts` (머리 주석 1~11줄, 42~49줄 케이스)
- Modify: `apps/core/src/modules/sales-order/line-reservation-state/line-state-dirty.integration.spec.ts:92-125`
- Modify: `apps/core/src/modules/inventory/shared/services/unified-reservation.service.lifecycle.integration.spec.ts` (상자 줄 예약을 Unified 로 풀던 케이스, ~85-118줄)

**Interfaces:**
- Consumes: Task 1 `ShipmentReservationService.releaseReservation`.
- Produces: `UnifiedReservationService.releaseReservation(id, tx?)` 는 시그니처 그대로, `targetType === 'SHIPMENT_LINE'` 행이면 아무것도 쓰지 않고
  `Error('Shipment-line reservation <id> must be released by ShipmentReservationService.releaseReservation')` 를 던진다.

- [ ] **Step 1: 스펙을 먼저 고친다**
  - lifecycle 통합 스펙의 해당 케이스 → 이름 `refuses to release a shipment-line reservation and leaves it confirmed`: `reservation.releaseReservation(res.id, tx)` 가 `/ShipmentReservationService\.releaseReservation/` 로 reject, 행 `status` 는 `'confirmed'`, `getTotalReservedQuantity` 는 40 그대로.
  - line-state-dirty 통합 스펙 92줄 케이스 → 이름을 `관리자 예약 해제(ShipmentReservationService.releaseReservation) → 그 상자 라인의 주문에 표시가 더해진다` 로, 호출을 `wired.shipmentReservations.releaseReservation(reservation.id, 'admin-release', tx)` 로. 단언(`marksOf` +1, `versionOf` 0)은 그대로.
  - guard 스펙 42줄 케이스 → `ShipmentReservationService.releaseReservation 본문이 recompute 를 부른다` 로: `methodBody('apps/core/src/modules/fulfillment/services/shipment-reservation.service.ts', 'releaseReservation')` 가 `/\bthis\.recompute\(/` 에 맞는다. 머리 주석의 «표시 지점은 셋»을 «둘»로 고치고, 관리자 해제는 `recompute` → `reprojectFulfillmentOrders` 를 지난다고 적는다.

- [ ] **Step 2: 실패 확인**

  Run: `npm run test:core:integration:local -- "(unified-reservation.service.lifecycle|line-state-dirty).integration"`
  Expected: lifecycle 의 새 케이스가 FAIL(지금은 풀려 버린다). line-state-dirty 케이스는 Task 1 덕에 PASS.

- [ ] **Step 3: `UnifiedReservationService.releaseReservation` 을 고친다**

  UPDATE 전에 행을 읽어 없으면 지금처럼 `BadRequestException(\`Reservation ${id} not found\`)`(옛 호출자 호환), `targetType === 'SHIPMENT_LINE'` 이면 위 `Error`. 그 뒤 UPDATE·`recalculateAndPublishForSku` 는 그대로. `markLineStateDirtyForShipmentLines` 호출과 import, #1247 주석은 지운다(이제 상자 줄 행이 여기 오지 않는다).

- [ ] **Step 4: 통과 확인**

  Run: `npm run test:core:integration:local -- "(unified-reservation.service.lifecycle|line-state-dirty|reservation-lifecycle|shipment-reservation).integration"` 그리고 `npx jest apps/core/src/modules/sales-order/line-reservation-state apps/core/src/modules/inventory/shared --maxWorkers=2`
  Expected: 전부 PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/core/src/modules/inventory/shared/services/unified-reservation.service.ts apps/core/src/modules/sales-order/line-reservation-state/line-state-dirty.guard.spec.ts apps/core/src/modules/sales-order/line-reservation-state/line-state-dirty.integration.spec.ts apps/core/src/modules/inventory/shared/services/unified-reservation.service.lifecycle.integration.spec.ts
  git commit -m "[core] #1543 옛 예약 해제 경로가 상자 줄 예약을 받으면 거절한다"
  ```

---

### Task 4: 해제 다이얼로그가 막힌 사유를 토스트로 보여 준다

**Files:**
- Create: `apps/admin-web/src/features/inventory/reservations/components/release-reservation-dialog/release-error-text.ts`
- Create: `apps/admin-web/src/features/inventory/reservations/components/release-reservation-dialog/release-error-text.spec.ts`
- Modify: `apps/admin-web/src/features/inventory/reservations/components/release-reservation-dialog/index.tsx` (`catch` 블록)

**Interfaces:**
- Produces: `export function releaseErrorText(error: unknown): string` — `error` 가 `statusCode === 409` 이고 `message` 가 비어 있지 않은 `Error` 면 그 `message`, 아니면 `'예약 해제에 실패했습니다.'`. (`CustomError`(`apps/admin-web/src/lib/api/customError.ts`)는 서버 `message` 를 `message` 에, 상태를 `statusCode` 에 싣는다. 409 만 서버 문구를 쓰는 이유: 이 라우트의 409 문구는 우리가 정한 현장 말이고, 다른 상태의 문구는 보장되지 않는다.)

- [ ] **Step 1: 실패하는 스펙**

  ```ts
  it('shows the server reason for a 409', () => {
    expect(releaseErrorText(new CustomError({ message: '작업이 시작된 상자의 예약은 풀 수 없습니다', statusCode: 409 })))
      .toBe('작업이 시작된 상자의 예약은 풀 수 없습니다');
  });
  it('falls back for other statuses, empty messages and non-errors', () => {
    expect(releaseErrorText(new CustomError({ message: 'Internal', statusCode: 500 }))).toBe('예약 해제에 실패했습니다.');
    expect(releaseErrorText(new CustomError({ message: '', statusCode: 409 }))).toBe('예약 해제에 실패했습니다.');
    expect(releaseErrorText('boom')).toBe('예약 해제에 실패했습니다.');
  });
  ```

- [ ] **Step 2: 실패 확인**

  Run: `npm run test:admin-web -- release-error-text`
  Expected: 모듈 없음 FAIL.

- [ ] **Step 3: 함수 구현, 다이얼로그 `catch (error) { toast.error(releaseErrorText(error)); }` 로 교체**

- [ ] **Step 4: 통과 확인**

  Run: `npm run test:admin-web -- release-error-text` 그리고 `(cd apps/admin-web && npx tsc --noEmit)`
  Expected: PASS, tsc 에러 0.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/admin-web/src/features/inventory/reservations/components/release-reservation-dialog/
  git commit -m "[admin-web] #1543 예약 해제가 막히면 그 이유를 토스트로 보여 준다"
  ```

---

### Task 5: 전체 게이트

- [ ] **Step 1:** 로컬 E2E 스택이 떠 있지 않은지 확인한다(`ss -ltn | grep -E ':(3000|3001|9092)\b'` 가 비어 있어야 한다. 떠 있으면 사용자에게 묻는다).
- [ ] **Step 2:** `npm run type-check` → 에러 0.
- [ ] **Step 3:** `npx jest --maxWorkers=2` → 실패 0.
- [ ] **Step 4:** `npm run test:admin-web` → 실패 0.
- [ ] **Step 5:** `npm run test:core:integration:local -- "(shipment-reservation|unified-reservation|line-state-dirty|reservation-lifecycle).integration"` → 실패 0.
- [ ] **Step 6:** 실패가 있었고 고쳤으면 커밋. 없으면 커밋하지 않는다.
