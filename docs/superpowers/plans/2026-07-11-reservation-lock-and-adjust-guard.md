# 작업 10 — 예약 잠금 + ON_HAND 감소 가드 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `available`(미예약 ON_HAND)을 소비하는 모든 경로를 `(sku, warehouse)` 단위로 직렬화하고(P1-4), ON_HAND 를 예약 해제 없이 줄이는 경로에 창고합산 예약 가드를 세운다(P1-5).

**Architecture:** `pg_advisory_xact_lock` 기반 `(sku, warehouse)` advisory 락 헬퍼를 `inventory/shared` 에 무상태 함수로 두고, `reserveStock`·`adjustDown`·`transferShip` 세 경로가 각자 락을 잡는다. 멀티키 tx(`tryReserveItems`·`completeSession`)는 정렬 내장 배치 헬퍼로 일괄 획득해 교차 데드락을 막는다. `adjustDown`·`transferShip` 에 "차감 후 창고 ON_HAND 합 ≥ 창고 confirmed 예약 합" 가드를 추가하되, 물리적 사실(실사·파손)은 `bypassReservationGuard` 로 가드를 건너뛰고 대사잡이 `on_hand<reserved` 를 탐지한다.

**Tech Stack:** NestJS, Drizzle ORM(postgres.js), PostgreSQL advisory lock, prom-client, Jest.

## Global Constraints

- **스키마·마이그레이션 무변경.** 락=advisory(스키마 불요), 가드=기존 테이블 쿼리, drift=쿼리, bypass=코드 파라미터. `drizzle/` 파일 생성 금지.
- **advisory 락은 선례를 미러**: `product-sellable-quantity.service.ts:272` 의 `sql\`SELECT pg_advisory_xact_lock(hashtext(${key}))\`` 패턴. 키 = `` `${skuId}:${warehouseId}` ``.
- **bypass 는 THROW 만 건너뛴다. 락은 언제나 획득**(직렬화·drift 일관성).
- **가드 에러 = Nest `ConflictException`** (reserveStock 의 insufficient-stock 과 동일, 파일 관례 일치, `instanceof` 경합 없음 — retry 워커·tryReserveItems 의 `instanceof ConflictException` catch 와 호환).
- **drift 탐지는 raw 합 비교** — 원장 ON_HAND 합 vs confirmed 예약 합 직접 집계. 뷰 `stock_summary.availableQty`(transit_out 반영) **사용 금지**(거짓 경보).
- **면제 경로 불변**: SHIP 소진·`transferReceive`·`moveInternal`·`releaseReservation`·`adjustUp`. 손대지 않는다.
- **검증**: `nest build core` exit 0 · 유닛 spec GREEN · arch 경계 spec(`inventory-write-boundary.arch.spec.ts`) PASS · 변경 파일 신규 eslint 0. 통합 spec 은 dev DB 부재로 로컬 SKIP(`describeIfDb`), dev DB 복구 시 GREEN.
- 설계 근거: `docs/superpowers/specs/2026-07-11-reservation-lock-and-adjust-guard-design.md`.

## File Structure

| 파일 | 책임 | 태스크 |
|---|---|---|
| `inventory/shared/locks/stock-availability-lock.ts` (신규) | advisory 락 헬퍼 + 순수 정렬/dedup | 1 |
| `inventory/shared/services/unified-reservation.service.ts` | reserveStock 에 락 추가 | 2 |
| `inventory/core/services/inventory-command.service.ts` | adjustDown/transferShip 락+가드+bypass, 순수 불변식 fn, 잔고 헬퍼 | 3 |
| `fulfillment/services/fulfillments.service.ts` | tryReserveItems 배치 락 | 4 |
| `inventory/stocktaking/services/stocktaking.service.ts` | completeSession 배치 락 + bypass + inline warn | 5 |
| `inventory/core/services/stock-event.service.ts` | processDamage bypass | 5 |
| `inventory/core/services/ledger-reconciliation.service.ts` | reconcileReservations + 야간 배선 | 6 |
| `inventory/shared/services/metrics.service.ts` | reserved-over-onhand 게이지 | 6 |
| `inventory/core/controllers/ledger-reconciliation.controller.ts` | 온디맨드 예약 drift 라우트 | 6 |
| `inventory/core/dto/ledger-reconciliation.dto.ts` | 예약 drift 리포트 DTO | 6 |
| `docs/logistics-backend-hardening-2026-07.md` | 작업 10 완료 기록 | 7 |

---

### Task 1: 공유 advisory-lock 헬퍼

**Files:**
- Create: `apps/core/src/modules/inventory/shared/locks/stock-availability-lock.ts`
- Test: `apps/core/src/modules/inventory/shared/locks/stock-availability-lock.spec.ts`

**Interfaces:**
- Produces:
  - `interface StockPair { skuId: string; warehouseId: string }`
  - `sortAndDedupeStockPairs(pairs: StockPair[]): StockPair[]` — 순수, `(skuId, warehouseId)` 오름차순 + dedup
  - `acquireStockAvailabilityLock(trx: DbTx, skuId: string, warehouseId: string): Promise<void>`
  - `acquireStockAvailabilityLocks(trx: DbTx, pairs: StockPair[]): Promise<void>` — 정렬/dedup 후 순차 획득

- [ ] **Step 1: 실패 테스트 작성** — 순수 정렬/dedup 만 유닛 테스트(락 획득은 통합에서 행동으로 검증).

```typescript
// stock-availability-lock.spec.ts
import { sortAndDedupeStockPairs } from './stock-availability-lock';

describe('sortAndDedupeStockPairs', () => {
  it('(skuId, warehouseId) 오름차순 정렬', () => {
    const out = sortAndDedupeStockPairs([
      { skuId: 'b', warehouseId: 'w1' },
      { skuId: 'a', warehouseId: 'w2' },
      { skuId: 'a', warehouseId: 'w1' },
    ]);
    expect(out).toEqual([
      { skuId: 'a', warehouseId: 'w1' },
      { skuId: 'a', warehouseId: 'w2' },
      { skuId: 'b', warehouseId: 'w1' },
    ]);
  });

  it('동일 (sku, warehouse) 중복 제거', () => {
    const out = sortAndDedupeStockPairs([
      { skuId: 'a', warehouseId: 'w1' },
      { skuId: 'a', warehouseId: 'w1' },
    ]);
    expect(out).toEqual([{ skuId: 'a', warehouseId: 'w1' }]);
  });

  it('빈 배열은 빈 배열', () => {
    expect(sortAndDedupeStockPairs([])).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest stock-availability-lock`
Expected: FAIL — `Cannot find module './stock-availability-lock'`

- [ ] **Step 3: 구현 작성**

```typescript
// stock-availability-lock.ts
import { sql } from 'drizzle-orm';
import { DbTx } from '../../schema/inventory.schema';

export interface StockPair {
  skuId: string;
  warehouseId: string;
}

/**
 * (sku, warehouse) advisory 락 후보를 결정적 순서로 정렬 + 중복 제거.
 * 멀티키 트랜잭션이 항상 같은 순서로 락을 획득하게 해 교차 데드락을 막는다.
 */
export function sortAndDedupeStockPairs(pairs: StockPair[]): StockPair[] {
  const seen = new Set<string>();
  const unique: StockPair[] = [];
  for (const p of pairs) {
    const key = `${p.skuId}:${p.warehouseId}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(p);
    }
  }
  return unique.sort((a, b) =>
    a.skuId === b.skuId ? a.warehouseId.localeCompare(b.warehouseId) : a.skuId.localeCompare(b.skuId),
  );
}

/**
 * 단일 (sku, warehouse) advisory xact 락. 트랜잭션 종료 시 자동 해제.
 * 선례: product-sellable-quantity.service.ts 의 hashtext 기반 락.
 */
export async function acquireStockAvailabilityLock(trx: DbTx, skuId: string, warehouseId: string): Promise<void> {
  await trx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${skuId}:${warehouseId}`}))`);
}

/** 멀티키: 정렬/dedup 후 순차 획득 (교차 데드락 방지). */
export async function acquireStockAvailabilityLocks(trx: DbTx, pairs: StockPair[]): Promise<void> {
  for (const p of sortAndDedupeStockPairs(pairs)) {
    await acquireStockAvailabilityLock(trx, p.skuId, p.warehouseId);
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest stock-availability-lock`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/inventory/shared/locks/stock-availability-lock.ts \
        apps/core/src/modules/inventory/shared/locks/stock-availability-lock.spec.ts
git commit -m "$(printf '[inventory] (sku,warehouse) advisory 락 공유 헬퍼 (작업 10)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: reserveStock advisory 락 (P1-4)

**Files:**
- Modify: `apps/core/src/modules/inventory/shared/services/unified-reservation.service.ts:56-87`
- Test: `apps/core/src/modules/inventory/shared/services/unified-reservation.service.lock.integration.spec.ts` (신규, `describeIfDb`)

**Interfaces:**
- Consumes: `acquireStockAvailabilityLock` (Task 1)
- Produces: 변경 없음 — `reserveStock` 시그니처 불변, 내부에 락만 추가

- [ ] **Step 1: 통합 테스트 작성 (TOCTOU 직렬화)** — dev DB 부재 시 SKIP.

```typescript
// unified-reservation.service.lock.integration.spec.ts
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { randomUUID } from 'crypto';
import { ConflictException } from '@nestjs/common';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema } from '../../schema/inventory.schema';
import { UnifiedReservationService } from './unified-reservation.service';
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';
import { OutboxService } from '../outbox/outbox.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('UnifiedReservationService reserve lock (DB integration)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 4 });
    db = drizzle(sql, { schema: wmsSchema });
  });
  afterAll(async () => {
    await sql.end();
  });

  function makeService(database: PostgresJsDatabase<typeof wmsSchema>) {
    const dbService = { db: database, run: (fn: any, tx: any) => (tx ? fn(tx) : database.transaction(fn)) } as unknown as DbService<typeof wmsSchema>;
    const outbox = new OutboxService(dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, outbox);
    return new UnifiedReservationService(dbService, sellable);
  }

  it('available=10 에 동시 10 예약 2건 → 정확히 1건만 성공(락 직렬화)', async () => {
    // fixture: sku·warehouse·location + ON_HAND 10 원장 커밋 (committed 필요 — 동시성 관찰용)
    const wh = (await db.insert(wmsTables.warehouses).values({ name: `lk-${randomUUID().slice(0, 8)}` }).returning())[0];
    const holder = (await db.insert(wmsTables.holders).values({ name: `lk-${randomUUID().slice(0, 8)}` }).returning())[0];
    const sku = (await db.insert(wmsTables.skus).values({ name: 'lk', code: `LK-${randomUUID()}`, holderId: holder.id }).returning())[0];
    const loc = (await db.insert(wmsTables.locations).values({ warehouseId: wh.id, code: `L-${randomUUID().slice(0, 8)}` }).returning())[0];
    await db.insert(wmsTables.stockLedgers).values({ skuId: sku.id, warehouseId: wh.id, locationId: loc.id, stockState: 'ON_HAND', qty: 10 });

    const svc = makeService(db);
    const results = await Promise.allSettled([
      svc.reserveStock({ targetType: 'FULFILLMENT_ORDER', targetId: randomUUID(), skuId: sku.id, warehouseId: wh.id, quantity: 10 }),
      svc.reserveStock({ targetType: 'FULFILLMENT_ORDER', targetId: randomUUID(), skuId: sku.id, warehouseId: wh.id, quantity: 10 }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const conflict = results.filter((r) => r.status === 'rejected' && (r as PromiseRejectedResult).reason instanceof ConflictException).length;
    expect(ok).toBe(1);
    expect(conflict).toBe(1);

    // cleanup
    await db.delete(wmsTables.stockReservations).where(eqSku(sku.id));
    await db.delete(wmsTables.stockLedgers).where(eqSku(sku.id));
  });
});

function eqSku(skuId: string) {
  const { eq } = require('drizzle-orm');
  return eq(wmsTables.stockReservations.skuId, skuId);
}
```

> 참고: 이 spec 은 실제 커밋된 동시 tx 를 열어야 하므로 rollback-only 패턴이 아니라 **명시적 cleanup** 을 쓴다. `makeService` 의 `run` stub 은 tx 미전달 시 `db.transaction` 을 열어 실제 커밋을 유도한다.

- [ ] **Step 2: 테스트 SKIP 확인 (로컬)**

Run: `npx jest unified-reservation.service.lock.integration`
Expected: `describe.skip` — 0 실행(로컬 DATABASE_URL 부재). tsc 는 통과해야 한다.

- [ ] **Step 3: reserveStock 에 락 추가**

`unified-reservation.service.ts` 상단 import 추가:

```typescript
import { acquireStockAvailabilityLock } from '../locks/stock-availability-lock';
```

`reserveStock` 의 `run` 콜백 첫 줄에 락 획득 삽입 (기존 `:57-59`):

```typescript
  async reserveStock(dto: ReserveStockDto, tx?: DbTx): Promise<Reservation> {
    return this.db.run(async (trx) => {
      // 0. (sku,warehouse) 직렬화 — available 확인↔INSERT 사이 TOCTOU 차단
      await acquireStockAvailabilityLock(trx, dto.skuId, dto.warehouseId);

      // 1. 사용가능한 재고 확인
      const availableStock = await this.getAvailableStock(dto.skuId, dto.warehouseId, trx);
      // ... (이하 기존 그대로)
```

- [ ] **Step 4: 빌드 + 기존 유닛 회귀 확인**

Run: `npx nest build core`
Expected: exit 0

Run: `npx jest fulfillment-reservations.facade.spec`
Expected: PASS (기존 facade 유닛 회귀 — reserveStock 시그니처 불변 확인)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/inventory/shared/services/unified-reservation.service.ts \
        apps/core/src/modules/inventory/shared/services/unified-reservation.service.lock.integration.spec.ts
git commit -m "$(printf '[inventory] reserveStock TOCTOU advisory 락 (작업 10, P1-4)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: adjustDown/transferShip 락 + 예약 가드 + bypass (P1-5)

**Files:**
- Modify: `apps/core/src/modules/inventory/core/services/inventory-command.service.ts`
- Test(unit): `apps/core/src/modules/inventory/core/services/inventory-command.reservation-guard.spec.ts` (신규, 순수 fn)
- Test(integration): `inventory-command.service.adjust.integration.spec.ts` 에 케이스 추가 (기존 파일)

**Interfaces:**
- Consumes: `acquireStockAvailabilityLock` (Task 1)
- Produces:
  - `violatesReservationInvariant(onHandSum: number, reservedSum: number, removingQty: number): boolean` — export 순수 fn
  - `InventoryCommandService.getWarehouseReservationBalance(trx: DbTx, skuId: string, warehouseId: string): Promise<{ onHand: number; reserved: number }>` — public (Task 5 inline warn 이 재사용)
  - `adjustDown` input 에 `bypassReservationGuard?: boolean` 추가

- [ ] **Step 1: 순수 불변식 fn 실패 테스트**

```typescript
// inventory-command.reservation-guard.spec.ts
import { violatesReservationInvariant } from './inventory-command.service';

describe('violatesReservationInvariant', () => {
  it('차감 후 ON_HAND 가 예약보다 적으면 위반', () => {
    expect(violatesReservationInvariant(10, 6, 5)).toBe(true); // 10-5=5 < 6
  });
  it('차감 후 ON_HAND 가 예약과 같으면 통과', () => {
    expect(violatesReservationInvariant(10, 6, 4)).toBe(false); // 10-4=6 >= 6
  });
  it('예약 0 이면 항상 통과', () => {
    expect(violatesReservationInvariant(10, 0, 10)).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest inventory-command.reservation-guard`
Expected: FAIL — `violatesReservationInvariant is not a function`

- [ ] **Step 3: 순수 fn + 잔고 헬퍼 + 가드 + 락 + bypass 구현**

`inventory-command.service.ts` import 에 `sum` 추가 + 락 헬퍼 import:

```typescript
import { eq, and, gt, desc, sum } from 'drizzle-orm';
import { ConflictException } from '@nestjs/common';
import { acquireStockAvailabilityLock } from '../../shared/locks/stock-availability-lock';
```

파일 하단(클래스 밖)에 export 순수 fn:

```typescript
/** 차감/이동 후 창고 ON_HAND 합이 confirmed 예약 합보다 적어지면 true. */
export function violatesReservationInvariant(onHandSum: number, reservedSum: number, removingQty: number): boolean {
  return onHandSum - removingQty < reservedSum;
}
```

클래스에 public 잔고 헬퍼 + private 가드 추가:

```typescript
  /** 창고 grain ON_HAND 합·confirmed 예약 합 (가드 + 실사 inline warn 공용). */
  async getWarehouseReservationBalance(
    trx: DbTx,
    skuId: string,
    warehouseId: string,
  ): Promise<{ onHand: number; reserved: number }> {
    const [oh] = await trx
      .select({ q: sum(wmsTables.stockLedgers.qty) })
      .from(wmsTables.stockLedgers)
      .where(
        and(
          eq(wmsTables.stockLedgers.skuId, skuId),
          eq(wmsTables.stockLedgers.warehouseId, warehouseId),
          eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
        ),
      );
    const [rv] = await trx
      .select({ q: sum(wmsTables.stockReservations.quantity) })
      .from(wmsTables.stockReservations)
      .where(
        and(
          eq(wmsTables.stockReservations.skuId, skuId),
          eq(wmsTables.stockReservations.warehouseId, warehouseId),
          eq(wmsTables.stockReservations.status, 'confirmed'),
        ),
      );
    return { onHand: Number(oh?.q ?? 0), reserved: Number(rv?.q ?? 0) };
  }

  /** 락 획득 후 호출. 창고 합산 예약 불변식 위반 시 409. */
  private async assertReservationInvariant(
    trx: DbTx,
    skuId: string,
    warehouseId: string,
    removingQty: number,
  ): Promise<void> {
    const { onHand, reserved } = await this.getWarehouseReservationBalance(trx, skuId, warehouseId);
    if (violatesReservationInvariant(onHand, reserved, removingQty)) {
      throw new ConflictException(
        `예약된 재고는 감소/이동할 수 없습니다. 창고 ON_HAND ${onHand} − ${removingQty} < 예약 ${reserved}`,
      );
    }
  }
```

`adjustDown` input 타입에 플래그 추가 + `exec` 안에서 락·가드 배선:

```typescript
  async adjustDown(
    input: {
      skuId: string;
      warehouseId: string;
      locationId?: string | null;
      quantity: number;
      occurredAt?: Date;
      idempotencyKey?: string;
      reason?: string;
      bypassReservationGuard?: boolean; // 실사·파손 등 물리적 사실만 true
    },
    tx?: DbTx,
  ) {
    if (input.quantity <= 0) throw new BadRequestException('quantity must be positive');
    const exec = async (trx: DbTx) => {
      // 0. (sku,warehouse) 직렬화 — bypass 여도 락은 획득
      await acquireStockAvailabilityLock(trx, input.skuId, input.warehouseId);

      // ... (기존 1~2: SKU 조회, effectiveLocationId 결정, location 부족검증 그대로) ...

      // 2.5. 예약 불변식 가드 (물리적 사실이면 건너뜀)
      if (!input.bypassReservationGuard) {
        await this.assertReservationInvariant(trx, input.skuId, input.warehouseId, input.quantity);
      }

      // ... (기존 3~4: 이벤트 생성 + outbox 그대로) ...
    };
    return this.dbService.run(exec, tx);
  }
```

`transferShip` 의 `exec` 에 락 + 가드(bypass 없음):

```typescript
    const exec = async (trx: DbTx) => {
      await acquireStockAvailabilityLock(trx, input.skuId, input.fromWarehouseId);
      await this.assertReservationInvariant(trx, input.skuId, input.fromWarehouseId, input.quantity);
      const event = await this.eventStore.createEvent(/* 기존 그대로 */);
      return { eventId: event?.id ?? null };
    };
```

- [ ] **Step 4: 순수 fn 유닛 통과 + 빌드**

Run: `npx jest inventory-command.reservation-guard`
Expected: PASS (3 tests)

Run: `npx nest build core`
Expected: exit 0

- [ ] **Step 5: 통합 케이스 추가** — 기존 `inventory-command.service.adjust.integration.spec.ts` 에 (fixture 헬퍼 재사용):

```typescript
  it('예약 초과 adjustDown 은 409 로 거부된다', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, sku } = await createFixture(tx);
      await command.adjustUp({ skuId: sku.id, warehouseId: warehouse.id, quantity: 10 }, tx);
      await tx.insert(wmsTables.stockReservations).values({
        targetType: 'FULFILLMENT_ORDER', targetId: randomUUID(), skuId: sku.id,
        warehouseId: warehouse.id, quantity: 6, status: 'confirmed',
      });
      await expect(
        command.adjustDown({ skuId: sku.id, warehouseId: warehouse.id, quantity: 5 }, tx),
      ).rejects.toThrow(/예약된 재고/);
      // 4 까지는 허용 (10-4=6 >= 6)
      await expect(
        command.adjustDown({ skuId: sku.id, warehouseId: warehouse.id, quantity: 4 }, tx),
      ).resolves.toBeDefined();
    });
  });

  it('bypassReservationGuard=true 면 예약 초과여도 적용된다', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, sku } = await createFixture(tx);
      await command.adjustUp({ skuId: sku.id, warehouseId: warehouse.id, quantity: 10 }, tx);
      await tx.insert(wmsTables.stockReservations).values({
        targetType: 'FULFILLMENT_ORDER', targetId: randomUUID(), skuId: sku.id,
        warehouseId: warehouse.id, quantity: 10, status: 'confirmed',
      });
      await expect(
        command.adjustDown({ skuId: sku.id, warehouseId: warehouse.id, quantity: 5, bypassReservationGuard: true }, tx),
      ).resolves.toBeDefined();
      expect(await onHandTotal(tx, sku.id, warehouse.id)).toBe(5); // 실물 반영
    });
  });
```

Run: `npx jest inventory-command.service.adjust.integration`
Expected: 로컬 SKIP(DATABASE_URL 부재). dev DB 복구 시 GREEN.

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/inventory/core/services/inventory-command.service.ts \
        apps/core/src/modules/inventory/core/services/inventory-command.reservation-guard.spec.ts \
        apps/core/src/modules/inventory/core/services/inventory-command.service.adjust.integration.spec.ts
git commit -m "$(printf '[inventory] adjustDown/transferShip 예약 불변식 가드 + 락 + bypass (작업 10, P1-5)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 4: tryReserveItems 배치 락

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/fulfillments.service.ts:796` (루프 전 배치 락)

**Interfaces:**
- Consumes: `acquireStockAvailabilityLocks` (Task 1)

- [ ] **Step 1: import 추가**

```typescript
import { acquireStockAvailabilityLocks } from '../../inventory/shared/locks/stock-availability-lock';
```

- [ ] **Step 2: 루프 진입 전 배치 락 (기존 `:793-796` 사이)**

```typescript
    let totalReservedQty = 0;
    const failures: ReservationFailureDetail[] = [];

    // 멀티-SKU 예약: 전 SKU 락을 (skuId,warehouseId) 정렬로 일괄 획득 → 교차 데드락 방지.
    // (내부 reserveStock 의 단일 락은 같은 tx 재획득이라 무해)
    await acquireStockAvailabilityLocks(
      trx,
      items.map((item) => ({ skuId: item.skuId, warehouseId })),
    );

    for (const item of items) {
      // ... 기존 루프 그대로 ...
```

- [ ] **Step 3: 빌드 + 기존 유닛 회귀**

Run: `npx nest build core`
Expected: exit 0

Run: `npx jest fulfillments`
Expected: PASS (기존 fulfillment 유닛 스위트 회귀)

- [ ] **Step 4: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/fulfillments.service.ts
git commit -m "$(printf '[fulfillment] tryReserveItems 멀티-SKU 배치 락 (작업 10)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

> 참고(구현자용): retry 워커 `retryOne` 은 배치 락 **불필요** — `facade.reserve` 가 예약마다 자체 `db.run` 으로 별도 tx 를 열어 한 tx 에 락 1개만 유지(누적 없음). 손대지 않는다.

---

### Task 5: completeSession 배치 락 + bypass + inline warn; processDamage bypass

**Files:**
- Modify: `apps/core/src/modules/inventory/stocktaking/services/stocktaking.service.ts` (completeSession)
- Modify: `apps/core/src/modules/inventory/core/services/stock-event.service.ts:186` (processDamage)

**Interfaces:**
- Consumes: `acquireStockAvailabilityLocks` (Task 1), `InventoryCommandService.getWarehouseReservationBalance` (Task 3)

- [ ] **Step 1: stocktaking.service 준비** — import + Logger 필드 추가.

`StocktakingService` 는 현재 logger 필드가 없다. import 두 개 추가:

```typescript
import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { acquireStockAvailabilityLocks } from '../../shared/locks/stock-availability-lock';
```

클래스 본문 첫 줄(생성자 위)에 필드 추가:

```typescript
export class StocktakingService {
  private readonly logger = new Logger(StocktakingService.name);

  constructor(
    // ... 기존 그대로 ...
```

- [ ] **Step 2: completeSession 에 배치 락 + bypass + inline warn**

`lines` 로드 직후(기존 `:414` `.for('update')` 다음)에 배치 락:

```typescript
      // 변경 라인 전체 (sku, warehouse) 락 일괄 획득 — 라인별 adjustDown 락 누적의 데드락 방지
      await acquireStockAvailabilityLocks(
        tx,
        lines.map((line) => ({ skuId: line.skuId, warehouseId: session.warehouseId })),
      );
```

`adjustDown` 호출(기존 `:438-448`)에 `bypassReservationGuard: true` 추가:

```typescript
              : await this.commandService.adjustDown(
                  {
                    skuId: line.skuId,
                    warehouseId: session.warehouseId,
                    locationId: line.locationId,
                    quantity: -delta,
                    idempotencyKey,
                    reason,
                    bypassReservationGuard: true, // 실사 = 물리적 사실, 실물 우선
                  },
                  tx,
                );
```

down 조정 직후(같은 tx 라 원장 반영됨) inline warn — `adjustmentsApplied++;` 앞에 삽입:

```typescript
          if (delta < 0) {
            const bal = await this.commandService.getWarehouseReservationBalance(tx, line.skuId, session.warehouseId);
            if (bal.onHand < bal.reserved) {
              this.logger.warn(
                `실사 하향으로 on_hand<reserved: sku=${line.skuId} wh=${session.warehouseId} on_hand=${bal.onHand} reserved=${bal.reserved} — 대사잡·후속 예약 정리 필요`,
              );
            }
          }
```

- [ ] **Step 3: processDamage bypass** — `stock-event.service.ts:186` adjustDown 호출에 플래그:

```typescript
      const event = await this.commandService.adjustDown(
        {
          skuId,
          warehouseId,
          locationId,
          quantity,
          reason: `DAMAGE: ${reason}`,
          bypassReservationGuard: true, // 파손 = 물리적 사실
        },
        executor,
      );
```

- [ ] **Step 4: 빌드 + 기존 유닛 회귀**

Run: `npx nest build core`
Expected: exit 0

Run: `npx jest stocktaking`
Expected: PASS (기존 실사 유닛 회귀 — 작업 1 스위트)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/inventory/stocktaking/services/stocktaking.service.ts \
        apps/core/src/modules/inventory/core/services/stock-event.service.ts
git commit -m "$(printf '[inventory] completeSession 배치 락+bypass+inline warn, 파손 bypass (작업 10)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 6: reserved-over-onhand drift 탐지 (대사잡 확장)

**Files:**
- Modify: `apps/core/src/modules/inventory/core/services/ledger-reconciliation.service.ts`
- Modify: `apps/core/src/modules/inventory/shared/services/metrics.service.ts`
- Modify: `apps/core/src/modules/inventory/core/controllers/ledger-reconciliation.controller.ts`
- Modify: `apps/core/src/modules/inventory/core/dto/ledger-reconciliation.dto.ts`
- Test(unit): `apps/core/src/modules/inventory/core/services/reservation-reconciliation.spec.ts` (순수 fn)
- Test(integration): `ledger-reconciliation.integration.spec.ts` 에 케이스 추가 (기존 파일, ⏸)

**Interfaces:**
- Produces:
  - `isReservationOverReserved(onHand: number, reserved: number): boolean` — export 순수 fn
  - `LedgerReconciliationService.reconcileReservations(filter?, tx?): Promise<ReservationDriftReport>`
  - `MetricsService.setReservedOverOnHand(count: number): void`

- [ ] **Step 1: 순수 fn 실패 테스트**

```typescript
// reservation-reconciliation.spec.ts
import { isReservationOverReserved } from './ledger-reconciliation.service';

describe('isReservationOverReserved', () => {
  it('예약 > ON_HAND 이면 drift', () => {
    expect(isReservationOverReserved(6, 10)).toBe(true);
  });
  it('예약 <= ON_HAND 이면 정상', () => {
    expect(isReservationOverReserved(10, 6)).toBe(false);
    expect(isReservationOverReserved(6, 6)).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest reservation-reconciliation`
Expected: FAIL — `isReservationOverReserved is not a function`

- [ ] **Step 3: 대사잡 확장** — `ledger-reconciliation.service.ts` 에 타입·순수 fn·메서드·야간 배선 추가.

타입 + 순수 fn (파일 상단, `classifyDriftSeverity` 근처):

```typescript
export interface ReservationDriftRow {
  skuId: string;
  warehouseId: string;
  onHandQty: number;
  reservedQty: number;
  shortfall: number; // reservedQty - onHandQty (>0)
}

export interface ReservationDriftReport {
  checkedAt: Date;
  totalDriftGrains: number;
  drifts: ReservationDriftRow[];
}

/** (sku,warehouse) 원장 ON_HAND 합 < confirmed 예약 합 이면 drift. 뷰 미사용(raw 합). */
export function isReservationOverReserved(onHandSum: number, reservedSum: number): boolean {
  return reservedSum > onHandSum;
}

interface ReservationDriftQueryRow {
  sku_id: string;
  warehouse_id: string;
  on_hand_qty: number | string;
  reserved_qty: number | string;
}
```

메서드(`reconcile` 아래):

```typescript
  /**
   * (sku,warehouse) 예약 불변식 대사 — ON_HAND 원장 합 < confirmed 예약 합 grain 만 반환.
   * raw 합 직접 집계(뷰 availableQty 의 transit_out 반영 금지 → 거짓 경보 방지).
   */
  async reconcileReservations(
    filter?: { warehouseId?: string; skuId?: string },
    tx?: DbTx,
  ): Promise<ReservationDriftReport> {
    const warehouseId = filter?.warehouseId;
    const skuId = filter?.skuId;
    const query = sql`
      WITH on_hand AS (
        SELECT sku_id, warehouse_id, SUM(qty)::int AS qty
          FROM stock_ledgers WHERE stock_state = 'ON_HAND'
         GROUP BY sku_id, warehouse_id
      ), reserved AS (
        SELECT sku_id, warehouse_id, SUM(quantity)::int AS qty
          FROM stock_reservations WHERE status = 'confirmed'
         GROUP BY sku_id, warehouse_id
      )
      SELECT r.sku_id, r.warehouse_id,
             coalesce(o.qty, 0) AS on_hand_qty,
             r.qty              AS reserved_qty
        FROM reserved r
        LEFT JOIN on_hand o ON o.sku_id = r.sku_id AND o.warehouse_id = r.warehouse_id
       WHERE r.qty > coalesce(o.qty, 0)
         AND ${skuId ? sql`r.sku_id = ${skuId}` : sql`true`}
         AND ${warehouseId ? sql`r.warehouse_id = ${warehouseId}` : sql`true`}
    `;
    const result = await this.dbService.run(async (trx) => trx.execute(query), tx);
    const rawRows = result as unknown as ReservationDriftQueryRow[];
    const drifts: ReservationDriftRow[] = rawRows.map((r) => {
      const onHandQty = Number(r.on_hand_qty);
      const reservedQty = Number(r.reserved_qty);
      return { skuId: r.sku_id, warehouseId: r.warehouse_id, onHandQty, reservedQty, shortfall: reservedQty - onHandQty };
    });
    return { checkedAt: new Date(), totalDriftGrains: drifts.length, drifts };
  }
```

`scheduledReconcile` 끝에 예약 대사 배선(기존 events↔ledgers 로그 뒤):

```typescript
      const resReport = await this.reconcileReservations();
      this.metrics.setReservedOverOnHand(resReport.totalDriftGrains);
      if (resReport.totalDriftGrains > 0) {
        this.logger.error(
          `❌ Reserved-over-onhand: ${resReport.totalDriftGrains} grains. First 20: ` +
            JSON.stringify(resReport.drifts.slice(0, 20)),
        );
      }
```

- [ ] **Step 4: 게이지 추가** — `metrics.service.ts` 에 `ledgerDriftGauge` 옆:

```typescript
  private readonly reservedOverOnHandGauge = new Gauge({
    name: 'wms_reserved_over_onhand_grains',
    help: 'Number of (sku,warehouse) grains whose confirmed reservations exceed ON_HAND',
    registers: [register],
  });
```

`setLedgerDrift` 옆에 setter:

```typescript
  /** 예약 초과 grain 수 — 정상 실행도 0 을 써서 이전 값 잔존을 막는다. */
  setReservedOverOnHand(count: number) {
    this.reservedOverOnHandGauge.set(count);
  }
```

- [ ] **Step 5: DTO + 컨트롤러 라우트** — `ledger-reconciliation.dto.ts` 에 리포트 DTO 추가(`LedgerReconciliationReportDto` 패턴 미러):

```typescript
export class ReservationDriftRowDto {
  @ApiProperty({ description: 'SKU ID' })
  skuId: string;

  @ApiProperty({ description: '창고 ID' })
  warehouseId: string;

  @ApiProperty({ description: '창고 ON_HAND 원장 합' })
  onHandQty: number;

  @ApiProperty({ description: 'confirmed 예약 합' })
  reservedQty: number;

  @ApiProperty({ description: 'reservedQty - onHandQty (>0)' })
  shortfall: number;
}

export class ReservationDriftReportDto {
  @ApiProperty({ description: '대사 실행 시각', type: String, format: 'date-time' })
  checkedAt: Date;

  @ApiProperty({ description: '예약 초과 grain 총 수' })
  totalDriftGrains: number;

  @ApiProperty({ description: '예약 초과 grain 목록', type: [ReservationDriftRowDto] })
  drifts: ReservationDriftRowDto[];
}
```

컨트롤러 import 에 `ReservationDriftReportDto` 추가 + 라우트:

```typescript
  @Get('reservations')
  @ApiOperation({
    summary: '예약 불변식 대사 (탐지 전용)',
    description: 'ON_HAND 원장 합 < confirmed 예약 합 인 (sku,warehouse) grain 을 조회합니다.',
  })
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiQuery({ name: 'skuId', required: false })
  @ApiResponse({ status: 200, type: ReservationDriftReportDto })
  async getReservationReconciliation(
    @Query('warehouseId') warehouseId?: string,
    @Query('skuId') skuId?: string,
  ): Promise<ReservationDriftReportDto> {
    return this.reconciliationService.reconcileReservations({ warehouseId, skuId });
  }
```

- [ ] **Step 6: 유닛 통과 + 빌드**

Run: `npx jest reservation-reconciliation`
Expected: PASS (2 tests)

Run: `npx nest build core`
Expected: exit 0

- [ ] **Step 7: 통합 케이스 추가** — 기존 `ledger-reconciliation.integration.spec.ts` 에:

```typescript
  it('reconcileReservations 는 예약>ON_HAND grain 을 잡는다', async () => {
    // fixture: ON_HAND 4, confirmed 예약 10 → shortfall 6
    // (해당 spec 의 fixture 헬퍼로 sku/warehouse/ledger/reservation 구성 후)
    const report = await service.reconcileReservations({ skuId, warehouseId });
    expect(report.totalDriftGrains).toBe(1);
    expect(report.drifts[0].shortfall).toBe(6);
  });
```

Run: `npx jest ledger-reconciliation.integration`
Expected: 로컬 SKIP. dev DB 복구 시 GREEN.

- [ ] **Step 8: 커밋**

```bash
git add apps/core/src/modules/inventory/core/services/ledger-reconciliation.service.ts \
        apps/core/src/modules/inventory/core/services/reservation-reconciliation.spec.ts \
        apps/core/src/modules/inventory/shared/services/metrics.service.ts \
        apps/core/src/modules/inventory/core/controllers/ledger-reconciliation.controller.ts \
        apps/core/src/modules/inventory/core/dto/ledger-reconciliation.dto.ts \
        apps/core/src/modules/inventory/core/services/ledger-reconciliation.integration.spec.ts
git commit -m "$(printf '[inventory] 대사잡 on_hand<reserved drift 탐지 축 + 게이지 (작업 10)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 7: 문서 — 현황판 작업 10 완료 기록

**Files:**
- Modify: `docs/logistics-backend-hardening-2026-07.md`

- [ ] **Step 1: 상태 갱신 + 완료 블록**
  - P1-4·P1-5 상태 컬럼 `⬜` → `🟩`.
  - §5 WS-C 아래 "✅ 작업 10 완료" 블록 추가: 잠금 3경로 + 배치 2경로 + 가드 + 실사/파손 bypass + drift 축 + 정정 2건(retry 배치 불필요, 가드=ConflictException) + 브랜치/커밋 + 검증(빌드·유닛·arch GREEN, 통합 ⏸) 요약. Q4 목표모델(이송=예약, W11)·transferShip 가드 범위 확정 명시.

- [ ] **Step 2: 최종 게이트**

Run: `npx nest build core && npx jest inventory-write-boundary.arch`
Expected: build exit 0 · arch 경계 spec PASS

- [ ] **Step 3: 커밋**

```bash
git add docs/logistics-backend-hardening-2026-07.md
git commit -m "$(printf 'docs(core): 작업 10 완료 기록 — 예약 잠금+가드 (WS-C)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Self-Review 반영 사항

- **스펙 커버리지**: Q2 잠금(T1·T2·T3·T4·T5) / Q3 가드+transfer(T3) / Q1 실사·파손 bypass+inline warn(T3·T5) / Q4 drift raw-합(T6) / 문서(T7) — 전 축 태스크 매핑 완료.
- **면제 경로**(SHIP·transferReceive·moveInternal·release·adjustUp): 태스크에서 손대지 않음(Global Constraints 명시) — 회귀는 기존 유닛 스위트가 가드.
- **타입 일관성**: `bypassReservationGuard`(T3 정의 → T5 사용), `getWarehouseReservationBalance`(T3 정의 → T5 사용), `acquireStockAvailabilityLock(s)`(T1 정의 → T2·T3·T4·T5 사용), `violatesReservationInvariant`/`isReservationOverReserved`(순수 fn export) — 시그니처 일치 확인.
- **정정 반영**: retry 워커 배치 락 불필요(T4 note), 가드 에러=`ConflictException`(Global Constraints).
