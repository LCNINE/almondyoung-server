# 작업 10b — reverseEvent 락·가드 배선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `StockEventStore.reverseEvent` 가 ON_HAND 를 순감소시키는 방향일 때만 작업 10 의 `(sku,warehouse)` advisory 락 + 창고합산 예약 불변식 가드를 적용해, 예약 걸린 재고의 역분개를 차단한다.

**Architecture:** 예약 불변식 가드 로직을 `InventoryCommandService` 에서 `inventory/shared/locks/` leaf 로 추출(store↔command 순환 회피)한 뒤, 역분개 방향 판정 순수 헬퍼 `reversalOnHandDecrement` 를 store 에 추가하고, `reverseEvent` 내부에 락+가드를 배선한다. dead 표면 C(`InventoryCommandService.reverseEvent`)는 절제한다.

**Tech Stack:** NestJS · Drizzle ORM(postgres.js) · Jest · Postgres `pg_advisory_xact_lock`.

## Global Constraints

설계 스펙: `docs/superpowers/specs/2026-07-12-reverse-event-lock-and-guard-design.md`. 스프린트 현황판 §5 공통 규약:

- **스키마·마이그레이션 무변경** — `stockReservations`·`stockLedgers`·enum 무변경.
- `nest build core` **exit 0**.
- arch 경계 spec `inventory-write-boundary.arch.spec.ts` **PASS** (reverseEvent 의 `stockEvents` 직접 INSERT 는 store 내부라 허용 — 무변경).
- **변경 파일 신규 eslint error 만** 판정(repo 전역 lint 는 상시 debt — 전역 결과로 판정 금지).
- **admin-web 무변경**.
- 삭제 심볼(`InventoryCommandService.reverseEvent`) **저장소 전역 참조 0**.
- 통합 spec 은 dev DB 부재로 **⏸(SKIP)** — `describeIfDb` 가드. build/jest 가 `isolatedModules` 라 spec 을 타입체크 안 하므로, deferred spec 은 별도 `tsc`(isolatedModules off)로 타입체크(작업 10 발견).
- 브랜치 `feat/reverse-event-lock-and-guard` (이미 생성됨, 스펙 커밋 `4440228ed`).

**공용 검증 커맨드:**
```bash
# 빌드
npx nest build core
# 유닛(변경 관련만 빠르게)
npx jest --testPathPattern="inventory/(shared/locks|core/(services|repositories))" --testPathIgnorePatterns=".integration.spec.ts"
# arch 경계
npx jest --testPathPattern="inventory-write-boundary.arch.spec"
# deferred 통합 spec 타입체크(런타임 아님)
npx tsc --noEmit -p apps/core/tsconfig.app.json 2>&1 | grep -i "reverse-event-guard" || echo "no type errors in target spec"
```

---

## File Structure

- **Create** `apps/core/src/modules/inventory/shared/locks/reservation-invariant.ts` — 불변식 가드 leaf 3함수.
- **Create** `apps/core/src/modules/inventory/shared/locks/reservation-invariant.spec.ts` — `violatesReservationInvariant` 유닛(이전).
- **Delete** `apps/core/src/modules/inventory/core/services/inventory-command.reservation-guard.spec.ts` — 내용 이전.
- **Modify** `apps/core/src/modules/inventory/core/services/inventory-command.service.ts` — 3정의 제거·호출부 전환·import 정리·dead reverseEvent 삭제.
- **Modify** `apps/core/src/modules/inventory/stocktaking/services/stocktaking.service.ts` — `:473` + import.
- **Modify** `apps/core/src/modules/inventory/core/repositories/stock-event.store.ts` — `reversalOnHandDecrement` export + `reverseEvent` 배선 + import.
- **Create** `apps/core/src/modules/inventory/core/repositories/stock-event.store.reversal-direction.spec.ts` — `reversalOnHandDecrement` 유닛.
- **Create** `apps/core/src/modules/inventory/core/repositories/reverse-event-guard.integration.spec.ts` — DB 통합(⏸ deferred).

---

## Task 1: 불변식 가드를 shared leaf 로 추출 (동작 무변경 리팩터)

`InventoryCommandService` 의 예약 불변식 3종을 `shared/locks/reservation-invariant.ts` 로 옮겨 store·command·stocktaking 이 공유하게 한다. **동작 변경 없음** — 순수 이동 + 호출부 재배선.

**Files:**
- Create: `apps/core/src/modules/inventory/shared/locks/reservation-invariant.ts`
- Create: `apps/core/src/modules/inventory/shared/locks/reservation-invariant.spec.ts`
- Delete: `apps/core/src/modules/inventory/core/services/inventory-command.reservation-guard.spec.ts`
- Modify: `apps/core/src/modules/inventory/core/services/inventory-command.service.ts` (imports·L212·L370-399·L471·L571-574)
- Modify: `apps/core/src/modules/inventory/stocktaking/services/stocktaking.service.ts` (imports·L473)

**Interfaces:**
- Produces:
  - `readWarehouseReservationBalance(trx: DbTx, skuId: string, warehouseId: string): Promise<{ onHand: number; reserved: number }>`
  - `violatesReservationInvariant(onHandSum: number, reservedSum: number, removingQty: number): boolean`
  - `assertReservationInvariant(trx: DbTx, skuId: string, warehouseId: string, removingQty: number): Promise<void>` (위반 시 `ConflictException`)

- [ ] **Step 1: shared leaf 파일 생성**

Create `apps/core/src/modules/inventory/shared/locks/reservation-invariant.ts`:

```ts
import { ConflictException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbTx } from '../../schema/inventory.schema';

/**
 * 창고 grain ON_HAND 원장 합·confirmed 예약 합 (단일 statement 원자 읽기 — torn read 방지, 작업 10 I-1).
 * store·command·stocktaking 공용 leaf — core↔store 순환을 피하려고 InventoryCommandService 에서 추출.
 */
export async function readWarehouseReservationBalance(
  trx: DbTx,
  skuId: string,
  warehouseId: string,
): Promise<{ onHand: number; reserved: number }> {
  const rows = (await trx.execute(sql`
    SELECT
      COALESCE((SELECT SUM(qty) FROM stock_ledgers
                 WHERE sku_id = ${skuId} AND warehouse_id = ${warehouseId} AND stock_state = 'ON_HAND'), 0) AS on_hand,
      COALESCE((SELECT SUM(quantity) FROM stock_reservations
                 WHERE sku_id = ${skuId} AND warehouse_id = ${warehouseId} AND status = 'confirmed'), 0) AS reserved
  `)) as unknown as { on_hand: number | string; reserved: number | string }[];
  return { onHand: Number(rows[0]?.on_hand ?? 0), reserved: Number(rows[0]?.reserved ?? 0) };
}

/** 차감/이동 후 창고 ON_HAND 합이 confirmed 예약 합보다 적어지면 true. */
export function violatesReservationInvariant(onHandSum: number, reservedSum: number, removingQty: number): boolean {
  return onHandSum - removingQty < reservedSum;
}

/** 락 획득 후 호출. 창고 합산 예약 불변식 위반 시 409(ConflictException). */
export async function assertReservationInvariant(
  trx: DbTx,
  skuId: string,
  warehouseId: string,
  removingQty: number,
): Promise<void> {
  const { onHand, reserved } = await readWarehouseReservationBalance(trx, skuId, warehouseId);
  if (violatesReservationInvariant(onHand, reserved, removingQty)) {
    throw new ConflictException(
      `예약된 재고는 감소/이동할 수 없습니다. 창고 ON_HAND ${onHand} − ${removingQty} < 예약 ${reserved}`,
    );
  }
}
```

- [ ] **Step 2: 이전된 유닛 테스트 생성**

Create `apps/core/src/modules/inventory/shared/locks/reservation-invariant.spec.ts`:

```ts
import { violatesReservationInvariant } from './reservation-invariant';

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

- [ ] **Step 3: 새 spec 통과 확인**

Run: `npx jest --testPathPattern="shared/locks/reservation-invariant.spec"`
Expected: PASS (3 tests).

- [ ] **Step 4: 기존 spec 삭제**

```bash
git rm apps/core/src/modules/inventory/core/services/inventory-command.reservation-guard.spec.ts
```

- [ ] **Step 5: `inventory-command.service.ts` import 정리 + shared import 추가**

`inventory-command.service.ts:1` — `ConflictException` 제거:
```ts
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
```
`:7` — `sql` 제거:
```ts
import { eq, and, gt, desc } from 'drizzle-orm';
```
`:8` 아래에 shared import 추가:
```ts
import { acquireStockAvailabilityLock } from '../../shared/locks/stock-availability-lock';
import { assertReservationInvariant } from '../../shared/locks/reservation-invariant';
```

- [ ] **Step 6: `inventory-command.service.ts` 의 3정의 제거**

`getWarehouseReservationBalance`(현 L369-384: 주석 `/** 창고 grain ... 공용. */` 포함)·`assertReservationInvariant`(현 L386-399)·파일 하단 `violatesReservationInvariant`(현 L571-574) **전부 삭제**. 이 3개 블록만 지우고 다른 코드는 건드리지 않는다.

- [ ] **Step 7: 호출부를 free function 으로 전환**

`transferShip` (현 L212):
```ts
      await assertReservationInvariant(trx, input.skuId, input.fromWarehouseId, input.quantity);
```
`adjustDown` (현 L471):
```ts
        await assertReservationInvariant(trx, input.skuId, input.warehouseId, input.quantity);
```
(`this.` 만 제거 — 나머지 동일.)

- [ ] **Step 8: `stocktaking.service.ts` 를 shared import 로 전환**

`:5` 아래에 import 추가:
```ts
import { readWarehouseReservationBalance } from '../../shared/locks/reservation-invariant';
```
`:473`:
```ts
            const bal = await readWarehouseReservationBalance(tx, line.skuId, session.warehouseId);
```

- [ ] **Step 9: 빌드 + 유닛 + arch 회귀 확인**

```bash
npx nest build core
npx jest --testPathPattern="inventory/(shared/locks|core/services|stocktaking)" --testPathIgnorePatterns=".integration.spec.ts"
npx jest --testPathPattern="inventory-write-boundary.arch.spec"
```
Expected: build exit 0 · 유닛 GREEN (기존 command/stocktaking 유닛 회귀 없음) · arch PASS.

- [ ] **Step 10: 변경 파일 신규 eslint 확인**

```bash
npx eslint apps/core/src/modules/inventory/shared/locks/reservation-invariant.ts apps/core/src/modules/inventory/core/services/inventory-command.service.ts apps/core/src/modules/inventory/stocktaking/services/stocktaking.service.ts
```
Expected: 변경 파일 신규 error 0 (기존 debt 무관).

- [ ] **Step 11: 커밋**

```bash
git add apps/core/src/modules/inventory/shared/locks/reservation-invariant.ts \
        apps/core/src/modules/inventory/shared/locks/reservation-invariant.spec.ts \
        apps/core/src/modules/inventory/core/services/inventory-command.service.ts \
        apps/core/src/modules/inventory/stocktaking/services/stocktaking.service.ts \
        apps/core/src/modules/inventory/core/services/inventory-command.reservation-guard.spec.ts
git commit -m "refactor(core): 예약 불변식 가드를 shared/locks leaf 로 추출

store↔command 순환 회피용. 동작 무변경 — readWarehouseReservationBalance/
violatesReservationInvariant/assertReservationInvariant 를 free function 으로
이동하고 adjustDown·transferShip·stocktaking 호출부 재배선.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `reversalOnHandDecrement` 방향 판정 순수 헬퍼 (TDD)

역분개가 창고 ON_HAND 를 순감소시키는지 판정하는 순수 함수. store 파일 하단에 export(테스트 가능, 기존 `violatesReservationInvariant` 선례).

**Files:**
- Modify: `apps/core/src/modules/inventory/core/repositories/stock-event.store.ts` (클래스 뒤 export 추가)
- Create: `apps/core/src/modules/inventory/core/repositories/stock-event.store.reversal-direction.spec.ts`

**Interfaces:**
- Consumes: `StockStateEnum`(이미 store 에서 `../../schema/enum-values` import 중, L7)
- Produces: `reversalOnHandDecrement(original: { skuId: string; fromWarehouseId: string | null; toWarehouseId: string | null; fromState: StockStateEnum | null; toState: StockStateEnum | null; quantity: number }): { skuId: string; warehouseId: string; quantity: number } | null`

- [ ] **Step 1: 실패하는 유닛 테스트 작성**

Create `apps/core/src/modules/inventory/core/repositories/stock-event.store.reversal-direction.spec.ts`:

```ts
import { reversalOnHandDecrement } from './stock-event.store';
import { StockStateEnum } from '../../schema/enum-values';

const base: {
  skuId: string;
  fromWarehouseId: string | null;
  toWarehouseId: string | null;
  fromState: StockStateEnum | null;
  toState: StockStateEnum | null;
  quantity: number;
} = {
  skuId: 'sku-1',
  fromWarehouseId: null,
  toWarehouseId: null,
  fromState: null,
  toState: null,
  quantity: 10,
};

describe('reversalOnHandDecrement', () => {
  // 감소 방향: 원 이벤트가 null→ON_HAND (RECEIVE, ADJUST_UP, REWORK_GOOD). 역분개가 to-창고 ON_HAND 감소.
  it('null→ON_HAND 이벤트(RECEIVE/ADJUST_UP) 역분개는 to-창고 감소', () => {
    expect(reversalOnHandDecrement({ ...base, toWarehouseId: 'wh-1', toState: 'ON_HAND' })).toEqual({
      skuId: 'sku-1',
      warehouseId: 'wh-1',
      quantity: 10,
    });
  });
  // 증가 방향: 원 이벤트가 ON_HAND→null·비-ON_HAND (SHIP, ADJUST_DOWN, SCRAP). 역분개는 ON_HAND 증가 → 가드 면제.
  it('ON_HAND→null 이벤트(SHIP/ADJUST_DOWN/SCRAP) 역분개는 증가 방향 → null', () => {
    expect(reversalOnHandDecrement({ ...base, fromWarehouseId: 'wh-1', fromState: 'ON_HAND' })).toBeNull();
  });
  it('창고내 MOVE(W:ON_HAND→W:ON_HAND) 역분개는 순변화 0 → null', () => {
    expect(
      reversalOnHandDecrement({
        ...base,
        fromWarehouseId: 'wh-1',
        toWarehouseId: 'wh-1',
        fromState: 'ON_HAND',
        toState: 'ON_HAND',
      }),
    ).toBeNull();
  });
  it('창고간 MOVE(W1:ON_HAND→W2:ON_HAND) 역분개는 W2(=to) 감소', () => {
    expect(
      reversalOnHandDecrement({
        ...base,
        fromWarehouseId: 'wh-1',
        toWarehouseId: 'wh-2',
        fromState: 'ON_HAND',
        toState: 'ON_HAND',
      }),
    ).toEqual({ skuId: 'sku-1', warehouseId: 'wh-2', quantity: 10 });
  });
  it('toState=ON_HAND 이나 toWarehouseId 없음(malformed) → null', () => {
    expect(reversalOnHandDecrement({ ...base, toWarehouseId: null, toState: 'ON_HAND' })).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest --testPathPattern="reversal-direction.spec"`
Expected: FAIL — `reversalOnHandDecrement is not a function` (미정의).

- [ ] **Step 3: `reversalOnHandDecrement` 구현**

`stock-event.store.ts` 파일 **맨 끝**(클래스 `}` 닫힌 뒤, 현 L373 이후)에 추가:

```ts

/**
 * 역분개가 창고 ON_HAND 를 순감소시키는지 판정.
 * reverseEvent 는 원 이벤트의 to-측을 from-측(감소)으로 반전한다. 따라서 ON_HAND 순감소 창고 =
 * original.toWarehouseId (original.toState === 'ON_HAND' 일 때). 창고내 이동(from==to, 양쪽 ON_HAND)은
 * 순변화 0 → 제외. 증가/비-ON_HAND 방향(SHIP·ADJUST_DOWN·SCRAP 역분개 등)은 null → 락·가드 면제.
 */
export function reversalOnHandDecrement(original: {
  skuId: string;
  fromWarehouseId: string | null;
  toWarehouseId: string | null;
  fromState: StockStateEnum | null;
  toState: StockStateEnum | null;
  quantity: number;
}): { skuId: string; warehouseId: string; quantity: number } | null {
  if (original.toState !== 'ON_HAND' || original.toWarehouseId == null) return null;
  if (original.fromState === 'ON_HAND' && original.fromWarehouseId === original.toWarehouseId) return null;
  return { skuId: original.skuId, warehouseId: original.toWarehouseId, quantity: original.quantity };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest --testPathPattern="reversal-direction.spec"`
Expected: PASS (5 tests).

- [ ] **Step 5: 빌드 확인**

Run: `npx nest build core`
Expected: exit 0.

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/inventory/core/repositories/stock-event.store.ts \
        apps/core/src/modules/inventory/core/repositories/stock-event.store.reversal-direction.spec.ts
git commit -m "feat(core): reverseEvent 역분개 ON_HAND 감소 방향 판정 순수 헬퍼

reversalOnHandDecrement — original.toState==='ON_HAND' 이고 창고내 이동이
아닌 경우 감소 창고를 반환. 전 transitionType 을 상태 규칙 하나로 커버.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `reverseEvent` 에 락·가드 배선 + deferred 통합 spec

`StockEventStore.reverseEvent` 내부에서 `reversalOnHandDecrement` 로 감소 방향이면 advisory 락 + 예약 불변식 가드를 적용. 런타임 검증은 dev DB 통합 spec(⏸)으로 두고, 이 태스크의 green 신호는 빌드·arch·유닛(Task 2)·spec 타입체크.

**Files:**
- Modify: `apps/core/src/modules/inventory/core/repositories/stock-event.store.ts` (imports + `reverseEvent` L300-353)
- Create: `apps/core/src/modules/inventory/core/repositories/reverse-event-guard.integration.spec.ts`

**Interfaces:**
- Consumes: `acquireStockAvailabilityLock`(shared/locks) · `assertReservationInvariant`(shared/locks) · `reversalOnHandDecrement`(Task 2)
- Produces: 없음(내부 배선). `reverseEvent(eventId, reason, tx?)` 시그니처·반환 불변.

- [ ] **Step 1: deferred 통합 spec 작성 (⏸ describeIfDb)**

Create `apps/core/src/modules/inventory/core/repositories/reverse-event-guard.integration.spec.ts`:

```ts
import { ConflictException } from '@nestjs/common';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { randomUUID } from 'crypto';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { StockEventStore } from './stock-event.store';
import { InventoryCommandService } from '../services/inventory-command.service';
import { LocationService } from '../services/location.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';

/**
 * reverseEvent 락·가드(작업 10b) 통합 테스트 — rollback 전용 (adjust 통합 스펙과 동일 패턴).
 *
 * 실행 (core dev DB 는 VPC 내부 — 터널 + sst shell 필요):
 *   1) 별도 터미널: ./scripts/sst-tunnel.sh deployments/lcnine/services dev
 *   2) ./scripts/test-core-integration.sh dev reverse-event-guard.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

class Rollback extends Error {}

describeIfDb('StockEventStore.reverseEvent lock+guard (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);

  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let command: InventoryCommandService;
  let eventStore: StockEventStore;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: wmsSchema });

    const dbService = { db } as unknown as DbService<typeof wmsSchema>;
    const outbox = new OutboxService(dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, outbox);
    eventStore = new StockEventStore(dbService, sellable);
    const location = new LocationService(dbService);
    command = new InventoryCommandService(dbService, eventStore, outbox, location);
  });

  afterAll(async () => {
    await sql.end();
  });

  async function inRollbackTx(fn: (tx: DbTx) => Promise<void>) {
    await expect(
      db.transaction(async (tx) => {
        await fn(tx);
        throw new Rollback('intentional rollback');
      }),
    ).rejects.toThrow(Rollback);
  }

  async function createFixture(tx: DbTx) {
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `it-wh-${randomUUID().slice(0, 8)}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `it-holder-${randomUUID().slice(0, 8)}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'it-sku', code: `IT-${randomUUID()}`, holderId: holder.id })
      .returning();
    return { warehouse, sku };
  }

  async function reserve(tx: DbTx, skuId: string, warehouseId: string, quantity: number) {
    await tx.insert(wmsTables.stockReservations).values({
      targetType: 'FULFILLMENT_ORDER',
      targetId: randomUUID(),
      skuId,
      warehouseId,
      quantity,
      status: 'confirmed',
    });
  }

  it('ON_HAND 증가 이벤트(ADJUST_UP) 역분개는 예약이 있으면 409 로 거부된다', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, sku } = await createFixture(tx);
      const up = await command.adjustUp({ skuId: sku.id, warehouseId: warehouse.id, quantity: 10 }, tx);
      await reserve(tx, sku.id, warehouse.id, 10);
      // +10 역분개 → ON_HAND 0 < 예약 10
      await expect(eventStore.reverseEvent(up.eventId as string, 'TEST', tx)).rejects.toThrow(ConflictException);
    });
  });

  it('예약이 없으면 증가 이벤트 역분개가 성공한다', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, sku } = await createFixture(tx);
      const up = await command.adjustUp({ skuId: sku.id, warehouseId: warehouse.id, quantity: 10 }, tx);
      await expect(eventStore.reverseEvent(up.eventId as string, 'TEST', tx)).resolves.toBeDefined();
    });
  });

  it('여유가 있으면(차감 후 ON_HAND ≥ 예약) 증가 이벤트 역분개가 성공한다', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, sku } = await createFixture(tx);
      await command.adjustUp({ skuId: sku.id, warehouseId: warehouse.id, quantity: 10 }, tx);
      const up2 = await command.adjustUp({ skuId: sku.id, warehouseId: warehouse.id, quantity: 5 }, tx);
      await reserve(tx, sku.id, warehouse.id, 6);
      // +5 역분개 → ON_HAND 15-5=10 ≥ 예약 6
      await expect(eventStore.reverseEvent(up2.eventId as string, 'TEST', tx)).resolves.toBeDefined();
    });
  });

  it('ON_HAND 감소 이벤트(ADJUST_DOWN) 역분개는 증가 방향이라 예약이 꽉 차도 가드 없이 성공한다', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, sku } = await createFixture(tx);
      await command.adjustUp({ skuId: sku.id, warehouseId: warehouse.id, quantity: 10 }, tx);
      const down = await command.adjustDown({ skuId: sku.id, warehouseId: warehouse.id, quantity: 5 }, tx);
      await reserve(tx, sku.id, warehouse.id, 5); // 예약 5 == 현재 ON_HAND 5
      // ADJUST_DOWN 역분개 = +5 (증가) → 가드 미적용, 성공
      await expect(eventStore.reverseEvent(down.eventId as string, 'TEST', tx)).resolves.toBeDefined();
    });
  });
});
```

- [ ] **Step 2: store import 추가**

`stock-event.store.ts:8`(현 `ProductSellableQuantityService` import 아래)에 추가:

```ts
import { acquireStockAvailabilityLock } from '../../shared/locks/stock-availability-lock';
import { assertReservationInvariant } from '../../shared/locks/reservation-invariant';
```

- [ ] **Step 3: `reverseEvent` 에 락·가드 배선**

`reverseEvent`(현 L300)에서 `original` POSTED 검증(현 L306-308) **직후**, `reverseType` 계산(현 L311) **앞**에 삽입:

```ts
      // 역분개가 ON_HAND 를 순감소시키면(RECEIVE/ADJUST_UP 등 취소) 예약 불변식 가드.
      // 락·가드는 감소 방향만 — 증가·창고내이동(net-0)은 면제(작업 10 §5 락 면제 경로와 일관).
      const dec = reversalOnHandDecrement(original);
      if (dec) {
        await acquireStockAvailabilityLock(trx, dec.skuId, dec.warehouseId);
        await assertReservationInvariant(trx, dec.skuId, dec.warehouseId, dec.quantity);
      }
```

배선 후 `reverseEvent` 상단부는 다음 순서가 된다: `findFirst(original)` → not-found/POSTED 검증 → **dec 락·가드(신규)** → `getReversalType` → `insert` → `applyProjection` → `recalculateAndPublishForSku`.

- [ ] **Step 4: 빌드 + arch + 유닛 확인**

```bash
npx nest build core
npx jest --testPathPattern="inventory-write-boundary.arch.spec"
npx jest --testPathPattern="reversal-direction.spec"
```
Expected: build exit 0 · arch PASS(직접 INSERT 는 store 내부라 무영향) · 유닛 PASS.

- [ ] **Step 5: deferred 통합 spec 타입체크 (런타임 아님)**

jest 는 `isolatedModules` 라 skip spec 을 타입체크하지 않고, `tsconfig.app.json` 은 spec 을 build 에서 제외한다. 그래서 임시 tsconfig 를 **repo 안**(`apps/core/`)에 두어 spec 만 타입체크한다 — 스크래치패드는 repo 외부라 `@types` 해석에 실패(작업 11b 발견). Run:

```bash
cat > apps/core/tsconfig.reverse-guard-check.json <<'JSON'
{
  "extends": "./tsconfig.app.json",
  "compilerOptions": { "isolatedModules": false, "noEmit": true, "skipLibCheck": true },
  "include": ["src/modules/inventory/core/repositories/reverse-event-guard.integration.spec.ts"]
}
JSON
npx tsc -p apps/core/tsconfig.reverse-guard-check.json && echo "OK: spec typechecks"
rm apps/core/tsconfig.reverse-guard-check.json
```
Expected: `OK: spec typechecks` (타입에러 0). 임시 tsconfig 는 반드시 삭제(커밋 금지). 로컬 jest 실행 시엔 `describe.skip` 으로 **SKIP**(dev DB 없음).

- [ ] **Step 6: 변경 파일 신규 eslint 확인**

```bash
npx eslint apps/core/src/modules/inventory/core/repositories/stock-event.store.ts \
           apps/core/src/modules/inventory/core/repositories/reverse-event-guard.integration.spec.ts
```
Expected: 변경 파일 신규 error 0.

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/inventory/core/repositories/stock-event.store.ts \
        apps/core/src/modules/inventory/core/repositories/reverse-event-guard.integration.spec.ts
git commit -m "feat(core): reverseEvent 에 예약 락·가드 배선 (작업 10b)

ON_HAND 순감소 방향 역분개(입고취소·조정취소 등)에 (sku,warehouse)
advisory 락 + 창고합산 예약 불변식 가드 적용. 표면 A(입고취소)·B(이벤트취소)
전부 store 내부 배선으로 커버. 통합 spec 은 dev DB 부재로 deferred(⏸).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: dead 표면 C 절제 (`InventoryCommandService.reverseEvent`)

호출자 0 인 dead 래퍼. 내부 배선(Task 3) 후 중복이라 절제(작업 4·5·9 dead 절제 판례).

**Files:**
- Modify: `apps/core/src/modules/inventory/core/services/inventory-command.service.ts` (dead `reverseEvent` 제거)

- [ ] **Step 1: 절제 전 참조 0 확인**

Run:
```bash
grep -rn "\.reverseEvent(" apps/core/src --include=*.ts | grep -v "eventStore.reverseEvent\|store.reverseEvent"
```
Expected: 출력 없음 — `InventoryCommandService.reverseEvent` 외부 호출자 0(내부 `this.eventStore.reverseEvent` 는 store 메서드라 별개). 만약 호출자가 있으면 절제 중단하고 재검토.

- [ ] **Step 2: dead `reverseEvent` 삭제**

`inventory-command.service.ts` 의 `async reverseEvent(input: { eventId: string; reason: string }, tx?: DbTx) { ... }` 메서드(현 L562-568, Task 1 편집 후 라인 이동됨 — 심볼로 식별) **전체 블록** 삭제:

```ts
  async reverseEvent(input: { eventId: string; reason: string }, tx?: DbTx) {
    const exec = async (trx: DbTx) => {
      const rev = await this.eventStore.reverseEvent(input.eventId, input.reason, trx);
      return { eventId: rev?.id ?? null };
    };
    return this.dbService.run(exec, tx);
  }
```

- [ ] **Step 3: 빌드 + 전역 참조 0 + eslint 확인**

```bash
npx nest build core
grep -rn "commandService.reverseEvent\|InventoryCommandService.*reverseEvent" apps/core/src apps/admin-web 2>/dev/null || echo "OK: no references"
npx eslint apps/core/src/modules/inventory/core/services/inventory-command.service.ts
```
Expected: build exit 0 · `OK: no references` · eslint 신규 error 0.

- [ ] **Step 4: 커밋**

```bash
git add apps/core/src/modules/inventory/core/services/inventory-command.service.ts
git commit -m "refactor(core): dead InventoryCommandService.reverseEvent 절제

호출자 0. 작업 10b 내부 배선 후 중복 (작업 4·5·9 dead 절제 판례).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 최종 검증 (전 태스크 후 whole-branch)

```bash
npx nest build core                                                  # exit 0
npx jest --testPathPattern="inventory" --testPathIgnorePatterns=".integration.spec.ts"  # 유닛 GREEN
npx jest --testPathPattern="inventory-write-boundary.arch.spec"      # arch PASS
git diff --stat develop...HEAD                                       # 변경 파일 리뷰
```

- 삭제 심볼 전역 참조 0: `grep -rn "commandService.reverseEvent" apps/` → 없음.
- admin-web 무변경 확인: `git diff --name-only develop...HEAD | grep admin-web` → 없음.
- 스키마·마이그레이션 무변경 확인: `git diff --name-only develop...HEAD | grep -E "schema|drizzle"` → 없음.

## 완료 후 (구현 범위 밖 — 핸드오프)

- **최종 리뷰**: `superpowers:requesting-code-review`(whole-branch) → 반영.
- **develop 스쿼시 머지** 후 **현황판 갱신**(`docs/logistics-backend-hardening-2026-07.md`): §5 WS-D 착수 노트 처분 ① 에 "✅ 작업 10b 완료" 블록 추가(브랜치·머지 해시·검증 결과), 작업 10 I-2 "WS-D 잔여"→해소 표기.
- **verify(런타임)**: dev DB 복구 시 `reverse-event-guard.integration.spec` 실행 + 표면 B(`DELETE /stocks/events/:id/cancel`) admin-web 409 토스트 하드브레이크 없음 확인.
