# 작업 11 — 좀비 예약 대사(P1-3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** terminal FO(`shipped`/`completed`/`canceled`)의 잔존 `confirmed` 예약을 발생원에서 봉합하고 auto-heal 대사 잡으로 해제하여, 영구 잠긴 `available` 재고를 되돌린다.

**Architecture:** 재사용 프리미티브(`releaseFulfillmentOrderReservations`)를 public `releaseLeftoverReservations` 로 노출 → (a) `ship()`/`markDelivered()` 에 동일 tx 방어 sweep, (b) 신규 `FulfillmentReservationReconciliationService`(Task 10 `LedgerReconciliationService` 패턴 미러: raw-SQL 스냅샷 탐지 + FO별 heal + 야간 크론 + Prometheus 게이지). inert timeout 기계(`releaseExpiredReservations`·10분 크론·`expire-stale`)는 절제하고 admin 버튼을 신규 대사로 재배선.

**Tech Stack:** NestJS, Drizzle ORM(postgres.js), `@nestjs/schedule` Cron, prom-client, Jest, Next.js(admin-web).

## Global Constraints

- **스키마·마이그레이션 무변경** — `timeoutAt` 컬럼·응답 DTO 필드는 존치(expand-contract). 새 테이블/enum 없음.
- **heal = release 만, SHIP 원장 append 없음** — `releaseReservation` 은 `status='released'` 로만 바꾼다. on_hand 불변(이미 SHIP 된 FO 이중차감 위험 0).
- **터미널 FO 3상태 = `'shipped'`, `'completed'`, `'canceled'`** — 대사·sweep 은 이 상태만 대상. in-flight 예약 불가침.
- **락 불요** — release 는 `available` 증가라 over-sell 불가(작업 10 §5 락 면제 경로와 일관).
- **도메인 에러** — 서비스는 `@app/shared` 예외(현 파일은 Nest 예외 혼용 — 신규 코드는 throw 안 함, 탐지·heal 뿐).
- **arch 경계** — `inventory-write-boundary.arch.spec.ts` GREEN 유지(신규 코드는 `stockEvents` 직접 INSERT 아님).
- **검증 게이트(작업 완료 시)**: `npx nest build core` exit 0 · arch spec PASS · 변경파일 신규 eslint 0 · admin-web `type-check` 신규 0 · 삭제 심볼 전역 참조 0. 통합 spec 은 dev DB 부재로 ⏸.
- **설계 근거**: `docs/superpowers/specs/2026-07-12-zombie-reservation-reconciliation-design.md`.

---

### Task 1: reservation-lifecycle — public heal 진입 + 반환 카운트 + 고아 정리

**Files:**
- Modify: `apps/core/src/modules/inventory/shared/services/reservation-lifecycle.service.ts`
- Test: `apps/core/src/modules/inventory/shared/services/reservation-lifecycle.service.spec.ts` (create)

**Interfaces:**
- Produces: `ReservationLifecycleService.releaseLeftoverReservations(fulfillmentOrderId: string, reason: string, tx: DbTx): Promise<number>` — FO 의 confirmed 예약 전량 release, release 된 행 수 반환. Task 2·3 이 호출.
- Produces (변경): private `releaseFulfillmentOrderReservations(...)` 반환형 `Promise<void>` → `Promise<number>`.
- Removes: private `recalculateSellableQuantityForReservationSku`, `ProductSellableQuantityService` 주입·import (호출자 0).

- [ ] **Step 1: Write the failing test**

Create `apps/core/src/modules/inventory/shared/services/reservation-lifecycle.service.spec.ts`:

```ts
import { ReservationLifecycleService } from './reservation-lifecycle.service';
import type { UnifiedReservationService } from './unified-reservation.service';
import type { DbTx } from '../../schema/inventory.schema';

// tx.update(...).set(...).where(...) 체인을 흡수하는 최소 fake trx
const fakeTrx = {
  update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
} as unknown as DbTx;

describe('ReservationLifecycleService.releaseLeftoverReservations', () => {
  function build(confirmedRows: { id: string; skuId: string }[]) {
    const getReservationsByTarget = jest.fn().mockResolvedValue(confirmedRows);
    const releaseReservation = jest.fn().mockResolvedValue(undefined);
    const unified = { getReservationsByTarget, releaseReservation } as unknown as UnifiedReservationService;
    const svc = new ReservationLifecycleService({} as never, unified);
    return { svc, getReservationsByTarget, releaseReservation };
  }

  it('terminal FO 의 confirmed 예약을 전량 해제하고 해제 건수를 반환한다', async () => {
    const { svc, getReservationsByTarget, releaseReservation } = build([
      { id: 'r1', skuId: 's1' },
      { id: 'r2', skuId: 's1' },
    ]);

    const released = await svc.releaseLeftoverReservations('fo-1', 'reconcile: test', fakeTrx);

    expect(getReservationsByTarget).toHaveBeenCalledWith('FULFILLMENT_ORDER', 'fo-1', fakeTrx);
    expect(releaseReservation).toHaveBeenCalledTimes(2);
    expect(releaseReservation).toHaveBeenCalledWith('r1', fakeTrx);
    expect(released).toBe(2);
  });

  it('잔존 예약이 없으면 0 을 반환하고 releaseReservation 을 호출하지 않는다', async () => {
    const { svc, releaseReservation } = build([]);
    const released = await svc.releaseLeftoverReservations('fo-2', 'reconcile: test', fakeTrx);
    expect(released).toBe(0);
    expect(releaseReservation).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest apps/core/src/modules/inventory/shared/services/reservation-lifecycle.service.spec.ts`
Expected: FAIL — `releaseLeftoverReservations` is not a function (또는 생성자 인자 수 불일치).

- [ ] **Step 3: Edit `reservation-lifecycle.service.ts`**

3a. Remove the import (line 6):
```ts
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';
```

3b. Replace the constructor (lines 12-16) — drop the `productSellableQuantity` injection:
```ts
  constructor(
    private readonly db: DbService<typeof wmsSchema>,
    private readonly unifiedReservation: UnifiedReservationService,
  ) {}
```

3c. Delete the orphan wrapper (lines 18-20):
```ts
  private async recalculateSellableQuantityForReservationSku(reservation: { skuId: string }, tx: DbTx): Promise<void> {
    await this.productSellableQuantity.recalculateAndPublishForSku(reservation.skuId, tx);
  }
```

3d. Add the public method — insert immediately AFTER `consumeFulfillmentOrderReservations` (after its closing `}` at line 55), BEFORE `private async releaseFulfillmentOrderReservations`:
```ts
  /**
   * 대사·발생원 sweep 용 public 진입 — terminal FO 의 잔존 confirmed 예약을 전량 release.
   * release 는 available 을 되돌릴 뿐 SHIP 원장을 append 하지 않는다(consume 과 동일 메커니즘).
   * @returns release 된 예약 행 수
   */
  async releaseLeftoverReservations(fulfillmentOrderId: string, reason: string, tx: DbTx): Promise<number> {
    return this.releaseFulfillmentOrderReservations(fulfillmentOrderId, reason, tx);
  }
```

3e. Change the private method signature + return (lines 57-86): return type `Promise<void>` → `Promise<number>`, and return the count. Replace the final log line (85) region:
```ts
  private async releaseFulfillmentOrderReservations(
    fulfillmentOrderId: string,
    reason: string,
    tx: DbTx,
  ): Promise<number> {
```
and at the end of the method body, after the FO update (line 83) replace line 85:
```ts
    this.logger.log(`Released ${reservations.length} FO reservations. Reason: ${reason}`);
    return reservations.length;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest apps/core/src/modules/inventory/shared/services/reservation-lifecycle.service.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Verify build + no stale references**

Run: `npx nest build core`
Expected: exit 0.
Run: `grep -rn "recalculateSellableQuantityForReservationSku" apps/core/src`
Expected: no matches (orphan gone).

- [ ] **Step 6: Commit**

```bash
git add apps/core/src/modules/inventory/shared/services/reservation-lifecycle.service.ts apps/core/src/modules/inventory/shared/services/reservation-lifecycle.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(inventory): reservation-lifecycle 에 releaseLeftoverReservations 노출 + 고아 래퍼 제거

작업 11 P1-3 — private releaseFulfillmentOrderReservations 를 대사/발생원
sweep 용 public 진입으로 노출(반환 카운트 추가). 호출자 0 인 고아 래퍼
recalculateSellableQuantityForReservationSku + ProductSellableQuantityService
주입 제거(sellable 재계산은 releaseReservation 경유로 전이 유지).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 발생원 봉합 — `ship()`·`markDelivered()` 방어 sweep

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/fulfillments.service.ts:866-936(ship), 938-958(markDelivered)`
- Test: `apps/core/src/modules/fulfillment/services/fulfillments.service.spec.ts` (extend)

**Interfaces:**
- Consumes: `ReservationLifecycleService.releaseLeftoverReservations(...)` from Task 1. `FulfillmentsService` 는 이미 `this.reservationLifecycle`(생성자 8번째 인자, line 84) 주입 — 신규 주입 불요.

- [ ] **Step 1: Add `releaseLeftoverReservations` to the spec harness mock**

In `fulfillments.service.spec.ts`, the `reservationLifecycle` mock (lines 225-227) currently has only `handleFulfillmentOrderStatusChange`. Add the new method:
```ts
    const reservationLifecycle = {
      handleFulfillmentOrderStatusChange: jest.fn().mockResolvedValue(undefined),
      releaseLeftoverReservations: jest.fn().mockResolvedValue(0),
    };
```

- [ ] **Step 2: Write the failing tests**

Append inside the top-level `describe('FulfillmentsService', ...)` block (e.g. after the existing `describe('markDelivered guard', ...)`), using the existing `makeService` harness (it already fixtures a shipped drop_ship FO `fo-ship-1` and a delivered FO `fo-delivered-1` — reuse those ids as in the neighboring tests):

```ts
  describe('발생원 예약 sweep (작업 11 P1-3)', () => {
    it('ship(drop_ship) 이 잔존 예약 방어 sweep 을 같은 tx 로 호출한다', async () => {
      const { service, reservationLifecycle } = makeService({});
      await service.ship('fo-ship-1');
      expect(reservationLifecycle.releaseLeftoverReservations).toHaveBeenCalledWith(
        'fo-ship-1',
        'reconcile: drop_ship invariant sweep',
        expect.anything(),
      );
    });

    it('markDelivered 가 잔존 예약 방어 sweep 을 같은 tx 로 호출한다', async () => {
      const { service, reservationLifecycle } = makeService({});
      await service.markDelivered('fo-delivered-1');
      expect(reservationLifecycle.releaseLeftoverReservations).toHaveBeenCalledWith(
        'fo-delivered-1',
        'reconcile: FO delivered leftover',
        expect.anything(),
      );
    });
  });
```

> NOTE for implementer: confirm the fixture ids used by the existing `ship`/`markDelivered` happy-path tests (search `service.ship('fo-` and `service.markDelivered('fo-` in the spec, ~lines 1270, 1307) and reuse the same ids so the harness returns a valid FO. If the happy-path test uses a different id, substitute it.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx jest apps/core/src/modules/fulfillment/services/fulfillments.service.spec.ts -t "발생원 예약 sweep"`
Expected: FAIL — `releaseLeftoverReservations` not called.

- [ ] **Step 4: Add the sweep to `ship()`**

In `fulfillments.service.ts`, inside `ship()`, immediately AFTER the FO status update block (lines 903-906, the `.set({ status: 'shipped', shippedAt: now, updatedAt: now })` update) and BEFORE the `salesOrderRow` select (line 908), insert:
```ts
      // drop_ship 불변식("자사 재고 예약 없음") 방어 sweep — 잔존 confirmed 예약이 있으면
      // 좀비가 되므로 같은 tx 로 즉시 해제. 정상 drop_ship 은 항상 0건(no-op).
      const sweptOnShip = await this.reservationLifecycle.releaseLeftoverReservations(
        id,
        'reconcile: drop_ship invariant sweep',
        trx,
      );
      if (sweptOnShip > 0) {
        this.logger.warn(`drop_ship FO ${id} 에서 잔존 예약 ${sweptOnShip}건 sweep — 예약 없음 불변식 위반`);
      }
```

- [ ] **Step 5: Add the sweep to `markDelivered()`**

In `markDelivered()`, immediately AFTER the FO status update block (lines 955-958, the `.set({ status: 'completed', updatedAt: now })` update) and BEFORE the `// 배송 완료 시각을 shipment_tracking에 기록` comment (line 960), insert:
```ts
      // consume 없이 shipped→completed 로 온 FO 의 잔존 예약 방어 sweep.
      // 정상 소진 경로는 ship 시 이미 release 되어 0건(no-op).
      const sweptOnDelivered = await this.reservationLifecycle.releaseLeftoverReservations(
        id,
        'reconcile: FO delivered leftover',
        trx,
      );
      if (sweptOnDelivered > 0) {
        this.logger.warn(`Delivered FO ${id} 에서 잔존 예약 ${sweptOnDelivered}건 sweep`);
      }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest apps/core/src/modules/fulfillment/services/fulfillments.service.spec.ts`
Expected: PASS (existing suite + 2 new tests GREEN — the mock `releaseLeftoverReservations` returns 0 so no warn path).

- [ ] **Step 7: (verification) drop_ship 예약 존재 여부 확인**

Run: `grep -rn "drop_ship" apps/core/src/modules/fulfillment/services/fulfillment-order-reservation-retry.worker.ts apps/core/src/modules/fulfillment/services/fulfillments.service.ts`
Read the `tryReserveItems` (`fulfillments.service.ts:796-830`) and retry worker drop_ship branch to confirm whether drop_ship items ever create reservations. Record the finding in the commit body (sweep is a safe no-op regardless; this only tells us if the `warn` path is reachable in normal operation).

- [ ] **Step 8: Commit**

```bash
git add apps/core/src/modules/fulfillment/services/fulfillments.service.ts apps/core/src/modules/fulfillment/services/fulfillments.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(fulfillment): terminal 전이(ship drop_ship / markDelivered) 예약 sweep

작업 11 P1-3 발생원 봉합 — 예약 해제 없이 terminal 로 가던 두 경로에
같은 tx 방어 sweep 추가(잔존 confirmed release + 발견 시 warn). 정상
경로는 0건 no-op. 대사 잡(Task 3)은 이로써 진짜 safety-net 이 된다.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `FulfillmentReservationReconciliationService` (탐지 + heal + 크론) + 메트릭

**Files:**
- Create: `apps/core/src/modules/inventory/core/services/fulfillment-reservation-reconciliation.service.ts`
- Modify: `apps/core/src/modules/inventory/shared/services/metrics.service.ts` (게이지·카운터·setter 추가)
- Test: `apps/core/src/modules/inventory/core/services/fulfillment-reservation-reconciliation.service.spec.ts` (create)

**Interfaces:**
- Consumes: `ReservationLifecycleService.releaseLeftoverReservations(...)` (Task 1); `DbService<typeof wmsSchema>`; `MetricsService`.
- Produces:
  - `FulfillmentReservationReconciliationService.detectZombieReservations(filter?, tx?): Promise<ZombieReservationReport>`
  - `.reconcileAndHeal(filter?, tx?): Promise<ZombieReconcileResult>`
  - `.scheduledReconcile(): Promise<void>` (`@Cron`)
  - types `ZombieReservationRow`, `ZombieReservationReport`, `ZombieReconcileResult` (Task 4 controller 가 결과형을 사용).
  - `MetricsService.setZombieReservations(count: number)`, `.incZombieReservationsHealed(count: number)`.

- [ ] **Step 1: Add metrics to `metrics.service.ts`**

Add gauge + counter after the `reservedOverOnHandGauge` block (line 108):
```ts
  // 좀비 예약 대사 메트릭 — terminal FO 인데 confirmed 로 남은 예약 행 수(직전 대사 heal 전 탐지값).
  private readonly zombieReservationsGauge = new Gauge({
    name: 'wms_zombie_reservations_grains',
    help: 'Number of confirmed reservations still attached to terminal fulfillment orders (last reconcile, pre-heal)',
    registers: [register],
  });

  private readonly zombieReservationsHealedCounter = new Counter({
    name: 'wms_zombie_reservations_healed_total',
    help: 'Cumulative number of zombie reservations released by reconciliation',
    registers: [register],
  });
```
Add setter methods after `setReservedOverOnHand` (line 253):
```ts
  /** 직전 좀비 대사에서 탐지된 예약 행 수 — 정상 실행도 0 을 써서 이전 값 잔존을 막는다. */
  setZombieReservations(count: number) {
    this.zombieReservationsGauge.set(count);
  }

  /** 대사로 release 한 좀비 예약 누적 수. */
  incZombieReservationsHealed(count: number) {
    if (count > 0) this.zombieReservationsHealedCounter.inc(count);
  }
```

- [ ] **Step 2: Write the failing test**

Create `apps/core/src/modules/inventory/core/services/fulfillment-reservation-reconciliation.service.spec.ts`:
```ts
import {
  FulfillmentReservationReconciliationService,
  ZombieReservationReport,
} from './fulfillment-reservation-reconciliation.service';

function makeReport(over: Partial<ZombieReservationReport>): ZombieReservationReport {
  return { checkedAt: new Date(), totalZombieReservations: 0, totalZombieFos: 0, rows: [], ...over };
}

describe('FulfillmentReservationReconciliationService', () => {
  function build() {
    // db.run(fn) 은 fn(fakeTrx) 을 그대로 실행 (tx 인자 무시)
    const dbService = { run: jest.fn((fn: (trx: unknown) => unknown) => fn({})) } as never;
    const releaseLeftoverReservations = jest.fn().mockResolvedValue(1);
    const reservationLifecycle = { releaseLeftoverReservations } as never;
    const setZombieReservations = jest.fn();
    const incZombieReservationsHealed = jest.fn();
    const metrics = { setZombieReservations, incZombieReservationsHealed } as never;
    const svc = new FulfillmentReservationReconciliationService(dbService, reservationLifecycle, metrics);
    return { svc, releaseLeftoverReservations, setZombieReservations, incZombieReservationsHealed };
  }

  it('reconcileAndHeal 은 FO 단위로 그룹하여 FO 마다 한 번 heal 하고 카운트를 합산한다', async () => {
    const { svc, releaseLeftoverReservations } = build();
    jest.spyOn(svc, 'detectZombieReservations').mockResolvedValue(
      makeReport({
        totalZombieReservations: 3,
        totalZombieFos: 2,
        rows: [
          { reservationId: 'r1', foId: 'fo-A', foStatus: 'shipped', skuId: 's1', warehouseId: 'w1', quantity: 2 },
          { reservationId: 'r2', foId: 'fo-A', foStatus: 'shipped', skuId: 's2', warehouseId: 'w1', quantity: 1 },
          { reservationId: 'r3', foId: 'fo-B', foStatus: 'canceled', skuId: 's1', warehouseId: 'w1', quantity: 4 },
        ],
      }),
    );
    releaseLeftoverReservations.mockResolvedValueOnce(2).mockResolvedValueOnce(1);

    const result = await svc.reconcileAndHeal();

    expect(releaseLeftoverReservations).toHaveBeenCalledTimes(2); // fo-A, fo-B — 한 번씩
    expect(releaseLeftoverReservations).toHaveBeenCalledWith('fo-A', 'reconcile: terminal FO leftover', {});
    expect(result.healedFos).toBe(2);
    expect(result.healedReservations).toBe(3);
  });

  it('한 FO heal 이 실패해도 나머지 FO 는 계속 처리한다', async () => {
    const { svc, releaseLeftoverReservations } = build();
    jest.spyOn(svc, 'detectZombieReservations').mockResolvedValue(
      makeReport({
        totalZombieReservations: 2,
        totalZombieFos: 2,
        rows: [
          { reservationId: 'r1', foId: 'fo-A', foStatus: 'shipped', skuId: 's1', warehouseId: 'w1', quantity: 1 },
          { reservationId: 'r2', foId: 'fo-B', foStatus: 'shipped', skuId: 's1', warehouseId: 'w1', quantity: 1 },
        ],
      }),
    );
    releaseLeftoverReservations.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(1);

    const result = await svc.reconcileAndHeal();

    expect(releaseLeftoverReservations).toHaveBeenCalledTimes(2);
    expect(result.healedFos).toBe(1);
    expect(result.healedReservations).toBe(1);
  });

  it('scheduledReconcile 은 탐지 수를 게이지에 set, heal 수를 counter 에 inc 한다', async () => {
    const { svc, setZombieReservations, incZombieReservationsHealed } = build();
    jest.spyOn(svc, 'reconcileAndHeal').mockResolvedValue({
      checkedAt: new Date(),
      healedFos: 1,
      healedReservations: 3,
      report: makeReport({ totalZombieReservations: 3, totalZombieFos: 1 }),
    });
    await svc.scheduledReconcile();
    expect(setZombieReservations).toHaveBeenCalledWith(3);
    expect(incZombieReservationsHealed).toHaveBeenCalledWith(3);
  });

  it('scheduledReconcile 은 예외를 크론 밖으로 전파하지 않는다', async () => {
    const { svc, setZombieReservations } = build();
    jest.spyOn(svc, 'reconcileAndHeal').mockRejectedValue(new Error('boom'));
    await expect(svc.scheduledReconcile()).resolves.toBeUndefined();
    expect(setZombieReservations).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest apps/core/src/modules/inventory/core/services/fulfillment-reservation-reconciliation.service.spec.ts`
Expected: FAIL — module `./fulfillment-reservation-reconciliation.service` not found.

- [ ] **Step 4: Create the service**

Create `apps/core/src/modules/inventory/core/services/fulfillment-reservation-reconciliation.service.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { wmsSchema, DbTx } from '../../schema/inventory.schema';
import { ReservationLifecycleService } from '../../shared/services/reservation-lifecycle.service';
import { MetricsService } from '../../shared/services/metrics.service';

/** terminal FO(shipped/completed/canceled) 인데 confirmed 로 남은 예약 한 행. */
export interface ZombieReservationRow {
  reservationId: string;
  foId: string;
  foStatus: string;
  skuId: string;
  warehouseId: string;
  quantity: number;
}

export interface ZombieReservationReport {
  checkedAt: Date;
  totalZombieReservations: number;
  totalZombieFos: number;
  rows: ZombieReservationRow[];
}

export interface ZombieReconcileResult {
  checkedAt: Date;
  healedFos: number;
  healedReservations: number;
  report: ZombieReservationReport;
}

// raw sql 결과 원시 행(snake_case 별칭)
interface ZombieQueryRow {
  reservation_id: string;
  fo_id: string;
  fo_status: string;
  sku_id: string;
  warehouse_id: string;
  quantity: number | string;
}

const TERMINAL_FO_STATUSES = ['shipped', 'completed', 'canceled'] as const;

@Injectable()
export class FulfillmentReservationReconciliationService {
  private readonly logger = new Logger(FulfillmentReservationReconciliationService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly reservationLifecycle: ReservationLifecycleService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * terminal FO 에 붙은 confirmed 예약(좀비) 탐지 — 탐지 전용, 단일 스냅샷.
   * FO 상태(진실) 를 기준으로 예약 수명을 판정한다(timeoutAt 아님).
   */
  async detectZombieReservations(
    filter?: { warehouseId?: string; skuId?: string },
    tx?: DbTx,
  ): Promise<ZombieReservationReport> {
    const warehouseId = filter?.warehouseId;
    const skuId = filter?.skuId;
    const query = sql`
      SELECT r.id           AS reservation_id,
             r.target_id    AS fo_id,
             fo.status      AS fo_status,
             r.sku_id       AS sku_id,
             r.warehouse_id AS warehouse_id,
             r.quantity     AS quantity
        FROM stock_reservations r
        JOIN fulfillment_orders fo ON fo.id = r.target_id
       WHERE r.status = 'confirmed'
         AND r.target_type = 'FULFILLMENT_ORDER'
         AND fo.status IN ('shipped', 'completed', 'canceled')
         AND ${skuId ? sql`r.sku_id = ${skuId}` : sql`true`}
         AND ${warehouseId ? sql`r.warehouse_id = ${warehouseId}` : sql`true`}
    `;
    const result = await this.dbService.run(async (trx) => trx.execute(query), tx);
    // execute() 원시 결과 타이핑 — ledger-reconciliation.service.ts 와 동일한 문서화된 캐스트.
    const rawRows = result as unknown as ZombieQueryRow[];
    const rows: ZombieReservationRow[] = rawRows.map((r) => ({
      reservationId: r.reservation_id,
      foId: r.fo_id,
      foStatus: r.fo_status,
      skuId: r.sku_id,
      warehouseId: r.warehouse_id,
      quantity: Number(r.quantity),
    }));
    const uniqueFos = new Set(rows.map((r) => r.foId));
    return {
      checkedAt: new Date(),
      totalZombieReservations: rows.length,
      totalZombieFos: uniqueFos.size,
      rows,
    };
  }

  /**
   * 좀비 탐지 → FO 단위로 heal(release). FO 마다 독립 tx 로 격리(한 FO 실패가 나머지 미차단).
   * heal = release 만 — on_hand 무터치, 멱등(재실행 시 confirmed 0건).
   */
  async reconcileAndHeal(
    filter?: { warehouseId?: string; skuId?: string },
    tx?: DbTx,
  ): Promise<ZombieReconcileResult> {
    const report = await this.detectZombieReservations(filter, tx);
    const foIds = [...new Set(report.rows.map((r) => r.foId))];

    let healedFos = 0;
    let healedReservations = 0;
    for (const foId of foIds) {
      try {
        const released = await this.dbService.run(
          (trx) => this.reservationLifecycle.releaseLeftoverReservations(foId, 'reconcile: terminal FO leftover', trx),
          tx,
        );
        if (released > 0) {
          healedFos += 1;
          healedReservations += released;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Zombie heal failed for FO ${foId}: ${message}`);
      }
    }

    return { checkedAt: report.checkedAt, healedFos, healedReservations, report };
  }

  /**
   * 야간 대사 — Task 10 원장 대사(03:00) 뒤 staggered. drift 를 게이지로 표면화하고 heal.
   * 잡 예외가 스케줄러를 죽이지 않도록 try/catch.
   */
  @Cron('5 3 * * *', { name: 'zombie-reservation-reconciliation', timeZone: 'Asia/Seoul' })
  async scheduledReconcile(): Promise<void> {
    try {
      const result = await this.reconcileAndHeal();
      this.metrics.setZombieReservations(result.report.totalZombieReservations);
      this.metrics.incZombieReservationsHealed(result.healedReservations);

      if (result.report.totalZombieReservations === 0) {
        this.logger.log('✅ Zombie reservation reconciliation clean — no terminal-FO leftovers');
      } else {
        this.logger.warn(
          `Zombie reservations healed: ${result.healedReservations} across ${result.healedFos} FOs ` +
            `(detected ${result.report.totalZombieReservations} in ${result.report.totalZombieFos} FOs). ` +
            `First 20: ` +
            JSON.stringify(result.report.rows.slice(0, 20)),
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Zombie reservation reconciliation job failed: ${message}`, stack);
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest apps/core/src/modules/inventory/core/services/fulfillment-reservation-reconciliation.service.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Build**

Run: `npx nest build core`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/core/src/modules/inventory/core/services/fulfillment-reservation-reconciliation.service.ts apps/core/src/modules/inventory/core/services/fulfillment-reservation-reconciliation.service.spec.ts apps/core/src/modules/inventory/shared/services/metrics.service.ts
git commit -m "$(cat <<'EOF'
feat(inventory): 좀비 예약 대사 서비스(FO 상태↔예약) + 메트릭

작업 11 P1-3 — terminal FO 의 잔존 confirmed 예약을 탐지(raw-SQL 스냅샷)
→ FO 단위 heal(release, 멱등·락 불요·on_hand 무터치) + 야간 크론(03:05 KST,
Task 10 원장 대사 뒤 staggered) + 게이지/카운터. LedgerReconciliationService
패턴 미러.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 서비스 배선 + `POST /inventory/reservations/reconcile` 엔드포인트

**Files:**
- Modify: `apps/core/src/modules/inventory/core/inventory.module.ts` (provider 추가)
- Modify: `apps/core/src/modules/inventory/core/controllers/reservation.controller.ts` (reconcile 라우트 추가 + 서비스 주입)
- Test: `apps/core/src/modules/inventory/core/controllers/reservation.controller.spec.ts` (create)

**Interfaces:**
- Consumes: `FulfillmentReservationReconciliationService.reconcileAndHeal(...)` (Task 3).
- Produces: `POST /inventory/reservations/reconcile` → `{ healedFos: number; healedReservations: number }`.

> NOTE: expire-stale 라우트 **제거는 Task 5**(timeout 절제)에서. 이 Task 는 신규만 추가 — 두 라우트가 잠시 공존해도 무해.

- [ ] **Step 1: Register the provider in `inventory.module.ts`**

Add import after line 25 (`LedgerReconciliationService` import):
```ts
import { FulfillmentReservationReconciliationService } from './services/fulfillment-reservation-reconciliation.service';
```
Add to the `providers` array after `LedgerReconciliationService,` (line 60):
```ts
    FulfillmentReservationReconciliationService,
```

- [ ] **Step 2: Write the failing controller test**

Create `apps/core/src/modules/inventory/core/controllers/reservation.controller.spec.ts`:
```ts
import { ReservationController } from './reservation.controller';
import type { UnifiedReservationService } from '../../shared/services/unified-reservation.service';
import type { FulfillmentReservationReconciliationService } from '../services/fulfillment-reservation-reconciliation.service';

describe('ReservationController.reconcile', () => {
  it('reconcileAndHeal 을 호출하고 heal 카운트를 반환한다', async () => {
    const reconcileAndHeal = jest.fn().mockResolvedValue({
      checkedAt: new Date(),
      healedFos: 2,
      healedReservations: 5,
      report: { checkedAt: new Date(), totalZombieReservations: 5, totalZombieFos: 2, rows: [] },
    });
    const reconciliation = { reconcileAndHeal } as unknown as FulfillmentReservationReconciliationService;
    const controller = new ReservationController({} as unknown as UnifiedReservationService, reconciliation);

    const result = await controller.reconcileReservations();

    expect(reconcileAndHeal).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ healedFos: 2, healedReservations: 5 });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest apps/core/src/modules/inventory/core/controllers/reservation.controller.spec.ts`
Expected: FAIL — constructor arity / `reconcileReservations` not a function.

- [ ] **Step 4: Edit `reservation.controller.ts`**

4a. Add import after line 17:
```ts
import { FulfillmentReservationReconciliationService } from '../services/fulfillment-reservation-reconciliation.service';
```
4b. Replace the constructor (line 22):
```ts
  constructor(
    private readonly unifiedReservation: UnifiedReservationService,
    private readonly reconciliation: FulfillmentReservationReconciliationService,
  ) {}
```
4c. Add the reconcile route (place it before the class-closing `}`, after `getReservationSummary`):
```ts
  /**
   * 예약 정합성 정리 (관리자용) — terminal FO 의 잔존 confirmed 예약을 대사 후 해제.
   */
  @Post('reconcile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '예약 정합성 정리',
    description: 'terminal FO(shipped/completed/canceled)에 남은 confirmed 예약(좀비)을 탐지·해제합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '해제 결과',
    schema: {
      type: 'object',
      properties: {
        healedFos: { type: 'number', example: 2 },
        healedReservations: { type: 'number', example: 5 },
      },
    },
  })
  async reconcileReservations(): Promise<{ healedFos: number; healedReservations: number }> {
    const result = await this.reconciliation.reconcileAndHeal();
    return { healedFos: result.healedFos, healedReservations: result.healedReservations };
  }
```

- [ ] **Step 5: Run test + build**

Run: `npx jest apps/core/src/modules/inventory/core/controllers/reservation.controller.spec.ts`
Expected: PASS.
Run: `npx nest build core`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/core/src/modules/inventory/core/inventory.module.ts apps/core/src/modules/inventory/core/controllers/reservation.controller.ts apps/core/src/modules/inventory/core/controllers/reservation.controller.spec.ts
git commit -m "$(cat <<'EOF'
feat(inventory): POST /inventory/reservations/reconcile + 서비스 배선

작업 11 P1-3 — 좀비 대사 서비스를 CoreInventoryModule 에 등록하고
온디맨드 heal 엔드포인트를 ReservationController 에 추가.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: timeout 기계 절제 (releaseExpiredReservations · 크론 · expire-stale)

**Files:**
- Delete: `apps/core/src/modules/inventory/core/services/reservation-cron.service.ts`
- Modify: `apps/core/src/modules/inventory/core/inventory.module.ts` (`ReservationCronService` import·provider 제거)
- Modify: `apps/core/src/modules/inventory/shared/services/unified-reservation.service.ts` (`releaseExpiredReservations` + unused import 제거)
- Modify: `apps/core/src/modules/inventory/core/controllers/reservation.controller.ts` (`expire-stale` 라우트 제거)

**Interfaces:**
- Removes: `POST /inventory/reservations/expire-stale`, `UnifiedReservationService.releaseExpiredReservations`, `ReservationCronService`. (모두 호출자 = 서로 + 삭제 대상. `timeoutAt` 컬럼·응답 필드 존치.)

- [ ] **Step 1: Delete `ReservationCronService` + module wiring**

```bash
git rm apps/core/src/modules/inventory/core/services/reservation-cron.service.ts
```
In `inventory.module.ts`, delete the import line (line 24):
```ts
import { ReservationCronService } from './services/reservation-cron.service';
```
and delete the `ReservationCronService,` entry from the `providers` array (line 59).

- [ ] **Step 2: Remove `releaseExpiredReservations` + unused imports from `unified-reservation.service.ts`**

Delete the whole method (lines 235-265, the `/** 예약 만료 처리 ... */` doc comment through the method's closing `}`). Then fix the drizzle import (line 4) — `lt` and `isNotNull` are now unused:
```ts
import { eq, and, sum, sql } from 'drizzle-orm';
```

- [ ] **Step 3: Remove `expire-stale` route from `reservation.controller.ts`**

Delete the entire `expire-stale` block (the `/** 만료된 예약 처리 ... */` doc comment through the `expireStaleReservations()` method's closing `}` — original lines 147-174).

- [ ] **Step 4: Build + verify no stale references**

Run: `npx nest build core`
Expected: exit 0.
Run: `grep -rn "releaseExpiredReservations\|ReservationCronService\|expire-stale" apps/core/src`
Expected: no matches.

- [ ] **Step 5: Run affected unit suites**

Run: `npx jest apps/core/src/modules/inventory/core/controllers/reservation.controller.spec.ts apps/core/src/modules/inventory/core/services/fulfillment-reservation-reconciliation.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A apps/core/src/modules/inventory
git commit -m "$(cat <<'EOF'
refactor(inventory): inert timeout 예약 만료 기계 절제

작업 11 P1-3 — timeoutAt 을 채우는 생산자가 없어 항상 no-op 이던 만료
경로 제거: releaseExpiredReservations · 10분/시간 크론(ReservationCronService)
· POST expire-stale. 예약 수명 기준을 FO 상태(대사)로 일원화. timeoutAt
컬럼·응답 필드는 expand-contract 로 존치.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: admin-web 재배선 (버튼 → reconcile, "만료 시각" 컬럼 제거)

**Files:**
- Modify: `apps/admin-web/src/lib/types/dto/inventory.ts` (`ExpireStaleReservationsResponseDto` → `ReconcileReservationsResponseDto`)
- Modify: `apps/admin-web/src/lib/api/domains/inventory/reservations.client.ts` (`expireStaleReservations` → `reconcileReservations`)
- Modify: `apps/admin-web/src/lib/services/inventory/mutations.ts` (`useExpireStaleReservations` → `useReconcileReservations`)
- Modify: `apps/admin-web/src/features/inventory/reservations/template/index.tsx` (버튼·핸들러·토스트)
- Modify: `apps/admin-web/src/hooks/table/columns/use-reservations-table-columns.tsx` ("만료 시각" 컬럼 제거)

**Interfaces:**
- Consumes: `POST /inventory/reservations/reconcile` returning `{ healedFos, healedReservations }` (Task 4).

- [ ] **Step 1: Rename the response DTO type**

In `apps/admin-web/src/lib/types/dto/inventory.ts`, replace `ExpireStaleReservationsResponseDto` (lines 1261-1264):
```ts
export interface ReconcileReservationsResponseDto {
  healedFos: number;
  healedReservations: number;
}
```
(Leave `ReservationDto.timeoutAt` at line 1242 unchanged — backend response DTO keeps it.)

- [ ] **Step 2: Rewire the client fn**

In `reservations.client.ts`, update the type import (lines 5-10) — replace `ExpireStaleReservationsResponseDto` with `ReconcileReservationsResponseDto`. Replace the `expireStaleReservations` method (lines 49-54):
```ts
  reconcileReservations: async (): Promise<ReconcileReservationsResponseDto> => {
    const response = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/inventory/reservations/reconcile`
    );
    return response.data;
  },
```

- [ ] **Step 3: Rewire the mutation hook**

In `mutations.ts`, replace `useExpireStaleReservations` (lines 597-605):
```ts
export const useReconcileReservations = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => reservationsClient.reconcileReservations(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'reservations'] });
    },
  });
};
```
> Check the barrel `apps/admin-web/src/lib/services/inventory/index.ts` — if it re-exports `useExpireStaleReservations` by name, rename that export too (grep confirms in Step 6).

- [ ] **Step 4: Rewire the button + handler in `template/index.tsx`**

4a. Update the hook import (line 13) `useExpireStaleReservations` → `useReconcileReservations`.
4b. Replace the hook call (line 38):
```ts
  const reconcileMutation = useReconcileReservations();
```
4c. Replace the handler (lines 52-59):
```ts
  const handleReconcile = async () => {
    try {
      const result = await reconcileMutation.mutateAsync();
      toast.success(`예약 정합성 정리 완료: ${result.healedReservations}건 해제 (${result.healedFos}개 주문)`);
    } catch {
      toast.error('예약 정합성 정리에 실패했습니다.');
    }
  };
```
4d. Replace the button (lines 81-89):
```tsx
          <Button
            variant="outline"
            size="sm"
            onClick={handleReconcile}
            disabled={reconcileMutation.isPending}
          >
            {reconcileMutation.isPending ? '처리 중...' : '예약 정합성 정리'}
          </Button>
```

- [ ] **Step 5: Remove the "만료 시각" column**

In `use-reservations-table-columns.tsx`, delete the `timeoutAt` column block (lines 90-96, the full `columnHelper.accessor('timeoutAt', {...}),` including trailing comma). The `reason` (84-89) and `createdAt` (97-100) columns stay.

- [ ] **Step 6: Verify — no stale references + type-check**

Run: `grep -rn "expireStale\|useExpireStaleReservations\|ExpireStaleReservationsResponseDto\|expire-stale" apps/admin-web/src`
Expected: no matches.
Run: `cd apps/admin-web && npm run type-check`
Expected: no NEW errors introduced by these files (repo has pre-existing TS7006 debt — compare against baseline; the 5 changed files must contribute 0 new errors).

- [ ] **Step 7: Commit**

```bash
git add apps/admin-web/src/lib/types/dto/inventory.ts apps/admin-web/src/lib/api/domains/inventory/reservations.client.ts apps/admin-web/src/lib/services/inventory/mutations.ts apps/admin-web/src/features/inventory/reservations/template/index.tsx apps/admin-web/src/hooks/table/columns/use-reservations-table-columns.tsx
git commit -m "$(cat <<'EOF'
feat(admin-web): 예약 페이지 버튼을 정합성 정리(reconcile)로 재배선

작업 11 P1-3 — placebo 였던 "만료된 예약 일괄 해제"(expire-stale) 를
"예약 정합성 정리"(POST /reconcile) 로 교체. 항상 "-" 이던 "만료 시각"
컬럼 제거. 응답 타입 ReconcileReservationsResponseDto.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## 최종 검증 (전체 완료 후)

- [ ] `npx nest build core` exit 0
- [ ] arch 경계: `npx jest apps/core/src/modules/inventory/core/services/inventory-write-boundary.arch.spec.ts` PASS
- [ ] 신규/변경 유닛 전량 GREEN: `npx jest reservation-lifecycle.service fulfillment-reservation-reconciliation reservation.controller fulfillments.service`
- [ ] 삭제 심볼 전역 참조 0: `grep -rn "releaseExpiredReservations\|ReservationCronService\|expireStaleReservations\|expire-stale\|recalculateSellableQuantityForReservationSku" apps` → 무매치
- [ ] admin-web `cd apps/admin-web && npm run type-check` — 변경 파일 신규 에러 0
- [ ] 변경 파일 eslint 신규 에러 0: `npx eslint <changed .ts files>`
- [ ] 통합 spec(⏸ dev DB): 좀비 heal end-to-end·멱등·발생원 sweep — dev DB 복구 시 실행(작업 1~3·10 ⏸ 항목과 동일 배치).

## Self-Review 결과 (작성자 체크)

- **Spec 커버리지**: §4.A→Task1·2, §4.B→Task3, §4.B-5 엔드포인트→Task4, §4.C→Task5, §4.D→Task6, §4.A-4 고아정리→Task1. 전 항목 태스크 매핑됨.
- **Placeholder**: 없음(모든 코드 블록 실체).
- **타입 일관성**: `releaseLeftoverReservations(string,string,DbTx):Promise<number>` (Task1 정의 ↔ Task2·3 소비 일치). `ZombieReconcileResult{healedFos,healedReservations,report}` (Task3 정의 ↔ Task4 controller·Task6 FE 일치). `ReconcileReservationsResponseDto{healedFos,healedReservations}` (Task6 내부 일치).
