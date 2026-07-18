# 물류 도메인 로컬 통합 테스트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dev 스테이지 폐기 이후 물류(inventory) 도메인 통합 테스트를 로컬 compose DB에서 돌릴 수 있는 러너를 만들고, 근본 연산 3개(입고·예약해제·창고내이동)에 대한 rollback-only 통합 테스트를 추가한다.

**Architecture:** 로컬 compose `core` DB를 재사용하는 셸 러너를 추가하고(`docker compose up` → drizzle migrate → jest), 기존 `transfer.service.integration.spec.ts`의 rollback-only 패턴(`describeIfDb` 게이트 + `inRollbackTx` + 픽스처 빌더 + outbox mock)을 그대로 따라 신규 spec 3개를 작성한다. 서비스를 직접 와이어링하므로 HTTP·auth·Kafka는 경유하지 않는다.

**Tech Stack:** NestJS, Drizzle ORM(`postgres.js`), Jest, Docker Compose(postgres:16), drizzle-kit.

## Global Constraints

- 모든 신규 spec은 **rollback-only**: 각 케이스를 `inRollbackTx(async (tx) => { ... })`로 감싸고 끝에서 `Rollback` throw. 커밋 금지.
- 모든 신규 spec은 `const DATABASE_URL = process.env.DATABASE_URL; const describeIfDb = DATABASE_URL ? describe : describe.skip;` 게이트를 둔다 — `DATABASE_URL` 없으면 자동 skip(일반 `npm test`·CI 무영향).
- outbox는 실제 발행하지 않는다. `InventoryCommandService`/`UnifiedReservationService`가 요구하는 outbox 의존은 `new InventoryOutboxService(dbService)`로 넣되(같은 rollback tx 안에서 outbox 행이 써졌다가 롤백됨) **Kafka는 띄우지 않는다**.
- DbService 대역은 transfer spec과 동일하게: `{ db, run: (fn, tx) => tx ? fn(tx) : db.transaction((t) => fn(t)) } as unknown as DbService<typeof wmsSchema>`.
- 픽스처 이름은 `randomUUID()` 접미사로 충돌 회피. 로케이션은 `locationType: 'zone'`(제약 `ck_locations_type` 충족).
- Jest 실행은 항상 `--runInBand`(공유 DB 직렬).
- 검증 쿼리는 `trx.select().from().where()` + drizzle 연산자 사용. 재고 투영 테이블은 `wmsTables.stockLedgers`(컬럼 `qty`, `stockState`), 이벤트 로그는 `wmsTables.stockEvents`(컬럼 `transitionType`, `quantity`), 예약은 `wmsTables.stockReservations`(컬럼 `status`). `stock_summary`는 VIEW(version 필드 없음) — 검증에 쓰지 않는다.
- import 경로 기준(파일 위치별 상대경로 주의):
  - `apps/core/src/modules/inventory/core/services/` 하위 spec에서 스키마: `../../schema/inventory.schema`
  - `apps/core/src/modules/inventory/shared/services/` 하위 spec에서 스키마: `../../schema/inventory.schema`

---

## File Structure

- Create: `scripts/local/test-core-integration-local.sh` — 로컬 통합테스트 러너(compose up → migrate → jest).
- Modify: `package.json` — `test:core:integration:local` 스크립트 추가.
- Modify: `scripts/test-core-integration.sh`, `scripts/test-core-integration.cjs` — deprecated 주석 한 줄.
- Create: `apps/core/src/modules/inventory/core/services/inventory-command.service.receive.integration.spec.ts` — 입고(RECEIVE).
- Create: `apps/core/src/modules/inventory/shared/services/unified-reservation.service.lifecycle.integration.spec.ts` — 예약→해제.
- Create: `apps/core/src/modules/inventory/core/services/inventory-command.service.move-internal.integration.spec.ts` — 창고내 이동(MOVE).
- Modify: `docs/local-dev.md` — "물류 통합 테스트" 섹션.

---

## Task 1: 로컬 통합테스트 러너

**Files:**
- Create: `scripts/local/test-core-integration-local.sh`
- Modify: `package.json` (scripts 블록)
- Modify: `scripts/test-core-integration.sh` (상단 주석)
- Modify: `scripts/test-core-integration.cjs` (상단 주석)

**Interfaces:**
- Produces: `npm run test:core:integration:local [-- <jest-pattern>]` — 로컬 compose `core` DB에 대고 `--testPathPattern=<pattern|integration>`으로 jest 실행. Task 2~4가 이 명령으로 신규 spec을 돌린다.

- [ ] **Step 1: 러너 스크립트 작성**

Create `scripts/local/test-core-integration-local.sh`:

```bash
#!/usr/bin/env bash
# 로컬 compose core DB 대상 통합 테스트 러너 (dev 스테이지 폐기 대체).
# rollback-only spec 은 DB 를 더럽히지 않는다. Kafka 불필요(outbox mock).
#
# 사용법: npm run test:core:integration:local            # 전체 integration
#         npm run test:core:integration:local -- receive.integration   # 패턴 지정
# LOCAL_PG 로 접속 URL 오버라이드 가능(포트 충돌 시).
set -euo pipefail
cd "$(dirname "$0")/../.."

PG="${LOCAL_PG:-postgresql://postgres:postgres@localhost:5432}"
CORE_URL="${PG}/core"
PATTERN="${1:-integration}"

echo "── 1/3 compose postgres 기동"
docker compose up -d postgres

echo "── 2/3 postgres 준비 대기"
for i in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  [ "$i" -eq 30 ] && { echo "postgres 준비 타임아웃" >&2; exit 1; }
  sleep 1
done

echo "── 3/3 core 마이그레이션(이미 적용됐으면 no-op)"
DATABASE_URL="$CORE_URL" npx drizzle-kit migrate --config apps/core/drizzle.config.ts

echo "── jest 실행 (pattern=${PATTERN})"
DATABASE_URL="$CORE_URL" npx jest --testPathPattern="$PATTERN" --runInBand
```

- [ ] **Step 2: 실행 권한 부여**

Run: `chmod +x scripts/local/test-core-integration-local.sh`
Expected: 무출력, exit 0.

- [ ] **Step 3: package.json 에 스크립트 추가**

`package.json`의 `scripts` 블록에서 기존 `"db:migrate:local"` 라인 근처에 추가:

```json
    "test:core:integration:local": "./scripts/local/test-core-integration-local.sh",
```

- [ ] **Step 4: 죽은 러너에 deprecated 주석**

`scripts/test-core-integration.sh` 최상단 shebang 바로 다음 줄에 추가:

```bash
# ⚠️ DEPRECATED: dev 스테이지 폐기됨. 로컬은 `npm run test:core:integration:local` 사용.
```

`scripts/test-core-integration.cjs` 최상단 주석 블록 첫 줄 다음에 추가:

```js
// ⚠️ DEPRECATED: dev 스테이지 폐기됨. 로컬은 `npm run test:core:integration:local` 사용.
```

- [ ] **Step 5: 러너 스모크 — 기존 통합 spec 이 로컬에서 green**

Run: `npm run test:core:integration:local -- transfer.service.integration`
Expected: `docker compose up -d postgres` → 마이그레이션 → jest 실행. transfer 통합 spec 2케이스 PASS. (Docker 미기동/미설치면 여기서 멈춤 — 그 경우 환경 문제로 보고.)

- [ ] **Step 6: 커밋**

```bash
git add scripts/local/test-core-integration-local.sh package.json scripts/test-core-integration.sh scripts/test-core-integration.cjs
git commit -m "test(core): 로컬 compose DB 통합테스트 러너 추가

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: 입고(RECEIVE) 무손실 통합 테스트

**Files:**
- Create: `apps/core/src/modules/inventory/core/services/inventory-command.service.receive.integration.spec.ts`

**Interfaces:**
- Consumes: `npm run test:core:integration:local` (Task 1). `InventoryCommandService.receive({ skuId, toWarehouseId, toLocationId, quantity }, tx)` (실존 시그니처, `apps/core/src/modules/inventory/core/services/inventory-command.service.ts:22`).
- Produces: 없음(리프 테스트).

- [ ] **Step 1: 실패하는 테스트 작성**

Create `apps/core/src/modules/inventory/core/services/inventory-command.service.receive.integration.spec.ts`:

```typescript
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { OutboxService as InventoryOutboxService } from '../../shared/outbox/outbox.service';
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';
import { StockEventStore } from '../repositories/stock-event.store';
import { LocationService } from './location.service';
import { InventoryCommandService } from './inventory-command.service';

/**
 * 입고(receive, RECEIVE) 무손실 통합 검증. rollback 전용 트랜잭션.
 * 실행: npm run test:core:integration:local -- inventory-command.service.receive.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('InventoryCommandService.receive 입고 무손실 (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let command: InventoryCommandService;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: wmsSchema });
    const dbService = {
      db,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> =>
        tx ? fn(tx) : db.transaction((t) => fn(t as unknown as DbTx)),
    } as unknown as DbService<typeof wmsSchema>;

    const invOutbox = new InventoryOutboxService(dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, invOutbox);
    const eventStore = new StockEventStore(dbService, sellable);
    const location = new LocationService(dbService);
    command = new InventoryCommandService(dbService, eventStore, invOutbox, location);
  });

  afterAll(async () => {
    await sql.end();
  });

  async function inRollbackTx(fn: (tx: DbTx) => Promise<void>) {
    await expect(
      db.transaction(async (tx) => {
        await fn(tx as unknown as DbTx);
        throw new Rollback('intentional rollback');
      }),
    ).rejects.toThrow(Rollback);
  }

  async function seedBase(tx: DbTx) {
    const [wh] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `it-wh-${randomUUID().slice(0, 8)}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `it-h-${randomUUID().slice(0, 8)}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'it-sku', code: `IT-${randomUUID()}`, holderId: holder.id })
      .returning();
    const [loc] = await tx
      .insert(wmsTables.locations)
      .values({ warehouseId: wh.id, code: `IT-${randomUUID().slice(0, 8)}`, locationType: 'zone' })
      .returning();
    return { wh, sku, loc };
  }

  async function onHandQty(tx: DbTx, skuId: string, warehouseId: string, locationId: string): Promise<number> {
    const [row] = await tx
      .select({ qty: wmsTables.stockLedgers.qty })
      .from(wmsTables.stockLedgers)
      .where(
        and(
          eq(wmsTables.stockLedgers.skuId, skuId),
          eq(wmsTables.stockLedgers.warehouseId, warehouseId),
          eq(wmsTables.stockLedgers.locationId, locationId),
          eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
        ),
      );
    return row?.qty ?? 0;
  }

  it('receive N 은 ON_HAND +N 과 RECEIVE 이벤트 1건을 남긴다', async () => {
    await inRollbackTx(async (tx) => {
      const { wh, sku, loc } = await seedBase(tx);

      await command.receive({ skuId: sku.id, toWarehouseId: wh.id, toLocationId: loc.id, quantity: 30 }, tx);

      // 1) 원장 투영 ON_HAND == 30
      expect(await onHandQty(tx, sku.id, wh.id, loc.id)).toBe(30);

      // 2) RECEIVE 이벤트 정확히 1건, quantity == 30
      const events = await tx
        .select({ quantity: wmsTables.stockEvents.quantity })
        .from(wmsTables.stockEvents)
        .where(
          and(
            eq(wmsTables.stockEvents.skuId, sku.id),
            eq(wmsTables.stockEvents.transitionType, 'RECEIVE'),
          ),
        );
      expect(events).toHaveLength(1);
      expect(events[0].quantity).toBe(30);
    });
  });

  it('연속 입고는 ON_HAND 를 누적한다', async () => {
    await inRollbackTx(async (tx) => {
      const { wh, sku, loc } = await seedBase(tx);
      await command.receive({ skuId: sku.id, toWarehouseId: wh.id, toLocationId: loc.id, quantity: 30 }, tx);
      await command.receive({ skuId: sku.id, toWarehouseId: wh.id, toLocationId: loc.id, quantity: 20 }, tx);
      expect(await onHandQty(tx, sku.id, wh.id, loc.id)).toBe(50);
    });
  });
});
```

- [ ] **Step 2: 실행하여 통과 확인**

Run: `npm run test:core:integration:local -- inventory-command.service.receive.integration`
Expected: 2케이스 PASS. (실패하면 receive 투영/이벤트 로직의 실제 동작이 스펙과 다른 것 — 추정으로 덮지 말고 실제 동작을 확인해 보고할 것.)

- [ ] **Step 3: 커밋**

```bash
git add apps/core/src/modules/inventory/core/services/inventory-command.service.receive.integration.spec.ts
git commit -m "test(inventory): 입고(RECEIVE) 무손실 통합 테스트 추가

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: 예약→해제 원복 통합 테스트

**Files:**
- Create: `apps/core/src/modules/inventory/shared/services/unified-reservation.service.lifecycle.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 러너. `UnifiedReservationService`(생성자 `(db, productSellableQuantity)`), `reserveStock(dto: ReserveStockDto, tx)` → `Reservation`(필드 `id`), `releaseReservation(id, tx)`, `getTotalReservedQuantity(skuId, warehouseId, tx)` → `number` (모두 `unified-reservation.service.ts` 실존). `ReserveStockDto = { targetType: 'FULFILLMENT_ORDER'; targetId; skuId; warehouseId; quantity }`.
- Produces: 없음(리프 테스트).

- [ ] **Step 1: 실패하는 테스트 작성**

Create `apps/core/src/modules/inventory/shared/services/unified-reservation.service.lifecycle.integration.spec.ts`:

```typescript
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { OutboxService as InventoryOutboxService } from '../outbox/outbox.service';
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';
import { StockEventStore } from '../../core/repositories/stock-event.store';
import { LocationService } from '../../core/services/location.service';
import { InventoryCommandService } from '../../core/services/inventory-command.service';
import { UnifiedReservationService } from './unified-reservation.service';

/**
 * 예약 생명주기(reserve→release) 원복 통합 검증. rollback 전용 트랜잭션.
 * 실행: npm run test:core:integration:local -- unified-reservation.service.lifecycle.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('UnifiedReservationService reserve→release 원복 (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let command: InventoryCommandService;
  let reservation: UnifiedReservationService;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: wmsSchema });
    const dbService = {
      db,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> =>
        tx ? fn(tx) : db.transaction((t) => fn(t as unknown as DbTx)),
    } as unknown as DbService<typeof wmsSchema>;

    const invOutbox = new InventoryOutboxService(dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, invOutbox);
    const eventStore = new StockEventStore(dbService, sellable);
    const location = new LocationService(dbService);
    command = new InventoryCommandService(dbService, eventStore, invOutbox, location);
    reservation = new UnifiedReservationService(dbService, sellable);
  });

  afterAll(async () => {
    await sql.end();
  });

  async function inRollbackTx(fn: (tx: DbTx) => Promise<void>) {
    await expect(
      db.transaction(async (tx) => {
        await fn(tx as unknown as DbTx);
        throw new Rollback('intentional rollback');
      }),
    ).rejects.toThrow(Rollback);
  }

  // ON_HAND onHand 를 세팅한 (sku, warehouse) 를 만든다.
  async function seedStock(tx: DbTx, onHand: number) {
    const [wh] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `it-wh-${randomUUID().slice(0, 8)}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `it-h-${randomUUID().slice(0, 8)}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'it-sku', code: `IT-${randomUUID()}`, holderId: holder.id })
      .returning();
    const [loc] = await tx
      .insert(wmsTables.locations)
      .values({ warehouseId: wh.id, code: `IT-${randomUUID().slice(0, 8)}`, locationType: 'zone' })
      .returning();
    await command.receive({ skuId: sku.id, toWarehouseId: wh.id, toLocationId: loc.id, quantity: onHand }, tx);
    return { wh, sku, loc };
  }

  it('reserve 는 예약수량을 늘리고 release 는 0 으로 원복한다 (ON_HAND 불변)', async () => {
    await inRollbackTx(async (tx) => {
      const { wh, sku, loc } = await seedStock(tx, 100);

      const res = await reservation.reserveStock(
        { targetType: 'FULFILLMENT_ORDER', targetId: randomUUID(), skuId: sku.id, warehouseId: wh.id, quantity: 40 },
        tx,
      );
      expect(await reservation.getTotalReservedQuantity(sku.id, wh.id, tx)).toBe(40);

      await reservation.releaseReservation(res.id, tx);
      expect(await reservation.getTotalReservedQuantity(sku.id, wh.id, tx)).toBe(0);

      // 예약 레코드 상태 released
      const [row] = await tx
        .select({ status: wmsTables.stockReservations.status })
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.id, res.id));
      expect(row.status).toBe('released');

      // ON_HAND 는 예약/해제와 무관하게 100 유지
      const [ledger] = await tx
        .select({ qty: wmsTables.stockLedgers.qty })
        .from(wmsTables.stockLedgers)
        .where(eq(wmsTables.stockLedgers.locationId, loc.id));
      expect(ledger.qty).toBe(100);
    });
  });
});
```

- [ ] **Step 2: 실행하여 통과 확인**

Run: `npm run test:core:integration:local -- unified-reservation.service.lifecycle.integration`
Expected: 1케이스 PASS. (`getTotalReservedQuantity`가 active/confirmed 만 집계하고 released 는 제외한다는 가정 — 실패 시 실제 집계 조건을 확인해 보고.)

- [ ] **Step 3: 커밋**

```bash
git add apps/core/src/modules/inventory/shared/services/unified-reservation.service.lifecycle.integration.spec.ts
git commit -m "test(inventory): 예약→해제 원복 통합 테스트 추가

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 창고내 이동(MOVE) 보존 통합 테스트

**Files:**
- Create: `apps/core/src/modules/inventory/core/services/inventory-command.service.move-internal.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 러너. `InventoryCommandService.moveInternal({ skuId, warehouseId, fromLocationId, toLocationId, quantity }, tx)` → `{ eventId }` (실존 시그니처, `inventory-command.service.ts:492`).
- Produces: 없음(리프 테스트).

- [ ] **Step 1: 실패하는 테스트 작성**

Create `apps/core/src/modules/inventory/core/services/inventory-command.service.move-internal.integration.spec.ts`:

```typescript
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { OutboxService as InventoryOutboxService } from '../../shared/outbox/outbox.service';
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';
import { StockEventStore } from '../repositories/stock-event.store';
import { LocationService } from './location.service';
import { InventoryCommandService } from './inventory-command.service';

/**
 * 창고내 로케이션 이동(moveInternal, MOVE) 보존 통합 검증. rollback 전용 트랜잭션.
 * 실행: npm run test:core:integration:local -- inventory-command.service.move-internal.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('InventoryCommandService.moveInternal 창고내 이동 보존 (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let command: InventoryCommandService;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: wmsSchema });
    const dbService = {
      db,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> =>
        tx ? fn(tx) : db.transaction((t) => fn(t as unknown as DbTx)),
    } as unknown as DbService<typeof wmsSchema>;

    const invOutbox = new InventoryOutboxService(dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, invOutbox);
    const eventStore = new StockEventStore(dbService, sellable);
    const location = new LocationService(dbService);
    command = new InventoryCommandService(dbService, eventStore, invOutbox, location);
  });

  afterAll(async () => {
    await sql.end();
  });

  async function inRollbackTx(fn: (tx: DbTx) => Promise<void>) {
    await expect(
      db.transaction(async (tx) => {
        await fn(tx as unknown as DbTx);
        throw new Rollback('intentional rollback');
      }),
    ).rejects.toThrow(Rollback);
  }

  // 같은 warehouse 안 로케이션 A/B 를 만들고 A 에 onHand 를 세팅.
  async function seedTwoLocations(tx: DbTx, onHand: number) {
    const [wh] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `it-wh-${randomUUID().slice(0, 8)}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `it-h-${randomUUID().slice(0, 8)}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'it-sku', code: `IT-${randomUUID()}`, holderId: holder.id })
      .returning();
    const [locA] = await tx
      .insert(wmsTables.locations)
      .values({ warehouseId: wh.id, code: `IT-A-${randomUUID().slice(0, 8)}`, locationType: 'zone' })
      .returning();
    const [locB] = await tx
      .insert(wmsTables.locations)
      .values({ warehouseId: wh.id, code: `IT-B-${randomUUID().slice(0, 8)}`, locationType: 'zone' })
      .returning();
    await command.receive({ skuId: sku.id, toWarehouseId: wh.id, toLocationId: locA.id, quantity: onHand }, tx);
    return { wh, sku, locA, locB };
  }

  async function onHandAtLocation(tx: DbTx, skuId: string, locationId: string): Promise<number> {
    const [row] = await tx
      .select({ qty: wmsTables.stockLedgers.qty })
      .from(wmsTables.stockLedgers)
      .where(
        and(
          eq(wmsTables.stockLedgers.skuId, skuId),
          eq(wmsTables.stockLedgers.locationId, locationId),
          eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
        ),
      );
    return row?.qty ?? 0;
  }

  it('로케이션 A→B 이동 후 로케이션별 수량이 이동하고 창고 합은 불변', async () => {
    await inRollbackTx(async (tx) => {
      const { wh, sku, locA, locB } = await seedTwoLocations(tx, 100);

      await command.moveInternal(
        { skuId: sku.id, warehouseId: wh.id, fromLocationId: locA.id, toLocationId: locB.id, quantity: 40 },
        tx,
      );

      const a = await onHandAtLocation(tx, sku.id, locA.id);
      const b = await onHandAtLocation(tx, sku.id, locB.id);
      expect(a).toBe(60);
      expect(b).toBe(40);
      expect(a + b).toBe(100); // 창고 합 불변

      // MOVE 이벤트 1건 기록
      const events = await tx
        .select({ quantity: wmsTables.stockEvents.quantity })
        .from(wmsTables.stockEvents)
        .where(and(eq(wmsTables.stockEvents.skuId, sku.id), eq(wmsTables.stockEvents.transitionType, 'MOVE')));
      expect(events).toHaveLength(1);
      expect(events[0].quantity).toBe(40);
    });
  });
});
```

- [ ] **Step 2: 실행하여 통과 확인**

Run: `npm run test:core:integration:local -- inventory-command.service.move-internal.integration`
Expected: 1케이스 PASS. (moveInternal 의 이벤트 투영이 from/to 로케이션 원장을 갱신한다는 가정 — 실패 시 moveInternal→createEvent 의 실제 투영 동작을 확인해 보고. 이건 실제 도메인 버그일 수도 있으니 추정으로 테스트를 약화시키지 말 것.)

- [ ] **Step 3: 커밋**

```bash
git add apps/core/src/modules/inventory/core/services/inventory-command.service.move-internal.integration.spec.ts
git commit -m "test(inventory): 창고내 이동(MOVE) 보존 통합 테스트 추가

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: 문서화

**Files:**
- Modify: `docs/local-dev.md` (`## 아직 로컬화 안 된 것` 섹션 바로 앞에 새 섹션 삽입)

**Interfaces:**
- Consumes: Task 1~4 결과물.
- Produces: 없음.

- [ ] **Step 1: docs/local-dev.md 에 섹션 추가**

`docs/local-dev.md`에서 `## 아직 로컬화 안 된 것` 라인 **직전**에 아래 블록을 삽입:

```markdown
## 물류 통합 테스트 (jest, 로컬 DB)

inventory/fulfillment 도메인의 통합 테스트(`*.integration.spec.ts`)는 서비스를 직접 와이어링해 실제 postgres 에 대고 도메인 불변식을 검증한다. HTTP·auth·Kafka 를 경유하지 않으므로 `.env` 도 불필요하다.

```bash
npm run test:core:integration:local                       # 전체 integration
npm run test:core:integration:local -- receive.integration  # 특정 패턴만
```

러너(`scripts/local/test-core-integration-local.sh`)가 compose postgres 기동 → core 마이그레이션 → jest(`--runInBand`)를 한 번에 한다. 대부분의 spec 은 **rollback-only**(케이스를 tx 로 감싸고 끝에 `Rollback` throw)라 DB 를 더럽히지 않고 Kafka 도 불필요(outbox 는 mock).

**새 통합 테스트 작성 레시피** — `inventory-command.service.receive.integration.spec.ts` 를 템플릿으로:

1. `const DATABASE_URL = process.env.DATABASE_URL; const describeIfDb = DATABASE_URL ? describe : describe.skip;` 게이트.
2. `beforeAll` 에서 `postgres(DATABASE_URL, { max: 1 })` → `drizzle(sql, { schema: wmsSchema })`, DbService 최소 대역 `{ db, run }`, 서비스 직접 `new`. outbox 는 `new InventoryOutboxService(dbService)`.
3. `inRollbackTx(fn)` 헬퍼로 각 케이스를 감싸고, 픽스처(warehouse/holder/sku/location `locationType: 'zone'`)는 `randomUUID()` 접미사로 tx 안에서 insert.
4. 검증은 `trx.select().from(wmsTables.stockLedgers)`(재고 투영) / `wmsTables.stockEvents`(이벤트 로그)로. `stock_summary` 는 VIEW 라 검증에 쓰지 않는다.

**커밋형 caveat**: `unified-reservation.service.lock.integration.spec.ts`(동시 락)·`store-return-exchange.refund.integration.spec.ts` 2개는 롤백 불가라 unique 접미사 행을 남긴다. pristine 이 필요하면 `docker compose down -v && docker compose up -d` 후 `npm run db:migrate:local`.

```

(코드펜스 안에 코드펜스가 있으니, 실제 삽입 시 바깥 펜스는 문서에 그대로 들어가는 마크다운 본문이다 — 위 블록 전체를 `docs/local-dev.md` 본문으로 붙여넣되 최상단/최하단의 세 backtick 은 제거하고 내용만 넣는다.)

- [ ] **Step 2: 커밋**

```bash
git add docs/local-dev.md
git commit -m "docs(test): 물류 통합 테스트 로컬 실행/작성 가이드 추가

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review 결과

- **Spec coverage:** Part 1(러너/스크립트/deprecate/문서) → Task 1·5. Part 2 A/B/C → Task 2·3·4. 전 항목 매핑됨.
- **교정 반영:** 스펙의 `stock_summary.version +1` 검증은 실제 스키마상 VIEW(version 없음)라 `stockLedgers.qty` + `stockEvents(RECEIVE)` 검증으로 대체(Global Constraints·Task 2에 명시).
- **Placeholder scan:** 모든 코드 스텝에 실제 코드 포함. "적절히 처리" 류 없음.
- **Type consistency:** `receive`/`moveInternal`/`reserveStock`/`releaseReservation`/`getTotalReservedQuantity` 시그니처, 테이블 `stockLedgers`/`stockEvents`/`stockReservations`, 컬럼 `qty`/`stockState`/`transitionType`/`quantity`/`status`, `ReserveStockDto` 형태 모두 실제 소스와 대조 확인.
- **알려진 리스크:** Task 4 moveInternal 투영, Task 3 `getTotalReservedQuantity` 집계 조건은 실제 동작 확인이 필요한 지점 — 실패 시 테스트를 약화시키지 말고 도메인 실제 동작/버그로 보고하도록 각 Step 2에 명시.
