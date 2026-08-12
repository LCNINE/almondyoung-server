# 창고간이동 custody 모델 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 창고간이동이 "운송 중" 기간을 원장에 실제로 존속시키고, 그 결과가 판매가능수량과 입고예정 정보에 정확히 반영되게 한다.

**Architecture:** `transferShip`/`transferReceive` 를 트랜잭션 분리해 `IN_TRANSFER` 잔량을 존속시키고, 그 짝을 소유하는 전용 문서(`transfer_orders` + 도착 회차)를 신설한다. 창고에 판매성 축(`is_sellable`)을 도입해 비판매 창고 재고가 storefront 판매 게이트에 들어가지 않게 하고, 부천 관점의 공급 파이프라인 3단계(발주 잔량 / 출발창고 대기 / 이동 중)를 읽기 전용으로 노출한다.

**Tech Stack:** NestJS, Drizzle ORM(postgres.js), PostgreSQL, Jest(통합 스펙은 로컬 compose DB 대상)

설계 근거·기각안·실측 결과는 스펙에 있다: `docs/superpowers/specs/2026-08-12-warehouse-transfer-custody-design.md`

## Global Constraints

- **레이어**: Controller → Service(2~3줄 포트) → Reader/Manager → Repository. Service 는 `HttpException`·drizzle-orm 을 import 하지 않는다. 도메인 예외는 `@app/shared` 의 `NotFoundError`/`BadRequestError`/`ConflictError`.
- **예외 타입의 경계 (2026-08-12 결정)**: 위 규칙은 **이번에 새로 만드는 코드**에 적용한다 — `warehouse-transfer` 모듈, `sellable-warehouses.ts`, 새 Reader/Manager/Service. **기존 파일은 그 파일의 스타일을 따른다**: `inventory-command.service.ts`·`inbound.service.ts`·`fulfillments.service.ts` 등 core 구현 계층은 파일 전체가 Nest 예외(`BadRequestException`/`ConflictException`)를 쓰므로 그대로 쓴다. 한 파일 안에 두 스타일이 섞이는 것이 더 나쁘고, 상태코드 매핑을 `GlobalExceptionFilter` 로 옮기는 것은 이번 작업 범위 밖의 회귀 위험이다. **리뷰어는 기존 파일의 Nest 예외를 위반으로 잡지 않는다.**
- **사전 존재 위반은 범위 밖**: `transfer.service.ts:135` 의 `trx.query.movementJobLines.findMany` 는 `db.query.*` 금지 규칙 위반이지만 **이번 변경이 만든 것이 아니다.** Task 10 이 같은 파일을 수정하더라도 이 호출은 건드리지 않으며, 리뷰어는 Task 10 의 결함으로 잡지 않는다.
- **트랜잭션**: `this.dbService.run(async (trx) => {...}, tx)` 단일 러너만 쓴다. per-class `inTx` 헬퍼·`asTx(tx as unknown)` 캐스팅 금지. public 메서드는 `tx?: DbTx` 를 마지막 인자로, private 헬퍼는 `tx: DbTx` 필수.
- **쿼리**: `db.query.*`·`with` 관계·`any`/`as` 캐스팅 금지. `trx.select().from().innerJoin().where()` 형태만. DB 주입은 `@InjectTypedDb<typeof wmsSchema>()`.
- **DTO**: `@ApiProperty({ type: 'object' })` 금지 — 중첩 DTO 는 별도 클래스로.
- **스키마**: 모든 테이블 정의는 `apps/core/src/modules/inventory/schema/inventory.schema.ts` 한 파일. snake_case 컬럼 / camelCase TS export. 새 테이블은 `wmsTables` 객체에 반드시 추가한다(누락 시 `wmsSchema` 에 안 들어가 `trx` 타입에서 안 보인다).
- **마이그레이션**: `npm run db:generate:core -- --name <kebab-description>`. 생성된 SQL 을 반드시 눈으로 검토한다. `schema.ts` + `drizzle/<timestamp>_*.sql` + `drizzle/meta/` 를 **한 커밋**에 넣는다.
- **통합 테스트 실행**: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- <패턴>`. 러너가 compose postgres(5432) 기동 → 마이그레이션 적용 → jest 를 순서대로 한다. 워크트리에서 `COMPOSE_PROJECT_NAME` 을 빼면 5432 포트 충돌로 죽는다.
- **전량 실행 시에는 반드시 core 로 좁힌다**: `npm run test:core:integration:local -- "apps/core.*integration"`. 러너의 기본 패턴은 `integration` 이라 `apps/medusa/integration-tests/**` 같은 **core 밖 suite 까지 끌어온다**(그쪽은 `@medusajs/test-utils` 미설치로 항상 실패한다). 좁히지 않으면 "새 실패 없음"을 판정할 수 없다.
- **DB 제약 위반을 단언할 때 `.rejects.toThrow(/제약이름/)` 은 항상 실패한다.** drizzle-orm 이 postgres 에러를 `DrizzleQueryError` 로 감싸 실제 메시지가 `.cause.message` 에 들어간다. `err.cause` 를 따라 내려가며 매칭하는 헬퍼를 쓴다 — 선례는 `outbound-v2-schema.integration.spec.ts:40-75`(5단계 순회)와 `transfer-orders-schema.integration.spec.ts:20-30`(1단계). **`catch` 로 받아 아무 에러나 통과시키는 헬퍼를 만들지 말 것** — 그러면 제약이 사라져도 초록이라 스펙이 아무것도 지키지 못한다.
- **`npm run type-check` 실측 기준선은 161** (2026-08-12 이 브랜치에서 실측). 이보다 늘면 이번 변경이 원인이다.
- **develop 부터 RED 인 core 통합 스펙 8 suite 가 있다.** 이 8개의 실패는 이번 작업의 회귀가 아니다 — 새 실패로 오인하지 말 것. (2026-08-12 실측: `Test Suites: 8 failed, 57 passed, 65 total` / `Tests: 14 failed, 4 todo, 365 passed`)

  inventory 계열 5건:
  - `unified-reservation.service.lifecycle.integration`
  - `reverse-event-guard.integration`
  - `unified-reservation.service.lock.integration`
  - `stocktaking-uniques.integration`
  - `inventory-command.service.adjust.integration`

  catalog 계열 3건 (이번 작업 범위 밖):
  - `product-masters-variant-preview.integration`
  - `bulk-session-draft.integration`
  - `bulk-session-publish.integration`
- **테스트가 산출물일 때는 RED 를 먼저 볼 수 없다.** 그런 태스크에는 "프로덕션 코드를 일부러 깨뜨려 빨강을 관측하고 되돌린다"는 단계가 명시돼 있다. 건너뛰지 말 것 — 이 절차 없이 통과한 스펙은 변별력이 증명되지 않은 스펙이다.

---

## Task 1: 판매성 축 (`warehouses.is_sellable`)

비판매 창고(중국)의 재고가 storefront 실판매 게이트에 들어가는 것을 막는다. 실측상 중국 창고 ON_HAND 가 0이라 **라이브 판매수량 변화는 없다** — 미래 방어가 목적이다.

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts:725-734` (warehouses 테이블)
- Create: `apps/core/src/modules/inventory/shared/availability/sellable-warehouses.ts`
- Create: `apps/core/src/modules/inventory/shared/availability/sellable-warehouses.integration.spec.ts`
- Modify: `apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.service.ts:134-145`
- Modify: `apps/core/src/modules/fulfillment/services/fulfillments.service.ts:331-343`
- Modify: `apps/core/src/modules/inventory/core/constants/warehouse.constants.ts:14-20`
- Create: `apps/core/drizzle/<timestamp>_add-warehouse-is-sellable.sql` (생성됨)

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces:
  - `inSellableWarehouse(warehouseIdColumn: PgColumn): SQL` — 주어진 창고 ID 컬럼이 판매 창고인지 거르는 조건
  - `assertWarehouseSellable(trx: DbTx, warehouseId: string): Promise<void>` — 비판매 창고면 `BadRequestError`

- [ ] **Step 1: 스키마에 컬럼 추가**

`inventory.schema.ts` 의 `warehouses` 테이블에 한 줄 추가한다:

```typescript
export const warehouses = pgTable('warehouses', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 128 }).notNull(),
  type: warehouseTypeEnum('type').notNull().default('domestic'),
  // 판매 대상 창고인가. 성격(type)과 정책(판매성)은 다른 축이다 — 반품 창고를 팔지는
  // 별개 결정이고 지금 우연히 겹칠 뿐이다. 판정은 sellable-warehouses.ts 한 곳에서만 한다.
  isSellable: boolean('is_sellable').notNull().default(true),
  location: varchar('location', { length: 256 }),
  supportedPickingStrategies: pickingStrategyEnum('supported_picking_strategies').array(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: 마이그레이션 생성 및 검토**

```bash
npm run db:generate:core -- --name add-warehouse-is-sellable
```

생성된 `apps/core/drizzle/<timestamp>_add-warehouse-is-sellable.sql` 을 연다. `ALTER TABLE "warehouses" ADD COLUMN "is_sellable" boolean DEFAULT true NOT NULL;` 한 줄이어야 한다. `DROP` 이 섞여 있으면 `git rm` 하고 스키마를 고친 뒤 다시 생성한다.

- [ ] **Step 3: 판정 함수 작성**

`apps/core/src/modules/inventory/shared/availability/sellable-warehouses.ts`:

```typescript
import { sql, SQL, SQLWrapper, eq } from 'drizzle-orm';
import { BadRequestError } from '@app/shared';
import { DbTx, wmsTables } from '../../schema/inventory.schema';

/**
 * 판매 대상 창고 판정의 유일한 정의.
 *
 * 창고 재고가 storefront 판매가능수량에 들어가는지, 그 창고로 출고를 지시할 수 있는지를
 * 여기서만 판단한다. 다른 곳에서 `type = 'domestic'` 같은 우회 판정을 쓰지 않는다.
 *
 * 알려진 확장 지점: 장차 채널별 판매성(중국몰↔중국 창고)이 필요해지면 이 boolean 이
 * (warehouse × sales_channel) M:N 이 된다. 그때의 진짜 제약은 컬럼 모양이 아니라
 * ADR-0011(모든 판매채널이 같은 수량을 공유한다)이며, 바뀌는 코드는 이 파일로 국한된다.
 *
 * Nest 프로바이더가 아니라 순수 leaf 다 — warehouse-availability.ts 가 택한 형태를 따른다.
 */
// SQLWrapper 로 받는다 — 호출자가 테이블 컬럼(warehouses.id)일 수도, 뷰 컬럼
// (stock_summary_view.warehouse_id)일 수도 있어 PgColumn 으로 좁히면 뷰에서 타입이 안 맞는다.
export function inSellableWarehouse(warehouseIdColumn: SQLWrapper): SQL {
  return sql`${warehouseIdColumn} IN (SELECT id FROM warehouses WHERE is_sellable = true)`;
}

/** 출고 지시 대상으로 쓸 수 있는 창고인지. 비판매 창고면 던진다. */
export async function assertWarehouseSellable(trx: DbTx, warehouseId: string): Promise<void> {
  const [row] = await trx
    .select({ isSellable: wmsTables.warehouses.isSellable })
    .from(wmsTables.warehouses)
    .where(eq(wmsTables.warehouses.id, warehouseId))
    .limit(1);

  if (!row) {
    throw new BadRequestError(`Warehouse ${warehouseId} not found`);
  }
  if (!row.isSellable) {
    throw new BadRequestError(`Warehouse ${warehouseId} is not a sellable warehouse`);
  }
}
```

- [ ] **Step 4: 통합 스펙 작성 (실패하는 상태로)**

`apps/core/src/modules/inventory/shared/availability/sellable-warehouses.integration.spec.ts`:

```typescript
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
// stockSummary 는 wmsViews 에 있고 wmsTables 에는 없다 — 직접 import 한다.
import { wmsSchema, wmsTables, stockSummary, DbTx } from '../../schema/inventory.schema';
import { seedWarehouseWithZone, seedHolder, seedSku, receiveStock } from '../../../fulfillment/services/__support__/logistics-fixtures';
import { inSellableWarehouse } from './sellable-warehouses';

/**
 * 비판매 창고 재고가 판매가능수량 집계에서 빠지는지 고정한다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- sellable-warehouses.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('판매성 창고 필터 (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
  });
  afterAll(async () => {
    await client.end();
  });

  const inRollback = async (fn: (trx: DbTx) => Promise<void>) => {
    await db
      .transaction(async (t) => {
        await fn(t as unknown as DbTx);
        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  };

  it('비판매 창고의 ON_HAND 는 stock_summary_view 합산에서 제외된다', async () => {
    await inRollback(async (trx) => {
      const sellable = await seedWarehouseWithZone(trx);
      const nonSellable = await seedWarehouseWithZone(trx);
      await trx
        .update(wmsTables.warehouses)
        .set({ isSellable: false })
        .where(sql`${wmsTables.warehouses.id} = ${nonSellable.warehouseId}`);

      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      await receiveStock(trx, skuId, sellable.warehouseId, sellable.locationId, 10);
      await receiveStock(trx, skuId, nonSellable.warehouseId, nonSellable.locationId, 7);

      const rows = (await trx.execute(sql`
        SELECT COALESCE(SUM(GREATEST(available_qty, 0)), 0)::int AS qty
          FROM stock_summary_view
         WHERE sku_id = ${skuId}
           AND ${inSellableWarehouse(stockSummary.warehouseId)}
      `)) as unknown as { qty: number | string }[];

      // 판매 창고 10 만 잡히고 비판매 창고 7 은 빠진다
      expect(Number(rows[0]?.qty ?? 0)).toBe(10);
    });
  });
});
```

- [ ] **Step 5: 스펙 실행 — 실패 확인**

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- sellable-warehouses.integration
```

기대: 실패. 마이그레이션이 아직 적용 전이면 `column "is_sellable" does not exist`, 적용 후라면 필터가 없던 시절의 값(17)이 나온다. **실패 메시지를 실제로 읽고** 위 둘 중 어느 것인지 확인한다.

- [ ] **Step 6: 스펙 통과 확인**

Step 2 의 마이그레이션이 러너에 의해 적용되므로 재실행하면 통과한다.

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- sellable-warehouses.integration
```

기대: PASS.

- [ ] **Step 7: 변별력 증명 — 일부러 깨뜨려 RED 관측**

`sellable-warehouses.ts` 의 `inSellableWarehouse` 를 임시로 `sql\`true\`` 로 바꾸고 스펙을 재실행한다. **17 을 받아 실패해야 한다.** 실패하지 않으면 이 스펙은 아무것도 지키지 못하는 것이므로 픽스처를 고친다. 확인 후 원복한다.

- [ ] **Step 8: 판매가능수량 집계에 필터 배선**

`product-sellable-quantity.service.ts` 의 `stockRows` 쿼리(`:134-145`)에 조건을 추가한다. `inArray` 옆에 `and` 로 묶는다:

```typescript
import { and, inArray, sql } from 'drizzle-orm';
import { inSellableWarehouse } from '../../shared/availability/sellable-warehouses';

// ...
const stockRows =
  skuIds.length > 0
    ? await trx
        .select({
          skuId: stockSummary.skuId,
          // 창고별로 먼저 0 으로 자른 뒤 합산한다. 합산 후 자르면(GREATEST(SUM(..)))
          // 한 창고의 음수 available 이 다른 창고의 실재고를 상쇄해 팔 수 있는 재고가 0 이 된다.
          availableQuantity: sql<number>`COALESCE(SUM(GREATEST(${stockSummary.availableQty}, 0)), 0)::int`,
        })
        .from(stockSummary)
        // 비판매 창고(해외 등) 재고는 실판매 게이트에 들어가면 안 된다 — 판정은
        // sellable-warehouses.ts 가 소유한다.
        .where(and(inArray(stockSummary.skuId, skuIds), inSellableWarehouse(stockSummary.warehouseId)))
        .groupBy(stockSummary.skuId)
    : [];
```

- [ ] **Step 9: 출고 창고 지정 가드 배선**

`fulfillments.service.ts` 의 `validateWarehouseExists`(`:331`)를 존재 확인 + 판매성 확인으로 바꾼다. 기존 호출부는 그대로 둔다.

```typescript
import { assertWarehouseSellable } from '../../inventory/shared/availability/sellable-warehouses';

private async validateWarehouseExists(warehouseId: string, tx: DbTx): Promise<void> {
  if (!warehouseId) {
    throw new BadRequestException('warehouseId is required');
  }
  // 비판매 창고(해외 등)로는 출고를 지시할 수 없다. 예약은 호출자가 창고를 지정하는
  // 구조라, 이 지점을 막으면 비판매 창고에 예약이 걸릴 경로가 없다.
  await assertWarehouseSellable(tx, warehouseId);
}
```

`assertWarehouseSellable` 이 없는 창고에도 던지므로 기존 존재 검증을 겸한다. 기존 `select`/`throw new BadRequestException(\`Warehouse ${warehouseId} not found\`)` 블록은 삭제한다.

- [ ] **Step 10: 해외 창고 시드에서 피킹 전략 제거**

`warehouse.constants.ts:14-20` 의 `DEFAULT_OVERSEAS_WAREHOUSE` 에서 `supportedPickingStrategies` 를 빈 배열로 바꾼다:

```typescript
DEFAULT_OVERSEAS_WAREHOUSE: {
  id: '00000000-0000-0000-0000-000000000002',
  name: '해외 메인 창고',
  location: '중국',
  type: 'overseas' as const,
  // 비판매 창고다. 이 값이 비면 배치 생성 게이트가 막아 출고에 쓸 수 없는 창고가 된다.
  supportedPickingStrategies: [] as const,
},
```

- [ ] **Step 11: 타입 체크와 전체 통합 스펙**

```bash
npm run type-check
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- "apps/core.*integration"
```

기대: type-check 오류 **161 이하**. 통합 스펙은 Global Constraints 에 적힌 사전 RED 5 suite 외에 새 실패가 없어야 한다.

- [ ] **Step 12: 커밋**

```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts \
        apps/core/drizzle \
        apps/core/src/modules/inventory/shared/availability/sellable-warehouses.ts \
        apps/core/src/modules/inventory/shared/availability/sellable-warehouses.integration.spec.ts \
        apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.service.ts \
        apps/core/src/modules/fulfillment/services/fulfillments.service.ts \
        apps/core/src/modules/inventory/core/constants/warehouse.constants.ts
git commit -m "feat(inventory): 창고 판매성 축 도입 — 비판매 창고 재고를 판매 게이트에서 제외"
```

---

## Task 2: 운송중 시스템 로케이션과 `transferShip` 재배치

`IN_TRANSFER` 잔량이 출발 선반에 매달려 있으면 떠난 선반이 안 비어 보인다. 창고별 `transit_out` 시스템 로케이션으로 옮긴다.

**Files:**
- Modify: `apps/core/src/modules/inventory/core/constants/warehouse.constants.ts:25-44`
- Modify: `apps/core/src/modules/inventory/core/services/inventory-command.service.ts:310-345` (`transferShip`)
- Create: `apps/core/src/modules/inventory/core/services/transfer-ship-location.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 의 변경 없음
- Produces: `transferShip` 이 `toLocationId` 로 출발 창고의 `transit_out` 시스템 로케이션을 쓴다. 이후 태스크의 `transferReceive` 는 이 로케이션에서 잔량을 찾는다.

- [ ] **Step 1: 시스템 로케이션 롤 추가**

`warehouse.constants.ts` 의 두 상수에 항목을 추가한다:

```typescript
export const SYSTEM_LOCATION_ROLES = {
  INBOUND_DEFAULT: 'inbound_default',
  RETURN_DEFAULT: 'return_default',
  OUTBOUND_REWORK: 'outbound_rework',
  TRANSIT_OUT: 'transit_out',
} as const;

export const SYSTEM_LOCATION_DEFAULTS: Record<string, { code: string; displayName: string }> = {
  [SYSTEM_LOCATION_ROLES.INBOUND_DEFAULT]: { code: 'zone-inbound-default', displayName: '입고 기본존' },
  [SYSTEM_LOCATION_ROLES.RETURN_DEFAULT]: { code: 'zone-return-default', displayName: '반품 기본존' },
  [SYSTEM_LOCATION_ROLES.OUTBOUND_REWORK]: { code: 'zone-outbound-rework', displayName: '출고 재작업존' },
  // 창고간 이동으로 창고를 떠난 재고가 도착 확인 전까지 머무는 존.
  // stock_ledgers.location_id 가 NOT NULL 이라 IN_TRANSFER 잔량도 어딘가 매달려야 하는데,
  // 출발 선반에 두면 떠난 선반이 안 비어 보여 적치·재고조사가 틀어진다.
  [SYSTEM_LOCATION_ROLES.TRANSIT_OUT]: { code: 'zone-transit-out', displayName: '운송중존' },
};
```

`ensureSystemLocations`(`location.service.ts:29`)는 `SYSTEM_LOCATION_DEFAULTS` 의 키를 순회하므로 코드 변경 없이 새 롤을 만든다.

- [ ] **Step 2: 실패하는 통합 스펙 작성**

`apps/core/src/modules/inventory/core/services/transfer-ship-location.integration.spec.ts`:

```typescript
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql, and, eq } from 'drizzle-orm';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { seedWarehouseWithZone, seedHolder, seedSku, receiveStock } from '../../../fulfillment/services/__support__/logistics-fixtures';

/**
 * transferShip 이 만든 IN_TRANSFER 잔량이 출발 선반이 아니라 운송중존에 놓이는지 고정한다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- transfer-ship-location.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('transferShip 의 IN_TRANSFER 배치 (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
  });
  afterAll(async () => {
    await client.end();
  });

  const inRollback = async (fn: (trx: DbTx) => Promise<void>) => {
    await db
      .transaction(async (t) => {
        await fn(t as unknown as DbTx);
        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  };

  it('출발 선반은 비고 운송중존에 IN_TRANSFER 가 쌓인다', async () => {
    await inRollback(async (trx) => {
      const from = await seedWarehouseWithZone(trx);
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      await receiveStock(trx, skuId, from.warehouseId, from.locationId, 10);

      // transit_out 시스템 로케이션 보장 (프로덕션 경로는 InventoryCommandService 가 부른다)
      await trx.insert(wmsTables.locations).values({
        warehouseId: from.warehouseId,
        code: 'zone-transit-out',
        displayName: '운송중존',
        locationType: 'zone',
        isSystem: true,
        systemRole: 'transit_out',
        isActive: true,
      });
      const [transit] = await trx
        .select({ id: wmsTables.locations.id })
        .from(wmsTables.locations)
        .where(
          and(
            eq(wmsTables.locations.warehouseId, from.warehouseId),
            eq(wmsTables.locations.systemRole, 'transit_out'),
          ),
        )
        .limit(1);

      const readQty = async (locationId: string, state: 'ON_HAND' | 'IN_TRANSFER') => {
        const rows = (await trx.execute(sql`
          SELECT COALESCE(qty, 0)::int AS qty FROM stock_ledgers
           WHERE sku_id = ${skuId} AND warehouse_id = ${from.warehouseId}
             AND location_id = ${locationId} AND stock_state = ${state}
        `)) as unknown as { qty: number | string }[];
        return Number(rows[0]?.qty ?? 0);
      };

      // 여기서 transferShip 을 호출한다. 서비스 인스턴스 구성은 Step 4 참고.
      await shipViaCommandService(trx, { skuId, warehouseId: from.warehouseId, locationId: from.locationId, qty: 4 });

      expect(await readQty(from.locationId, 'ON_HAND')).toBe(6);
      expect(await readQty(from.locationId, 'IN_TRANSFER')).toBe(0);
      expect(await readQty(transit.id, 'IN_TRANSFER')).toBe(4);
    });
  });
});
```

- [ ] **Step 3: 스펙 하니스 보강 — `shipViaCommandService`**

Step 2 의 스펙은 `shipViaCommandService` 가 없어 컴파일되지 않는다. 같은 파일 상단에 헬퍼를 추가한다. `InventoryCommandService` 를 Nest DI 없이 직접 구성하되, **`DbService` 대역에는 반드시 `run` 이 있어야 한다** — 사전 RED 스펙 중 하나(`inventory-command.service.adjust.integration`)가 `run` 없는 대역 때문에 깨져 있으니 같은 실수를 반복하지 않는다:

```typescript
import { InventoryCommandService } from './inventory-command.service';
import { StockEventStore } from '../repositories/stock-event.store';
import { BatchControlledStockGuard } from './batch-controlled-stock.guard';
import { LocationService } from './location.service';

/** trx 를 그대로 돌려주는 DbService 대역. run 이 반드시 있어야 한다. */
function dbServiceStub(trx: DbTx) {
  return {
    db: trx,
    run: async <T>(fn: (t: DbTx) => Promise<T>) => fn(trx),
  };
}
```

생성자 인자 목록은 `inventory-command.service.ts` 의 `constructor` 를 열어 그대로 맞춘다(`StockEventStore`, `LocationService` 등 각각 같은 `dbServiceStub(trx)` 로 구성한다).

**검증 대상이 `toLocationId` 결정 로직이므로 `InventoryCommandService.transferShip` 을 반드시 거쳐야 한다** — `StockEventStore.createEvent` 를 직접 부르거나 SQL 로 이벤트를 넣으면 이 스펙은 아무것도 지키지 못한다.

`shipViaCommandService(trx, { skuId, warehouseId, locationId, qty })` 는 구성한 서비스의 `transferShip({ skuId, fromWarehouseId: warehouseId, fromLocationId: locationId, quantity: qty }, trx)` 를 호출한다.

- [ ] **Step 4: 스펙 실행 — 실패 확인**

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- transfer-ship-location.integration
```

기대: 실패. 현재 `transferShip` 은 `toLocationId: input.fromLocationId` 라 출발 선반에 IN_TRANSFER 4가 쌓이고 운송중존은 0이다.

- [ ] **Step 5: `transferShip` 구현 변경**

`inventory-command.service.ts` 의 `transferShip`(`:310`)에서 목적지 로케이션을 운송중존으로 바꾼다. `LocationService` 는 이미 주입돼 있다(`:267`, `:420` 에서 사용):

```typescript
const exec = async (trx: DbTx) => {
  await acquireStockAvailabilityLock(trx, input.skuId, input.fromWarehouseId);
  await assertReservationInvariant(trx, input.skuId, input.fromWarehouseId, input.quantity);

  // 떠난 재고는 출발 선반이 아니라 운송중존에 둔다. stock_ledgers.location_id 가
  // NOT NULL 이라 어딘가에는 매달려야 하고, 출발 선반에 두면 적치·재고조사가 틀어진다.
  await this.locationService.ensureSystemLocations(input.fromWarehouseId, trx);
  const transitZone = await this.locationService.getSystemLocationByRole(input.fromWarehouseId, 'transit_out', trx);
  if (!transitZone) throw new BadRequestException('운송중존이 존재하지 않습니다.');

  const event = await this.eventStore.createEvent(
    {
      skuId: input.skuId,
      fromWarehouseId: input.fromWarehouseId,
      fromLocationId: input.fromLocationId,
      fromState: 'ON_HAND',
      toWarehouseId: input.fromWarehouseId,
      toLocationId: transitZone.id,
      toState: 'IN_TRANSFER',
      transitionType: 'MOVE',
      quantity: input.quantity,
      occurredAt: input.occurredAt ?? new Date(),
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
    },
    trx,
  );
  return { eventId: event?.id ?? null };
};
```

`getSystemLocationByRole` 의 정확한 시그니처는 `location.service.ts:73` 에서 확인한다.

- [ ] **Step 6: 스펙 통과 확인**

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- transfer-ship-location.integration
```

기대: PASS.

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/inventory/core/constants/warehouse.constants.ts \
        apps/core/src/modules/inventory/core/services/inventory-command.service.ts \
        apps/core/src/modules/inventory/core/services/transfer-ship-location.integration.spec.ts
git commit -m "feat(inventory): 운송중존 시스템 로케이션 추가, transferShip 이 출발 선반을 비우게"
```

---

## Task 3: `transfer_orders` 스키마

이동의 출발·도착 짝을 소유하는 문서. 도착은 회차다.

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` (enum + 3 테이블 + `wmsTables` 등록)
- Create: `apps/core/src/modules/inventory/schema/transfer-orders-schema.integration.spec.ts`
- Create: `apps/core/drizzle/<timestamp>_add-transfer-orders.sql` (생성됨)

**Interfaces:**
- Consumes: Task 2 의 `transit_out` 롤
- Produces: `wmsTables.transferOrders`, `wmsTables.transferOrderLines`, `wmsTables.transferOrderReceipts`, `wmsTables.transferOrderReceiptLines`, `transferOrderStatusEnum`

- [ ] **Step 1: enum 과 테이블 정의 추가**

`inventory.schema.ts` 의 enum 선언 구역(`:56` 부근)에 추가:

```typescript
export const transferOrderStatusEnum = pgEnum('transfer_order_status', [
  'draft', // 선적 전
  'shipped', // 전량 출발
  'partially_received', // 일부 도착
  'closed', // shipped = received + lost (미도착 잔량 0)
]);
```

테이블 정의는 `movementJobs`(`:385`) 인근에 둔다:

```typescript
export const transferOrders = pgTable(
  'transfer_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fromWarehouseId: uuid('from_warehouse_id')
      .references(() => warehouses.id, { onDelete: 'restrict' })
      .notNull(),
    toWarehouseId: uuid('to_warehouse_id')
      .references(() => warehouses.id, { onDelete: 'restrict' })
      .notNull(),
    status: transferOrderStatusEnum('status').notNull().default('draft'),
    // 도착 예정일은 문서 단위다 — 같은 배에 실리므로 라인별로 나눌 이유가 없다.
    eta: timestamp('eta', { mode: 'date' }),
    etaUpdatedAt: timestamp('eta_updated_at', { withTimezone: true }),
    journalId: uuid('journal_id').references(() => stockJournals.id, { onDelete: 'set null' }),
    actorId: uuid('actor_id'),
    memo: varchar('memo', { length: 255 }),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxTransferOrdersStatus: index('idx_transfer_orders_status').on(t.status, t.createdAt),
    idxTransferOrdersRoute: index('idx_transfer_orders_route').on(t.fromWarehouseId, t.toWarehouseId),
    // 창고 간 이동 전용 문서다. 창고 내 이동은 movement_jobs 가 소유한다.
    ckTransferOrdersCrossWarehouse: check(
      'ck_transfer_orders_cross_warehouse',
      sql`${t.fromWarehouseId} <> ${t.toWarehouseId}`,
    ),
  }),
);

export const transferOrderLines = pgTable(
  'transfer_order_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transferOrderId: uuid('transfer_order_id')
      .references(() => transferOrders.id, { onDelete: 'cascade' })
      .notNull(),
    skuId: uuid('sku_id')
      .references(() => skus.id, { onDelete: 'restrict' })
      .notNull(),
    fromLocationId: uuid('from_location_id')
      .references(() => locations.id, { onDelete: 'restrict' })
      .notNull(),
    plannedQty: integer('planned_qty').notNull(),
    shippedQty: integer('shipped_qty').notNull().default(0),
    receivedQty: integer('received_qty').notNull().default(0),
    lostQty: integer('lost_qty').notNull().default(0),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqTransferOrderLineSku: unique('uq_transfer_order_lines_sku').on(t.transferOrderId, t.skuId, t.fromLocationId),
    idxTransferOrderLinesOrder: index('idx_transfer_order_lines_order').on(t.transferOrderId),
    ckTransferOrderLineQty: check(
      'ck_transfer_order_lines_qty',
      sql`${t.plannedQty} > 0 AND ${t.shippedQty} >= 0 AND ${t.receivedQty} >= 0 AND ${t.lostQty} >= 0`,
    ),
    // 선적량을 넘겨 수령/분실할 수 없다. batch_inventory_sessions 의
    // settled + returned + shortage <= handed_in 과 같은 형태 — 애플리케이션
    // 검증만으로는 샌다는 것을 이미 배웠다.
    ckTransferOrderLineSettlement: check(
      'ck_transfer_order_lines_settlement',
      sql`${t.receivedQty} + ${t.lostQty} <= ${t.shippedQty}`,
    ),
    ckTransferOrderLineShipped: check('ck_transfer_order_lines_shipped', sql`${t.shippedQty} <= ${t.plannedQty}`),
  }),
);

export const transferOrderReceipts = pgTable(
  'transfer_order_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transferOrderId: uuid('transfer_order_id')
      .references(() => transferOrders.id, { onDelete: 'restrict' })
      .notNull(),
    journalId: uuid('journal_id').references(() => stockJournals.id, { onDelete: 'set null' }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    actorId: uuid('actor_id'),
    memo: varchar('memo', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxTransferOrderReceiptsOrder: index('idx_transfer_order_receipts_order').on(t.transferOrderId, t.receivedAt),
  }),
);

export const transferOrderReceiptLines = pgTable(
  'transfer_order_receipt_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    receiptId: uuid('receipt_id')
      .references(() => transferOrderReceipts.id, { onDelete: 'cascade' })
      .notNull(),
    transferOrderLineId: uuid('transfer_order_line_id')
      .references(() => transferOrderLines.id, { onDelete: 'restrict' })
      .notNull(),
    toLocationId: uuid('to_location_id')
      .references(() => locations.id, { onDelete: 'restrict' })
      .notNull(),
    receivedQty: integer('received_qty').notNull().default(0),
    lostQty: integer('lost_qty').notNull().default(0),
    receiveEventId: uuid('receive_event_id').references(() => stockEvents.id, { onDelete: 'set null' }),
    lostEventId: uuid('lost_event_id').references(() => stockEvents.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxTransferOrderReceiptLinesReceipt: index('idx_transfer_order_receipt_lines_receipt').on(t.receiptId),
    ckTransferOrderReceiptLineQty: check(
      'ck_transfer_order_receipt_lines_qty',
      sql`${t.receivedQty} >= 0 AND ${t.lostQty} >= 0 AND (${t.receivedQty} + ${t.lostQty}) > 0`,
    ),
  }),
);
```

- [ ] **Step 2: `wmsTables` 에 등록**

`inventory.schema.ts:2886` 의 `wmsTables` 객체에 네 테이블을 추가한다. **누락하면 `wmsSchema` 에 안 들어가 `trx` 타입에서 보이지 않는다.**

```typescript
export const wmsTables = {
  // ... 기존 항목 ...
  transferOrders,
  transferOrderLines,
  transferOrderReceipts,
  transferOrderReceiptLines,
};
```

- [ ] **Step 3: 마이그레이션 생성 및 검토**

```bash
npm run db:generate:core -- --name add-transfer-orders
```

생성 SQL 에 `CREATE TYPE "public"."transfer_order_status"`, `CREATE TABLE` 4개, 그리고 위 check 제약이 모두 있는지 확인한다. `DROP` 이 섞이면 `git rm` 후 스키마를 고쳐 재생성한다.

- [ ] **Step 4: 제약이 실제로 막는지 검증하는 스펙 작성**

`apps/core/src/modules/inventory/schema/transfer-orders-schema.integration.spec.ts`. 선례는 `outbound-v2-schema.integration.spec.ts` 다. 하니스(`postgres`/`drizzle`/`inRollback`)는 Task 1 Step 4 와 같은 형태로 만든다.

```typescript
it('선적량을 넘겨 수령할 수 없다', async () => {
  await inRollback(async (trx) => {
    const { orderId, lineId } = await seedTransferOrderLine(trx, { plannedQty: 10, shippedQty: 10 });
    await expect(
      trx.execute(sql`UPDATE transfer_order_lines SET received_qty = 11 WHERE id = ${lineId}`),
    ).rejects.toThrow(/ck_transfer_order_lines_settlement/);
  });
});

it('수령 + 분실이 선적량을 넘을 수 없다', async () => {
  await inRollback(async (trx) => {
    const { lineId } = await seedTransferOrderLine(trx, { plannedQty: 10, shippedQty: 10 });
    await trx.execute(sql`UPDATE transfer_order_lines SET received_qty = 8 WHERE id = ${lineId}`);
    await expect(
      trx.execute(sql`UPDATE transfer_order_lines SET lost_qty = 3 WHERE id = ${lineId}`),
    ).rejects.toThrow(/ck_transfer_order_lines_settlement/);
  });
});

it('같은 창고끼리는 이동 지시서를 만들 수 없다', async () => {
  await inRollback(async (trx) => {
    const wh = await seedWarehouseWithZone(trx);
    await expect(
      trx.insert(wmsTables.transferOrders).values({
        fromWarehouseId: wh.warehouseId,
        toWarehouseId: wh.warehouseId,
      }),
    ).rejects.toThrow(/ck_transfer_orders_cross_warehouse/);
  });
});
```

`seedTransferOrderLine` 은 같은 파일에 둔다 — 창고 2개(`seedWarehouseWithZone` 2회), holder/sku, 지시서 1행, 라인 1행을 넣고 `{ orderId, lineId }` 를 돌려준다.

- [ ] **Step 5: 스펙 실행 — 통과 확인**

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- transfer-orders-schema.integration
```

기대: PASS(3건).

- [ ] **Step 6: 변별력 증명 — 제약을 지우고 RED 관측**

제약이 실제로 막는지 증명한다. 로컬 DB 에서 직접 떨어뜨린 뒤 스펙을 재실행한다:

```bash
docker compose exec -T postgres psql -U postgres -d core -c \
  'ALTER TABLE transfer_order_lines DROP CONSTRAINT ck_transfer_order_lines_settlement;'
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- transfer-orders-schema.integration
```

기대: 위 2건이 실패. 확인 후 복구한다:

```bash
docker compose exec -T postgres psql -U postgres -d core -c \
  'ALTER TABLE transfer_order_lines ADD CONSTRAINT ck_transfer_order_lines_settlement CHECK (received_qty + lost_qty <= shipped_qty);'
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- transfer-orders-schema.integration
```

기대: 다시 PASS.

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts \
        apps/core/drizzle \
        apps/core/src/modules/inventory/schema/transfer-orders-schema.integration.spec.ts
git commit -m "feat(inventory): transfer_orders 스키마 — 이동 지시서와 도착 회차"
```

---

## Task 4: `transferReceive` 에 락·잔량 검증·부분 수령

분리된 트랜잭션에서 도착을 처리한다. 지금은 락도 검증도 없다.

**Files:**
- Modify: `apps/core/src/modules/inventory/core/services/inventory-command.service.ts:348-383` (`transferReceive`)
- Create: `apps/core/src/modules/inventory/core/services/transfer-receive.integration.spec.ts`

**Interfaces:**
- Consumes: Task 2 의 운송중존 배치
- Produces: `transferReceive(input: { skuId, fromWarehouseId, fromLocationId, toWarehouseId, toLocationId, quantity, occurredAt?, idempotencyKey?, reason? }, tx?)` — `fromLocationId` 는 출발 창고의 운송중존이며, 미도착 잔량보다 많이 수령하면 `ConflictError`
- 이 스펙 파일 안에 만들 픽스처 (정확한 시그니처):
  - `seedShippedTransfer(trx: DbTx, opts: { qty: number }): Promise<ShippedTransferCtx>` — 창고 2개·holder·sku·ON_HAND 10 수령·운송중존 보장·`transferShip(opts.qty)` 까지 수행
  - `type ShippedTransferCtx = { skuId: string; fromWarehouseId: string; fromLocationId: string; toWarehouseId: string; toLocationId: string }` — `fromLocationId` 는 **운송중존** ID 다(출발 선반이 아니다)
  - `receiveViaCommandService(trx: DbTx, input: ShippedTransferCtx & { quantity: number; idempotencyKey?: string }): Promise<{ eventId: string | null }>`
  - `readTransitQty(trx: DbTx, ctx: ShippedTransferCtx): Promise<number>` / `readDestOnHand(trx: DbTx, ctx: ShippedTransferCtx): Promise<number>` — `stock_ledgers` 직접 조회
  - `dbServiceStub` 은 Task 2 Step 3 의 것을 그대로 쓴다(`__support__` 로 옮겨 공유해도 좋다)

- [ ] **Step 1: 실패하는 스펙 작성**

`transfer-receive.integration.spec.ts`. 하니스는 Task 2 스펙과 동일한 형태를 쓴다.

```typescript
it('미도착 잔량을 넘겨 수령하면 409 로 막힌다', async () => {
  await inRollback(async (trx) => {
    const ctx = await seedShippedTransfer(trx, { qty: 5 }); // ON_HAND 10 중 5 를 ship 한 상태
    await expect(
      receiveViaCommandService(trx, { ...ctx, quantity: 6 }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

it('부분 수령을 두 번 나눠 받을 수 있고 잔량이 정확히 준다', async () => {
  await inRollback(async (trx) => {
    const ctx = await seedShippedTransfer(trx, { qty: 5 });

    await receiveViaCommandService(trx, { ...ctx, quantity: 3, idempotencyKey: 'r1' });
    expect(await readTransitQty(trx, ctx)).toBe(2);
    expect(await readDestOnHand(trx, ctx)).toBe(3);

    await receiveViaCommandService(trx, { ...ctx, quantity: 2, idempotencyKey: 'r2' });
    expect(await readTransitQty(trx, ctx)).toBe(0);
    expect(await readDestOnHand(trx, ctx)).toBe(5);
  });
});
```

`seedShippedTransfer` 는 출발/도착 창고, holder/sku, ON_HAND 10 수령, 운송중존 보장, `transferShip(5)` 까지 수행하고 식별자를 돌려준다. `readTransitQty`/`readDestOnHand` 는 `stock_ledgers` 를 직접 읽는다.

- [ ] **Step 2: 스펙 실행 — 실패 확인**

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- transfer-receive.integration
```

기대: 첫 번째 케이스가 실패(현재는 검증이 없어 6을 그냥 받아 원장이 음수로 가거나 check 제약에서 다른 에러가 난다). **실제 에러 메시지를 읽고** 무엇이 막았는지 확인한다.

- [ ] **Step 3: `transferReceive` 구현 변경**

```typescript
async transferReceive(
  input: {
    skuId: string;
    fromWarehouseId: string;
    fromLocationId: string;
    toWarehouseId: string;
    toLocationId: string;
    quantity: number;
    occurredAt?: Date;
    idempotencyKey?: string;
    reason?: string;
  },
  tx?: DbTx,
) {
  if (input.quantity <= 0) throw new BadRequestException('quantity must be positive');
  const exec = async (trx: DbTx) => {
    // ship 과 다른 트랜잭션이므로 자체 락이 필요하다. 도착 창고를 함께 잠가
    // 같은 SKU 의 도착 처리끼리 직렬화한다. 정렬 순서는 교차 데드락 방지용이다.
    await acquireStockAvailabilityLocks(trx, [
      { skuId: input.skuId, warehouseId: input.fromWarehouseId },
      { skuId: input.skuId, warehouseId: input.toWarehouseId },
    ]);

    const [transit] = await trx
      .select({ qty: wmsTables.stockLedgers.qty })
      .from(wmsTables.stockLedgers)
      .where(
        and(
          eq(wmsTables.stockLedgers.skuId, input.skuId),
          eq(wmsTables.stockLedgers.warehouseId, input.fromWarehouseId),
          eq(wmsTables.stockLedgers.locationId, input.fromLocationId),
          eq(wmsTables.stockLedgers.stockState, 'IN_TRANSFER'),
        ),
      )
      .for('update')
      .limit(1);

    const inTransit = transit?.qty ?? 0;
    if (input.quantity > inTransit) {
      throw new ConflictException({
        code: 'TRANSFER_RECEIVE_EXCEEDS_IN_TRANSIT',
        message: 'Receiving more than the outstanding in-transit quantity',
        skuId: input.skuId,
        requestedQty: input.quantity,
        inTransitQty: inTransit,
      });
    }

    const event = await this.eventStore.createEvent(
      {
        skuId: input.skuId,
        fromWarehouseId: input.fromWarehouseId,
        fromLocationId: input.fromLocationId,
        fromState: 'IN_TRANSFER',
        toWarehouseId: input.toWarehouseId,
        toLocationId: input.toLocationId,
        toState: 'ON_HAND',
        transitionType: 'MOVE',
        quantity: input.quantity,
        occurredAt: input.occurredAt ?? new Date(),
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
      },
      trx,
    );
    return { eventId: event?.id ?? null };
  };
  return this.dbService.run(exec, tx);
}
```

`acquireStockAvailabilityLocks`(복수형)는 정렬·중복제거 후 순차 획득한다(`shared/locks/stock-availability-lock.ts:45`). `ConflictException` import 를 추가한다.

- [ ] **Step 4: 스펙 통과 확인**

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- transfer-receive.integration
```

기대: PASS(2건).

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/inventory/core/services/inventory-command.service.ts \
        apps/core/src/modules/inventory/core/services/transfer-receive.integration.spec.ts
git commit -m "feat(inventory): transferReceive 에 락·미도착 잔량 검증·부분 수령 추가"
```

---

## Task 5: 이동 지시서 도메인 (Service / Manager / Reader)

지시서 생성 → 선적 → 도착 회차 → 마감. 원장 이벤트와 문서 수량을 한 트랜잭션에서 함께 움직인다.

**Files:**
- Create: `apps/core/src/modules/inventory/warehouse-transfer/warehouse-transfer.module.ts`
- Create: `apps/core/src/modules/inventory/warehouse-transfer/services/warehouse-transfer.service.ts`
- Create: `apps/core/src/modules/inventory/warehouse-transfer/services/warehouse-transfer.manager.ts`
- Create: `apps/core/src/modules/inventory/warehouse-transfer/services/warehouse-transfer.reader.ts`
- Create: `apps/core/src/modules/inventory/warehouse-transfer/services/warehouse-transfer.integration.spec.ts`
- Modify: `apps/core/src/app.module.ts` (모듈 등록 — 실제 파일명은 `grep -rn "StockProjectionModule" apps/core/src --include=*.module.ts` 로 확인)

**Interfaces:**
- Consumes: Task 3 의 `wmsTables.transferOrder*`, Task 4 의 `transferReceive`, Task 2 의 `transferShip`
- Produces:
  - `WarehouseTransferService.createOrder(input: CreateTransferOrderInput, tx?: DbTx): Promise<{ transferOrderId: string }>`
  - `WarehouseTransferService.ship(input: { transferOrderId: string; idempotencyKey: string; actorId?: string }, tx?: DbTx): Promise<{ shippedLines: number }>`
  - `WarehouseTransferService.receive(input: ReceiveTransferInput, tx?: DbTx): Promise<{ receiptId: string }>`
  - `WarehouseTransferService.updateEta(input: { transferOrderId: string; eta: Date }, tx?: DbTx): Promise<void>`
  - `WarehouseTransferReader.findOutstanding(tx: DbTx): Promise<OutstandingTransfer[]>` — `shipped_qty − received_qty − lost_qty > 0` 인 라인
  - 타입: `CreateTransferOrderInput = { fromWarehouseId: string; toWarehouseId: string; eta?: Date; memo?: string; actorId?: string; lines: Array<{ skuId: string; fromLocationId: string; quantity: number }> }`
  - 타입: `ReceiveTransferInput = { transferOrderId: string; idempotencyKey: string; toLocationId: string; actorId?: string; lines: Array<{ transferOrderLineId: string; receivedQty: number; lostQty: number }> }`
  - 타입: `OutstandingTransfer = { transferOrderId: string; transferOrderLineId: string; skuId: string; toWarehouseId: string; outstandingQty: number; eta: Date | null; shippedAt: Date | null }`
- 이 스펙 파일 안에 만들 픽스처 (정확한 시그니처):
  - `seedTwoWarehousesWithStock(trx: DbTx, qty: number): Promise<{ from: { warehouseId: string; locationId: string }; to: { warehouseId: string; locationId: string }; skuId: string }>`
  - `buildService(trx: DbTx): WarehouseTransferService` / `buildReader(trx: DbTx): WarehouseTransferReader` — Task 2 Step 3 의 `dbServiceStub(trx)` 로 의존성을 구성한다
  - `readOrderStatus(trx, transferOrderId): Promise<string>` / `readFirstLineId(trx, transferOrderId): Promise<string>`
  - `readOnHand(trx, skuId, warehouseId): Promise<number>` / `readInTransit(trx, skuId, warehouseId): Promise<number>` — 창고 grain 합계

- [ ] **Step 1: 실패하는 스펙 작성 — 정상 흐름**

`warehouse-transfer.integration.spec.ts`:

```typescript
it('생성 → 선적 → 부분 도착 → 전량 도착으로 상태와 원장이 함께 움직인다', async () => {
  await inRollback(async (trx) => {
    const { from, to, skuId } = await seedTwoWarehousesWithStock(trx, 10);
    const svc = buildService(trx);

    const { transferOrderId } = await svc.createOrder(
      {
        fromWarehouseId: from.warehouseId,
        toWarehouseId: to.warehouseId,
        eta: new Date('2026-09-01'),
        lines: [{ skuId, fromLocationId: from.locationId, quantity: 6 }],
      },
      trx,
    );
    expect(await readOrderStatus(trx, transferOrderId)).toBe('draft');

    await svc.ship({ transferOrderId, idempotencyKey: 'ship-1' }, trx);
    expect(await readOrderStatus(trx, transferOrderId)).toBe('shipped');
    expect(await readOnHand(trx, skuId, from.warehouseId)).toBe(4);
    expect(await readInTransit(trx, skuId, from.warehouseId)).toBe(6);

    const lineId = await readFirstLineId(trx, transferOrderId);
    await svc.receive(
      { transferOrderId, idempotencyKey: 'rcv-1', toLocationId: to.locationId, lines: [{ transferOrderLineId: lineId, receivedQty: 4, lostQty: 0 }] },
      trx,
    );
    expect(await readOrderStatus(trx, transferOrderId)).toBe('partially_received');
    expect(await readOnHand(trx, skuId, to.warehouseId)).toBe(4);
    expect(await readInTransit(trx, skuId, from.warehouseId)).toBe(2);

    await svc.receive(
      { transferOrderId, idempotencyKey: 'rcv-2', toLocationId: to.locationId, lines: [{ transferOrderLineId: lineId, receivedQty: 1, lostQty: 1 }] },
      trx,
    );
    expect(await readOrderStatus(trx, transferOrderId)).toBe('closed');
    expect(await readOnHand(trx, skuId, to.warehouseId)).toBe(5);
    expect(await readInTransit(trx, skuId, from.warehouseId)).toBe(0);
  });
});

it('미완결 조회가 선적 후 남은 잔량을 정확히 낸다', async () => {
  await inRollback(async (trx) => {
    const { from, to, skuId } = await seedTwoWarehousesWithStock(trx, 10);
    const svc = buildService(trx);
    const { transferOrderId } = await svc.createOrder(
      { fromWarehouseId: from.warehouseId, toWarehouseId: to.warehouseId, lines: [{ skuId, fromLocationId: from.locationId, quantity: 6 }] },
      trx,
    );
    await svc.ship({ transferOrderId, idempotencyKey: 'ship-1' }, trx);

    const outstanding = await buildReader(trx).findOutstanding(trx);
    const mine = outstanding.filter((o) => o.transferOrderId === transferOrderId);
    expect(mine).toHaveLength(1);
    expect(mine[0].outstandingQty).toBe(6);
  });
});
```

`buildService`/`buildReader` 는 Nest DI 없이 클래스를 직접 구성한다. **`DbService` 대역에는 반드시 `run` 을 넣는다**(Task 2 Step 3 참고).

- [ ] **Step 2: 스펙 실행 — 실패 확인**

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- warehouse-transfer.integration
```

기대: `Cannot find module '../services/warehouse-transfer.service'` 류의 컴파일 실패.

- [ ] **Step 3: Manager 구현**

`warehouse-transfer.manager.ts` — 검증·비즈니스 로직·DB 쓰기가 전부 여기 산다.

```typescript
import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { InjectTypedDb, DbService } from '@app/db';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { InventoryCommandService } from '../../core/services/inventory-command.service';
import { LocationService } from '../../core/services/location.service';
import { InventoryIdempotencyService } from '../../core/services/inventory-idempotency.service';

export interface CreateTransferOrderInput {
  fromWarehouseId: string;
  toWarehouseId: string;
  eta?: Date;
  memo?: string;
  actorId?: string;
  lines: Array<{ skuId: string; fromLocationId: string; quantity: number }>;
}

export interface ReceiveTransferInput {
  transferOrderId: string;
  idempotencyKey: string;
  toLocationId: string;
  actorId?: string;
  lines: Array<{ transferOrderLineId: string; receivedQty: number; lostQty: number }>;
}

@Injectable()
export class WarehouseTransferManager {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly commandService: InventoryCommandService,
    private readonly locationService: LocationService,
    private readonly idempotency: InventoryIdempotencyService,
  ) {}

  async createOrder(input: CreateTransferOrderInput, tx?: DbTx): Promise<{ transferOrderId: string }> {
    return this.dbService.run(async (trx) => {
      if (input.lines.length === 0) throw new BadRequestError('At least one line is required');
      if (input.fromWarehouseId === input.toWarehouseId) {
        throw new BadRequestError('창고 간 이동만 지시서로 만든다 — 창고 내 이동은 movement job 을 쓴다');
      }
      for (const line of input.lines) {
        if (line.quantity <= 0) throw new BadRequestError('quantity must be positive');
      }

      const [order] = await trx
        .insert(wmsTables.transferOrders)
        .values({
          fromWarehouseId: input.fromWarehouseId,
          toWarehouseId: input.toWarehouseId,
          eta: input.eta ?? null,
          etaUpdatedAt: input.eta ? new Date() : null,
          memo: input.memo ?? null,
          actorId: input.actorId ?? null,
        })
        .returning({ id: wmsTables.transferOrders.id });
      if (!order) throw new Error('transfer_orders insert returned no row');

      await trx.insert(wmsTables.transferOrderLines).values(
        input.lines.map((line) => ({
          transferOrderId: order.id,
          skuId: line.skuId,
          fromLocationId: line.fromLocationId,
          plannedQty: line.quantity,
        })),
      );

      return { transferOrderId: order.id };
    }, tx);
  }

  async ship(input: { transferOrderId: string; idempotencyKey: string; actorId?: string }, tx?: DbTx) {
    return this.idempotency.withIdempotency('transfer.ship', input.idempotencyKey, input, async (trx) => {
      const order = await this.lockOrder(trx, input.transferOrderId);
      if (order.status !== 'draft') {
        throw new ConflictError(`Transfer order ${order.id} is already ${order.status}`);
      }

      const lines = await trx
        .select()
        .from(wmsTables.transferOrderLines)
        .where(eq(wmsTables.transferOrderLines.transferOrderId, order.id));

      const [journal] = await trx
        .insert(wmsTables.stockJournals)
        .values({ sourceType: 'warehouse_transfer', sourceId: order.id, actorId: input.actorId ?? null })
        .returning({ id: wmsTables.stockJournals.id });

      for (const line of lines) {
        await this.commandService.transferShip(
          {
            skuId: line.skuId,
            fromWarehouseId: order.fromWarehouseId,
            fromLocationId: line.fromLocationId,
            quantity: line.plannedQty,
            idempotencyKey: `transfer.ship:${order.id}:${line.id}`,
            reason: `Transfer to warehouse ${order.toWarehouseId}`,
          },
          trx,
        );
        await trx
          .update(wmsTables.transferOrderLines)
          .set({ shippedQty: line.plannedQty, updatedAt: new Date() })
          .where(eq(wmsTables.transferOrderLines.id, line.id));
      }

      await trx
        .update(wmsTables.transferOrders)
        .set({ status: 'shipped', shippedAt: new Date(), journalId: journal?.id ?? null, updatedAt: new Date() })
        .where(eq(wmsTables.transferOrders.id, order.id));

      return { shippedLines: lines.length };
    }, tx);
  }

  async receive(input: ReceiveTransferInput, tx?: DbTx): Promise<{ receiptId: string }> {
    return this.idempotency.withIdempotency('transfer.receive', input.idempotencyKey, input, async (trx) => {
      const order = await this.lockOrder(trx, input.transferOrderId);
      if (order.status !== 'shipped' && order.status !== 'partially_received') {
        throw new ConflictError(`Transfer order ${order.id} is ${order.status}; cannot receive`);
      }

      await this.locationService.ensureSystemLocations(order.fromWarehouseId, trx);
      const transitZone = await this.locationService.getSystemLocationByRole(order.fromWarehouseId, 'transit_out', trx);
      if (!transitZone) throw new Error('운송중존이 존재하지 않습니다.');

      const [journal] = await trx
        .insert(wmsTables.stockJournals)
        .values({ sourceType: 'warehouse_transfer_receive', sourceId: order.id, actorId: input.actorId ?? null })
        .returning({ id: wmsTables.stockJournals.id });

      const [receipt] = await trx
        .insert(wmsTables.transferOrderReceipts)
        .values({ transferOrderId: order.id, journalId: journal?.id ?? null, actorId: input.actorId ?? null })
        .returning({ id: wmsTables.transferOrderReceipts.id });
      if (!receipt) throw new Error('transfer_order_receipts insert returned no row');

      for (const item of input.lines) {
        if (item.receivedQty < 0 || item.lostQty < 0) throw new BadRequestError('quantities must not be negative');
        if (item.receivedQty + item.lostQty <= 0) throw new BadRequestError('receipt line must move some quantity');

        const line = await this.lockLine(trx, item.transferOrderLineId, order.id);
        const outstanding = line.shippedQty - line.receivedQty - line.lostQty;
        if (item.receivedQty + item.lostQty > outstanding) {
          throw new ConflictError(
            `Receipt exceeds outstanding quantity (outstanding=${outstanding}) for line ${line.id}`,
          );
        }

        let receiveEventId: string | null = null;
        if (item.receivedQty > 0) {
          const result = await this.commandService.transferReceive(
            {
              skuId: line.skuId,
              fromWarehouseId: order.fromWarehouseId,
              fromLocationId: transitZone.id,
              toWarehouseId: order.toWarehouseId,
              toLocationId: input.toLocationId,
              quantity: item.receivedQty,
              idempotencyKey: `transfer.receive:${receipt.id}:${line.id}`,
              reason: `Transfer from warehouse ${order.fromWarehouseId}`,
            },
            trx,
          );
          receiveEventId = result.eventId;
        }

        let lostEventId: string | null = null;
        if (item.lostQty > 0) {
          // 운송 중 분실은 IN_TRANSFER 를 소진시키는 SCRAP 이다. 새 transition_type 을
          // 만들지 않는 이유는 이벤트 계약에 노출될 경우 소비자 선배포가 필요하기 때문이다.
          const result = await this.commandService.scrapInTransit(
            {
              skuId: line.skuId,
              warehouseId: order.fromWarehouseId,
              locationId: transitZone.id,
              quantity: item.lostQty,
              idempotencyKey: `transfer.lost:${receipt.id}:${line.id}`,
              reason: 'Lost in transit',
            },
            trx,
          );
          lostEventId = result.eventId;
        }

        await trx.insert(wmsTables.transferOrderReceiptLines).values({
          receiptId: receipt.id,
          transferOrderLineId: line.id,
          toLocationId: input.toLocationId,
          receivedQty: item.receivedQty,
          lostQty: item.lostQty,
          receiveEventId,
          lostEventId,
        });

        await trx
          .update(wmsTables.transferOrderLines)
          .set({
            receivedQty: line.receivedQty + item.receivedQty,
            lostQty: line.lostQty + item.lostQty,
            version: line.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(wmsTables.transferOrderLines.id, line.id));
      }

      await this.refreshOrderStatus(trx, order.id);
      return { receiptId: receipt.id };
    }, tx);
  }

  async updateEta(input: { transferOrderId: string; eta: Date }, tx?: DbTx): Promise<void> {
    await this.dbService.run(async (trx) => {
      const order = await this.lockOrder(trx, input.transferOrderId);
      await trx
        .update(wmsTables.transferOrders)
        .set({ eta: input.eta, etaUpdatedAt: new Date(), updatedAt: new Date() })
        .where(eq(wmsTables.transferOrders.id, order.id));
    }, tx);
  }

  private async lockOrder(trx: DbTx, transferOrderId: string) {
    const [order] = await trx
      .select()
      .from(wmsTables.transferOrders)
      .where(eq(wmsTables.transferOrders.id, transferOrderId))
      .for('update')
      .limit(1);
    if (!order) throw new NotFoundError(`Transfer order not found: ${transferOrderId}`);
    return order;
  }

  private async lockLine(trx: DbTx, lineId: string, transferOrderId: string) {
    const [line] = await trx
      .select()
      .from(wmsTables.transferOrderLines)
      .where(
        and(
          eq(wmsTables.transferOrderLines.id, lineId),
          eq(wmsTables.transferOrderLines.transferOrderId, transferOrderId),
        ),
      )
      .for('update')
      .limit(1);
    if (!line) throw new NotFoundError(`Transfer order line not found: ${lineId}`);
    return line;
  }

  /** 미도착 잔량이 0 이면 closed, 일부라도 받았으면 partially_received. */
  private async refreshOrderStatus(trx: DbTx, transferOrderId: string): Promise<void> {
    const rows = (await trx.execute(sql`
      SELECT COALESCE(SUM(shipped_qty - received_qty - lost_qty), 0)::int AS outstanding,
             COALESCE(SUM(received_qty + lost_qty), 0)::int AS settled
        FROM transfer_order_lines WHERE transfer_order_id = ${transferOrderId}
    `)) as unknown as { outstanding: number | string; settled: number | string }[];

    const outstanding = Number(rows[0]?.outstanding ?? 0);
    const settled = Number(rows[0]?.settled ?? 0);
    const status = outstanding === 0 ? 'closed' : settled > 0 ? 'partially_received' : 'shipped';

    await trx
      .update(wmsTables.transferOrders)
      .set({ status, closedAt: status === 'closed' ? new Date() : null, updatedAt: new Date() })
      .where(eq(wmsTables.transferOrders.id, transferOrderId));
  }
}
```

- [ ] **Step 4: `scrapInTransit` 명령 추가**

Step 3 의 Manager 는 이 메서드를 부르므로 **Step 3 만으로는 컴파일되지 않는다.** 여기까지 해야 빌드가 통과한다.

Step 3 이 부르는 `commandService.scrapInTransit` 이 아직 없다. `inventory-command.service.ts` 에 추가한다:

```typescript
/** 운송 중 분실 — IN_TRANSFER 잔량을 소진시킨다. 어느 창고에도 더하지 않는다. */
async scrapInTransit(
  input: {
    skuId: string;
    warehouseId: string;
    locationId: string;
    quantity: number;
    occurredAt?: Date;
    idempotencyKey?: string;
    reason?: string;
  },
  tx?: DbTx,
) {
  if (input.quantity <= 0) throw new BadRequestException('quantity must be positive');
  const exec = async (trx: DbTx) => {
    await acquireStockAvailabilityLock(trx, input.skuId, input.warehouseId);
    const event = await this.eventStore.createEvent(
      {
        skuId: input.skuId,
        fromWarehouseId: input.warehouseId,
        fromLocationId: input.locationId,
        fromState: 'IN_TRANSFER',
        toWarehouseId: null,
        toLocationId: null,
        toState: null,
        transitionType: 'SCRAP',
        quantity: input.quantity,
        occurredAt: input.occurredAt ?? new Date(),
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
      },
      trx,
    );
    return { eventId: event?.id ?? null };
  };
  return this.dbService.run(exec, tx);
}
```

- [ ] **Step 5: Service(포트)와 Reader 구현**

`warehouse-transfer.service.ts` — 2~3줄 위임만 한다:

```typescript
import { Injectable } from '@nestjs/common';
import { DbTx } from '../../schema/inventory.schema';
import { WarehouseTransferManager, CreateTransferOrderInput, ReceiveTransferInput } from './warehouse-transfer.manager';

@Injectable()
export class WarehouseTransferService {
  constructor(private readonly manager: WarehouseTransferManager) {}

  createOrder(input: CreateTransferOrderInput, tx?: DbTx) {
    return this.manager.createOrder(input, tx);
  }
  ship(input: { transferOrderId: string; idempotencyKey: string; actorId?: string }, tx?: DbTx) {
    return this.manager.ship(input, tx);
  }
  receive(input: ReceiveTransferInput, tx?: DbTx) {
    return this.manager.receive(input, tx);
  }
  updateEta(input: { transferOrderId: string; eta: Date }, tx?: DbTx) {
    return this.manager.updateEta(input, tx);
  }
}
```

`warehouse-transfer.reader.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsSchema, DbTx } from '../../schema/inventory.schema';

export interface OutstandingTransfer {
  transferOrderId: string;
  transferOrderLineId: string;
  skuId: string;
  toWarehouseId: string;
  outstandingQty: number;
  eta: Date | null;
  shippedAt: Date | null;
}

@Injectable()
export class WarehouseTransferReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  /** 떠났으나 아직 도착·분실 정산되지 않은 잔량. 체류 감시와 파이프라인 ③의 원천이다. */
  async findOutstanding(tx: DbTx): Promise<OutstandingTransfer[]> {
    const rows = (await tx.execute(sql`
      SELECT tol.transfer_order_id, tol.id AS line_id, tol.sku_id,
             tord.to_warehouse_id, tord.eta, tord.shipped_at,
             (tol.shipped_qty - tol.received_qty - tol.lost_qty) AS outstanding
        FROM transfer_order_lines tol
        JOIN transfer_orders tord ON tord.id = tol.transfer_order_id
       WHERE (tol.shipped_qty - tol.received_qty - tol.lost_qty) > 0
    `)) as unknown as Array<{
      transfer_order_id: string;
      line_id: string;
      sku_id: string;
      to_warehouse_id: string;
      eta: Date | null;
      shipped_at: Date | null;
      outstanding: number | string;
    }>;

    return rows.map((row) => ({
      transferOrderId: row.transfer_order_id,
      transferOrderLineId: row.line_id,
      skuId: row.sku_id,
      toWarehouseId: row.to_warehouse_id,
      outstandingQty: Number(row.outstanding),
      eta: row.eta,
      shippedAt: row.shipped_at,
    }));
  }
}
```

- [ ] **Step 6: 모듈 작성 및 등록**

`warehouse-transfer.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { CoreInventoryModule } from '../core/inventory.module';
import { WarehouseTransferService } from './services/warehouse-transfer.service';
import { WarehouseTransferManager } from './services/warehouse-transfer.manager';
import { WarehouseTransferReader } from './services/warehouse-transfer.reader';

@Module({
  imports: [SharedModule, CoreInventoryModule],
  providers: [WarehouseTransferService, WarehouseTransferManager, WarehouseTransferReader],
  exports: [WarehouseTransferService, WarehouseTransferReader],
})
export class WarehouseTransferModule {}
```

등록 위치는 `StockProjectionModule` 이 등록된 곳과 같다:

```bash
grep -rn "StockProjectionModule" apps/core/src --include=*.module.ts
```

찾은 파일의 `imports` 배열에 `WarehouseTransferModule` 을 추가한다.

- [ ] **Step 7: 스펙 통과 확인**

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- warehouse-transfer.integration
```

기대: PASS(2건). 실패하면 원인을 읽고 고친다 — 특히 `refreshOrderStatus` 의 상태 계산과 `scrapInTransit` 의 원장 투영(`toState: null` 이 감소만 하는지)을 확인한다.

- [ ] **Step 8: 부팅 확인과 타입 체크**

```bash
npx nest build core
npm run type-check
```

기대: 빌드 성공, type-check 오류 161 이하.

- [ ] **Step 9: 커밋**

```bash
git add apps/core/src/modules/inventory/warehouse-transfer \
        apps/core/src/modules/inventory/core/services/inventory-command.service.ts \
        apps/core/src/app.module.ts
git commit -m "feat(inventory): 이동 지시서 도메인 — 생성/선적/도착 회차/분실 정산"
```

---

## Task 6: 이동 지시서 API

**Files:**
- Create: `apps/core/src/modules/inventory/warehouse-transfer/dto/create-transfer-order.dto.ts`
- Create: `apps/core/src/modules/inventory/warehouse-transfer/dto/receive-transfer.dto.ts`
- Create: `apps/core/src/modules/inventory/warehouse-transfer/dto/transfer-order-response.dto.ts`
- Create: `apps/core/src/modules/inventory/warehouse-transfer/controllers/warehouse-transfer.controller.ts`
- Modify: `apps/core/src/modules/inventory/warehouse-transfer/warehouse-transfer.module.ts` (controllers 등록)

**Interfaces:**
- Consumes: Task 5 의 `WarehouseTransferService`, `WarehouseTransferReader`
- Produces: `POST /inventory/warehouse-transfers`, `POST /inventory/warehouse-transfers/:id/ship`, `POST /inventory/warehouse-transfers/:id/receipts`, `PATCH /inventory/warehouse-transfers/:id/eta`, `GET /inventory/warehouse-transfers/outstanding`

- [ ] **Step 1: 요청 DTO 작성**

`create-transfer-order.dto.ts`. 중첩 DTO 는 반드시 별도 클래스로 만든다(`@ApiProperty({ type: 'object' })` 금지):

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsInt, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';

export class CreateTransferOrderLineDto {
  @ApiProperty({ description: 'SKU ID' })
  @IsUUID()
  skuId: string;

  @ApiProperty({ description: '출발 로케이션 ID' })
  @IsUUID()
  fromLocationId: string;

  @ApiProperty({ description: '이동 수량', minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;
}

export class CreateTransferOrderDto {
  @ApiProperty({ description: '출발 창고 ID' })
  @IsUUID()
  fromWarehouseId: string;

  @ApiProperty({ description: '도착 창고 ID' })
  @IsUUID()
  toWarehouseId: string;

  @ApiPropertyOptional({ description: '도착 예정일 (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  eta?: string;

  @ApiPropertyOptional({ description: '메모' })
  @IsOptional()
  @IsString()
  memo?: string;

  @ApiPropertyOptional({ description: '작업자 ID' })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiProperty({ description: '이동 라인', type: [CreateTransferOrderLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateTransferOrderLineDto)
  lines: CreateTransferOrderLineDto[];
}
```

`receive-transfer.dto.ts` 도 같은 형태로 만든다 — `ReceiveTransferLineDto { transferOrderLineId: string; receivedQty: number; lostQty: number }` 와 `ReceiveTransferDto { idempotencyKey: string; toLocationId: string; actorId?: string; lines: ReceiveTransferLineDto[] }`. 수량은 `@IsInt() @Min(0)`.

- [ ] **Step 2: 응답 DTO 작성**

`transfer-order-response.dto.ts`:

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTransferOrderResponseDto {
  @ApiProperty({ description: '생성된 이동 지시서 ID' })
  transferOrderId: string;
}

export class ShipTransferOrderResponseDto {
  @ApiProperty({ description: '선적된 라인 수' })
  shippedLines: number;
}

export class ReceiveTransferResponseDto {
  @ApiProperty({ description: '생성된 도착 회차 ID' })
  receiptId: string;
}

export class OutstandingTransferDto {
  @ApiProperty() transferOrderId: string;
  @ApiProperty() transferOrderLineId: string;
  @ApiProperty() skuId: string;
  @ApiProperty() toWarehouseId: string;
  @ApiProperty({ description: '미도착 잔량' }) outstandingQty: number;
  @ApiPropertyOptional({ description: '도착 예정일', nullable: true }) eta: Date | null;
  @ApiPropertyOptional({ description: '선적 시각', nullable: true }) shippedAt: Date | null;
}

export class OutstandingTransferListDto {
  @ApiProperty({ type: [OutstandingTransferDto] })
  items: OutstandingTransferDto[];
}
```

- [ ] **Step 3: 컨트롤러 작성**

`warehouse-transfer.controller.ts`. **try/catch 로 에러를 상태코드에 매핑하지 않는다** — `GlobalExceptionFilter` 가 한다:

```typescript
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { WarehouseTransferService } from '../services/warehouse-transfer.service';
import { WarehouseTransferReader } from '../services/warehouse-transfer.reader';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsSchema } from '../../schema/inventory.schema';
import { CreateTransferOrderDto } from '../dto/create-transfer-order.dto';
import { ReceiveTransferDto } from '../dto/receive-transfer.dto';
import {
  CreateTransferOrderResponseDto,
  ShipTransferOrderResponseDto,
  ReceiveTransferResponseDto,
  OutstandingTransferListDto,
} from '../dto/transfer-order-response.dto';

class ShipTransferOrderDto {
  idempotencyKey: string;
  actorId?: string;
}
class UpdateEtaDto {
  eta: string;
}

@ApiTags('Inventory - Warehouse Transfers')
@Controller('inventory/warehouse-transfers')
export class WarehouseTransferController {
  constructor(
    private readonly service: WarehouseTransferService,
    private readonly reader: WarehouseTransferReader,
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  @Post()
  @ApiOperation({ summary: '이동 지시서 생성' })
  @ApiResponse({ status: 201, type: CreateTransferOrderResponseDto })
  create(@Body() dto: CreateTransferOrderDto): Promise<CreateTransferOrderResponseDto> {
    return this.service.createOrder({
      fromWarehouseId: dto.fromWarehouseId,
      toWarehouseId: dto.toWarehouseId,
      eta: dto.eta ? new Date(dto.eta) : undefined,
      memo: dto.memo,
      actorId: dto.actorId,
      lines: dto.lines,
    });
  }

  @Post(':id/ship')
  @ApiOperation({ summary: '선적 — 출발 창고 재고를 운송중으로' })
  @ApiResponse({ status: 201, type: ShipTransferOrderResponseDto })
  ship(@Param('id') id: string, @Body() dto: ShipTransferOrderDto): Promise<ShipTransferOrderResponseDto> {
    return this.service.ship({ transferOrderId: id, idempotencyKey: dto.idempotencyKey, actorId: dto.actorId });
  }

  @Post(':id/receipts')
  @ApiOperation({ summary: '도착 회차 등록 — 부분 도착과 분실을 함께 정산' })
  @ApiResponse({ status: 201, type: ReceiveTransferResponseDto })
  receive(@Param('id') id: string, @Body() dto: ReceiveTransferDto): Promise<ReceiveTransferResponseDto> {
    return this.service.receive({
      transferOrderId: id,
      idempotencyKey: dto.idempotencyKey,
      toLocationId: dto.toLocationId,
      actorId: dto.actorId,
      lines: dto.lines,
    });
  }

  @Patch(':id/eta')
  @ApiOperation({ summary: '도착 예정일 갱신 (선적 지연 등)' })
  async updateEta(@Param('id') id: string, @Body() dto: UpdateEtaDto): Promise<void> {
    await this.service.updateEta({ transferOrderId: id, eta: new Date(dto.eta) });
  }

  @Get('outstanding')
  @ApiOperation({ summary: '미도착 잔량 목록' })
  @ApiResponse({ status: 200, type: OutstandingTransferListDto })
  async outstanding(): Promise<OutstandingTransferListDto> {
    const items = await this.dbService.run((trx) => this.reader.findOutstanding(trx));
    return { items };
  }
}
```

`ShipTransferOrderDto`/`UpdateEtaDto` 는 별도 파일로 옮기고 `class-validator` 데코레이터(`@IsString()`, `@IsUUID()`, `@IsDateString()`)를 붙인다 — 위 인라인 선언은 검증이 없으므로 그대로 두지 않는다.

- [ ] **Step 4: 모듈에 컨트롤러 등록**

`warehouse-transfer.module.ts` 에 `controllers: [WarehouseTransferController]` 를 추가한다. **누락하면 라우트가 조용히 없는 상태가 된다.**

- [ ] **Step 5: 빌드와 라우트 확인**

```bash
npx nest build core
```

기대: 성공. 라우트가 실제로 붙었는지 확인하려면 core 를 띄우고 Swagger(`/api-docs` 등 프로젝트 설정 경로)에서 `Inventory - Warehouse Transfers` 태그를 찾는다.

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/inventory/warehouse-transfer
git commit -m "feat(inventory): 이동 지시서 API — 생성/선적/도착회차/ETA/미도착조회"
```

---

## Task 7: 발주 재배선과 `inbound_pending` 집계 키 교정 (expand)

발주가 destination plan 을 만드는 것을 중단하고, 뷰의 이중 계상을 없앤다. **기존 135행은 이 태스크에서 건드리지 않는다**(Task 11 contract).

**Files:**
- Modify: `apps/core/src/modules/inventory/inbound/services/purchase-order.service.ts:287-370`
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` (`stockSummary` 뷰 정의 중 `inbound_pending` 서브쿼리)
- Create: `apps/core/drizzle/<timestamp>_fix-inbound-pending-warehouse-key.sql` (생성됨)
- Create: `apps/core/src/modules/inventory/inbound/services/purchase-order-single-plan.integration.spec.ts`
- Create: `apps/core/src/modules/inventory/warehouse-transfer/services/transfer-draft.service.ts` (Step 11)
- Modify: `apps/core/src/modules/inventory/warehouse-transfer/warehouse-transfer.module.ts` (`TransferDraftService` 를 providers·exports 에 추가)
- Modify: `apps/core/src/modules/inventory/inbound/services/inbound.service.ts:790-796` (초안 자동 생성 훅)
- Modify: `apps/core/src/modules/inventory/inbound/inbound.module.ts` (`WarehouseTransferModule` import)

**Interfaces:**
- Consumes: Task 3 의 `transfer_order_lines`/`transfer_orders`(뷰의 `transit_out` 재정의), Task 5 의 모듈(Step 9~11 의 초안 자동 생성)
- Produces: 발주 확정 시 `inbound_plans` 가 source plan 1건만 생긴다. `stock_summary_view.inbound_pending_qty` 는 "그 창고에 실제로 입고될 예정 수량"을 뜻한다. 출발 창고 입고가 끝나면 `draft` 이동 지시서가 자동으로 생긴다.
- 이 스펙 파일 안에 만들 픽스처 (정확한 시그니처):
  - `seedCrossWarehousePurchaseOrder(trx: DbTx): Promise<{ poId: string; sourceWarehouseId: string; destinationWarehouseId: string; skuId: string; quantity: number }>` — 공급사·창고 2개(`source ≠ destination`)·SKU·`purchase_orders`·`purchase_order_lines` 를 넣는다
  - `confirmPurchaseOrder(trx: DbTx, poId: string): Promise<void>` — `purchase-order.service.ts:287` 의 계획 생성 로직을 감싼 public 메서드를 호출한다. 메서드명은 그 파일에서 확인한다

- [ ] **Step 1: 실패하는 스펙 작성**

`purchase-order-single-plan.integration.spec.ts`:

```typescript
it('창고간 이동이 필요한 발주도 입고 계획을 하나만 만든다', async () => {
  await inRollback(async (trx) => {
    const { poId, sourceWarehouseId, destinationWarehouseId } = await seedCrossWarehousePurchaseOrder(trx);
    await confirmPurchaseOrder(trx, poId);

    const plans = await trx
      .select({ id: wmsTables.inboundPlans.id, warehouseId: wmsTables.inboundPlans.warehouseId, planType: wmsTables.inboundPlans.planType })
      .from(wmsTables.inboundPlans)
      .where(eq(wmsTables.inboundPlans.linkedPurchaseOrderId, poId));

    expect(plans).toHaveLength(1);
    expect(plans[0].planType).toBe('source');
    expect(plans[0].warehouseId).toBe(sourceWarehouseId);
    expect(destinationWarehouseId).not.toBe(sourceWarehouseId);
  });
});

it('입고예정 수량이 발주 수량과 같다 (이중 계상 없음)', async () => {
  await inRollback(async (trx) => {
    const { poId, sourceWarehouseId, skuId, quantity } = await seedCrossWarehousePurchaseOrder(trx);
    await confirmPurchaseOrder(trx, poId);

    const rows = (await trx.execute(sql`
      SELECT COALESCE(SUM(inbound_pending_qty), 0)::int AS qty FROM stock_summary_view
       WHERE sku_id = ${skuId} AND warehouse_id = ${sourceWarehouseId}
    `)) as unknown as { qty: number | string }[];

    expect(Number(rows[0]?.qty ?? 0)).toBe(quantity);
  });
});
```

`seedCrossWarehousePurchaseOrder` 는 공급사·창고 2개·SKU·`purchase_orders`(`sourceWarehouseId ≠ destinationWarehouseId`)·`purchase_order_lines` 를 넣고 식별자를 돌려준다. `confirmPurchaseOrder` 는 `PurchaseOrderService` 의 계획 생성 메서드를 부른다 — 정확한 메서드명은 `purchase-order.service.ts:287` 을 감싼 public 메서드에서 확인한다.

- [ ] **Step 2: 스펙 실행 — 실패 확인**

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- purchase-order-single-plan.integration
```

기대: 첫 케이스는 `Expected length: 1, Received length: 2`, 두 번째는 `qty` 가 발주 수량의 2배.

- [ ] **Step 3: destination plan 생성 제거**

`purchase-order.service.ts` 의 `requiresTransfer` 분기(`:291-320`)에서 destination plan 삽입 블록과 그 아이템 삽입을 삭제한다. source plan 만 남기고, `destinationWarehouseId` 컬럼은 하위 호환으로 그대로 채운다:

```typescript
if (requiresTransfer) {
  // 해외 발주: 공급사 → 출발 창고 입고 계획만 만든다.
  // 출발 창고 → 최종 목적지 이동은 별도 문서(transfer_orders)가 소유한다.
  // 예전에는 destination plan 을 함께 만들었는데, 두 계획이 모두
  // destination_warehouse_id 로 집계돼 입고예정이 2배로 잡혔고, destination plan
  // 수령이 무조건 RECEIVE 라 도착 창고에 재고를 만들면서 출발 창고를 깎지 않았다.
  const [sourcePlan] = await tx
    .insert(wmsTables.inboundPlans)
    .values({
      warehouseId: sourceWarehouseId,
      planType: 'source',
      linkedPurchaseOrderId: poId,
      destinationWarehouseId,
      requiresTransfer: true,
      expectedDate: purchaseOrder.expectedArrival,
      status: 'pending',
    })
    .returning();
  // ... source plan 아이템만 삽입 ...
}
```

`destinationPlan` 변수를 참조하던 이후 코드(반환값 등)를 전부 정리한다. `npx nest build core` 로 남은 참조가 없는지 확인한다.

- [ ] **Step 4: 뷰의 `inbound_pending` 집계 키 변경**

`inventory.schema.ts` 의 `stockSummary` 뷰 정의에서 `inbound_pending` 서브쿼리를 고친다. 집계 키를 `ip.destination_warehouse_id` → `ip.warehouse_id`(실제 입고될 창고)로 바꾼다:

```sql
LEFT JOIN (
    -- 그 창고에 실제로 입고될 예정 수량. destination_warehouse_id 로 집계하면
    -- source/destination 두 계획이 같은 창고에 잡혀 이중 계상된다.
    SELECT ipi.sku_id, ip.warehouse_id, SUM(ipi.expected_qty - ipi.received_qty) as qty
    FROM inbound_plan_items ipi
    INNER JOIN inbound_plans ip ON ipi.plan_id = ip.id
    WHERE ipi.status = 'pending'
    GROUP BY ipi.sku_id, ip.warehouse_id
) inbound_pending ON s.id = inbound_pending.sku_id AND w.id = inbound_pending.warehouse_id
```

같은 뷰에서 `transit_out` 서브쿼리도 교체한다. 이 항은 `inbound_plan_items` 를 읽어 `transfer_pending_qty` 를 채우고 있었는데, 이제 실제 이동은 `transfer_orders` 가 소유하므로 그쪽을 읽고 **도착 창고 기준**으로 집계한다:

```sql
LEFT JOIN (
    -- 미도착 이동 잔량. 도착 창고 기준이다 — 옛 정의는 inbound_plan_items 를 읽어
    -- 출발 창고에 붙였고, 실제 이동 경로를 추적하지 못했다.
    SELECT tol.sku_id, tord.to_warehouse_id AS warehouse_id,
           SUM(tol.shipped_qty - tol.received_qty - tol.lost_qty) as qty
    FROM transfer_order_lines tol
    INNER JOIN transfer_orders tord ON tord.id = tol.transfer_order_id
    WHERE (tol.shipped_qty - tol.received_qty - tol.lost_qty) > 0
    GROUP BY tol.sku_id, tord.to_warehouse_id
) transit_out ON s.id = transit_out.sku_id AND w.id = transit_out.warehouse_id
```

`transfer_pending_qty` 컬럼 자체는 이름과 위치를 유지한다 — 뜻만 "미도착 이동 잔량"으로 정확해진다. **`available_qty` 에서 이 항을 다시 빼지 않는다**(PR #618 이 제거한 바로 그 결함이다). Task 10 이 이 값을 `returnPendingQuantity` 로 내보내던 오배선을 끊는다.

- [ ] **Step 5: `projected_available_qty` 소비자 전수**

집계 키 변경으로 `projected_available_qty` 의 의미가 바뀐다. 소비자를 전수해 영향을 확인한다:

```bash
grep -rn "projected_available_qty\|projectedAvailable" apps/ --include=*.ts | grep -v "\.spec\."
grep -rn "inbound_pending_qty\|inboundPending" apps/ --include=*.ts | grep -v "\.spec\."
```

각 소비자를 열어, "부천에 곧 들어올 수량"을 기대하던 코드가 있으면 그 자리를 Task 8 의 파이프라인 판독으로 바꾼다. 없으면 그대로 둔다. **전수 결과를 커밋 메시지에 한 줄로 적는다.**

- [ ] **Step 6: 마이그레이션 생성 및 검토**

```bash
npm run db:generate:core -- --name fix-inbound-pending-warehouse-key
```

생성 SQL 이 `DROP VIEW "public"."stock_summary_view";` + `CREATE VIEW ...` 형태인지 확인한다(선례: `20260811214750_drop-transit-out-from-available-qty.sql`). 컬럼 구성은 그대로여야 한다 — `available_qty` 산식이 함께 바뀌지 않았는지 특히 확인한다.

- [ ] **Step 7: 스펙 통과와 파리티 회귀 확인**

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- purchase-order-single-plan.integration
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- view-parity.integration
```

기대: 둘 다 PASS. `view-parity` 는 `available_qty` 를 지키는 스펙이므로 여기서 깨지면 뷰를 잘못 고친 것이다.

- [ ] **Step 8: 커밋**

```bash
git add apps/core/src/modules/inventory/inbound/services/purchase-order.service.ts \
        apps/core/src/modules/inventory/schema/inventory.schema.ts \
        apps/core/drizzle \
        apps/core/src/modules/inventory/inbound/services/purchase-order-single-plan.integration.spec.ts
git commit -m "fix(inventory): 발주는 source plan 만 만들고 입고예정 집계를 실제 입고 창고 기준으로"
```

- [ ] **Step 9: 초안 자동 생성의 실패하는 스펙 작성**

destination plan 을 없앤 자리를 이동 지시서 초안이 대신한다. 이게 없으면 파이프라인 ②(출발 창고 대기)가 길어져 MD 가 중복 발주할 창이 넓어진다.

같은 스펙 파일에 추가한다:

```typescript
it('창고간 이동이 필요한 source plan 을 수령하면 draft 이동 지시서가 생긴다', async () => {
  await inRollback(async (trx) => {
    const ctx = await seedCrossWarehousePurchaseOrder(trx);
    await confirmPurchaseOrder(trx, ctx.poId);
    await receiveAgainstSourcePlan(trx, { poId: ctx.poId, skuId: ctx.skuId, quantity: ctx.quantity });

    const orders = await trx
      .select({
        id: wmsTables.transferOrders.id,
        status: wmsTables.transferOrders.status,
        fromWarehouseId: wmsTables.transferOrders.fromWarehouseId,
        toWarehouseId: wmsTables.transferOrders.toWarehouseId,
      })
      .from(wmsTables.transferOrders)
      .where(eq(wmsTables.transferOrders.fromWarehouseId, ctx.sourceWarehouseId));

    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe('draft');
    expect(orders[0].toWarehouseId).toBe(ctx.destinationWarehouseId);
  });
});

it('두 번 나눠 수령해도 초안 지시서는 하나이고 수량이 누적된다', async () => {
  await inRollback(async (trx) => {
    const ctx = await seedCrossWarehousePurchaseOrder(trx); // quantity 10 가정
    await confirmPurchaseOrder(trx, ctx.poId);
    await receiveAgainstSourcePlan(trx, { poId: ctx.poId, skuId: ctx.skuId, quantity: 4 });
    await receiveAgainstSourcePlan(trx, { poId: ctx.poId, skuId: ctx.skuId, quantity: 6 });

    const lines = await trx
      .select({ plannedQty: wmsTables.transferOrderLines.plannedQty })
      .from(wmsTables.transferOrderLines)
      .innerJoin(
        wmsTables.transferOrders,
        eq(wmsTables.transferOrders.id, wmsTables.transferOrderLines.transferOrderId),
      )
      .where(eq(wmsTables.transferOrders.fromWarehouseId, ctx.sourceWarehouseId));

    expect(lines).toHaveLength(1);
    expect(lines[0].plannedQty).toBe(10);
  });
});
```

`receiveAgainstSourcePlan(trx: DbTx, input: { poId: string; skuId: string; quantity: number }): Promise<void>` 는 `InboundService` 의 계획 기반 수령 경로를 호출한다 — `inbound.service.ts:790-796`(계획 아이템 누계 갱신)을 지나는 메서드다.

- [ ] **Step 10: 스펙 실행 — 실패 확인**

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- purchase-order-single-plan.integration
```

기대: 새 2건이 `Expected length: 1, Received length: 0` 으로 실패.

- [ ] **Step 11: 초안 자동 생성 구현**

`inbound.service.ts:790-796` 의 계획 아이템 누계 갱신 **직후**에 훅을 붙인다. 계획이 `source` 이고 `requires_transfer = true` 일 때만 동작한다:

```typescript
// 예정 누계/상태 갱신
const newReceived = (item.receivedQty ?? 0) + dto.quantity;
const newStatus = newReceived >= item.expectedQty ? 'confirmed' : 'pending';
await tx
  .update(wmsTables.inboundPlanItems)
  .set({ receivedQty: newReceived, status: newStatus })
  .where(eq(wmsTables.inboundPlanItems.id, item.id));

// 출발 창고에 들어온 물량은 최종 목적지로 옮겨야 한다. 초안을 자동으로 만들어
// "출발 창고 대기" 구간을 짧게 유지한다 — 이 구간이 길면 MD 가 재고 0/입고예정 0 으로
// 보고 중복 발주한다. 확정(선적)은 사람이 한다.
await this.transferDraft.upsertDraftForReceivedPlanItem(
  { planId: item.planId, skuId: item.skuId, receivedQty: dto.quantity, toLocationId: effectiveLocationId },
  tx,
);
```

`upsertDraftForReceivedPlanItem` 은 Task 5 의 모듈에 추가한다(`warehouse-transfer.manager.ts` 옆에 `transfer-draft.service.ts`):

```typescript
/**
 * 출발 창고 입고분에 대한 draft 이동 지시서를 만들거나 수량을 누적한다.
 * 출발↔목적지 창고 쌍당 draft 는 하나만 유지한다 — 수령 회차마다 지시서가 늘면
 * 물류팀이 배 한 척에 여러 지시서를 들고 선적하게 된다.
 */
async upsertDraftForReceivedPlanItem(
  input: { planId: string; skuId: string; receivedQty: number; toLocationId: string },
  tx: DbTx,
): Promise<void> {
  const [plan] = await tx
    .select({
      warehouseId: wmsTables.inboundPlans.warehouseId,
      destinationWarehouseId: wmsTables.inboundPlans.destinationWarehouseId,
      requiresTransfer: wmsTables.inboundPlans.requiresTransfer,
      planType: wmsTables.inboundPlans.planType,
    })
    .from(wmsTables.inboundPlans)
    .where(eq(wmsTables.inboundPlans.id, input.planId))
    .limit(1);

  if (!plan || !plan.requiresTransfer || plan.planType !== 'source') return;
  if (plan.warehouseId === plan.destinationWarehouseId) return;

  const [existing] = await tx
    .select({ id: wmsTables.transferOrders.id })
    .from(wmsTables.transferOrders)
    .where(
      and(
        eq(wmsTables.transferOrders.fromWarehouseId, plan.warehouseId),
        eq(wmsTables.transferOrders.toWarehouseId, plan.destinationWarehouseId),
        eq(wmsTables.transferOrders.status, 'draft'),
      ),
    )
    .for('update')
    .limit(1);

  const orderId =
    existing?.id ??
    (
      await tx
        .insert(wmsTables.transferOrders)
        .values({
          fromWarehouseId: plan.warehouseId,
          toWarehouseId: plan.destinationWarehouseId,
          status: 'draft',
          memo: '입고 자동 생성 초안',
        })
        .returning({ id: wmsTables.transferOrders.id })
    )[0]?.id;

  if (!orderId) throw new Error('transfer_orders insert returned no row');

  await tx
    .insert(wmsTables.transferOrderLines)
    .values({
      transferOrderId: orderId,
      skuId: input.skuId,
      fromLocationId: input.toLocationId,
      plannedQty: input.receivedQty,
    })
    .onConflictDoUpdate({
      target: [
        wmsTables.transferOrderLines.transferOrderId,
        wmsTables.transferOrderLines.skuId,
        wmsTables.transferOrderLines.fromLocationId,
      ],
      set: {
        plannedQty: sql`${wmsTables.transferOrderLines.plannedQty} + ${input.receivedQty}`,
        updatedAt: new Date(),
      },
    });
}
```

`InboundService` 생성자에 `TransferDraftService` 를 주입하고, `InboundModule` 이 `WarehouseTransferModule` 을 import 하게 한다. **순환 참조가 나면** `WarehouseTransferModule` 이 `CoreInventoryModule` 만 import 하고 `InboundModule` 을 참조하지 않는지 확인한다(현재 설계는 참조하지 않는다).

- [ ] **Step 12: 스펙 통과 확인과 커밋**

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- purchase-order-single-plan.integration
npx nest build core
```

기대: 4건 전부 PASS, 빌드 성공.

```bash
git add apps/core/src/modules/inventory
git commit -m "feat(inventory): 출발 창고 입고 시 이동 지시서 초안 자동 생성"
```

---

## Task 8: 공급 파이프라인 판독

품절 상품이 언제 몇 개 들어오는지를 3단계로 낸다. ②(출발창고 대기)를 빼면 MD 가 중복 발주한다.

**Files:**
- Create: `apps/core/src/modules/inventory/stock-projection/services/inbound-pipeline.reader.ts`
- Create: `apps/core/src/modules/inventory/stock-projection/dto/inbound-pipeline.dto.ts`
- Modify: `apps/core/src/modules/inventory/stock-projection/services/stock-projection.service.ts`
- Modify: `apps/core/src/modules/inventory/stock-projection/controllers/stock-projection.controller.ts`
- Modify: `apps/core/src/modules/inventory/stock-projection/stock-projection.module.ts`
- Create: `apps/core/src/modules/inventory/stock-projection/services/inbound-pipeline.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 의 `inSellableWarehouse`, Task 3 의 이동 지시서 테이블, Task 7 의 단일 source plan
- Produces: `InboundPipelineReader.read(tx: DbTx, input: { skuIds: string[]; toWarehouseId: string }): Promise<InboundPipelineRow[]>`
  - `InboundPipelineRow = { skuId: string; onOrderQty: number; onOrderEta: Date | null; awaitingTransferQty: number; inTransitQty: number; inTransitEta: Date | null }`
- 이 스펙 파일 안에 만들 픽스처 (정확한 시그니처):
  - `seedTwoWarehouses(trx: DbTx): Promise<{ source: { warehouseId: string; locationId: string }; dest: { warehouseId: string; locationId: string }; skuId: string }>` — **`source` 창고는 `is_sellable = false` 로 만든다**(파이프라인 ①②가 비판매 창고 기준이다)
  - `seedPendingSourcePlan(trx: DbTx, input: { skuId: string; warehouseId: string; qty: number; expectedDate: Date }): Promise<void>` — 공급사·발주(`purchase_orders`)를 먼저 넣어야 한다. `inbound_plans.linked_purchase_order_id` 가 **NOT NULL + FK** 다
  - `shipTransfer(trx: DbTx, input: { skuId: string; from: {...}; to: {...}; qty: number; eta: Date }): Promise<void>` — 지시서 생성 후 Task 5 의 `ship` 을 호출한다
  - `buildReader(trx: DbTx): InboundPipelineReader` — Task 2 Step 3 의 `dbServiceStub(trx)` 사용

- [ ] **Step 1: 실패하는 스펙 작성**

`inbound-pipeline.integration.spec.ts`:

```typescript
it('세 단계를 각각 수량과 예정일로 낸다', async () => {
  await inRollback(async (trx) => {
    const { source, dest, skuId } = await seedTwoWarehouses(trx); // source 는 is_sellable=false
    // ① 발주 잔량 300 (source 창고 입고 예정, 예정일 9/1)
    await seedPendingSourcePlan(trx, { skuId, warehouseId: source.warehouseId, qty: 300, expectedDate: new Date('2026-09-01') });
    // ② 출발창고 대기 200
    await receiveStock(trx, skuId, source.warehouseId, source.locationId, 250);
    // ③ 이동 중 50 (ETA 8/20) — 250 중 50 을 선적
    await shipTransfer(trx, { skuId, from: source, to: dest, qty: 50, eta: new Date('2026-08-20') });

    const [row] = await buildReader(trx).read(trx, { skuIds: [skuId], toWarehouseId: dest.warehouseId });

    expect(row.onOrderQty).toBe(300);
    expect(row.onOrderEta).toEqual(new Date('2026-09-01'));
    expect(row.awaitingTransferQty).toBe(200); // 250 − 선적 50
    expect(row.inTransitQty).toBe(50);
    expect(row.inTransitEta).toEqual(new Date('2026-08-20'));
  });
});

it('예정일이 없는 단계는 null 로 낸다 (숨기지 않는다)', async () => {
  await inRollback(async (trx) => {
    const { source, dest, skuId } = await seedTwoWarehouses(trx);
    await receiveStock(trx, skuId, source.warehouseId, source.locationId, 40);

    const [row] = await buildReader(trx).read(trx, { skuIds: [skuId], toWarehouseId: dest.warehouseId });

    expect(row.awaitingTransferQty).toBe(40);
    expect(row.inTransitQty).toBe(0);
    expect(row.inTransitEta).toBeNull();
  });
});
```

- [ ] **Step 2: 스펙 실행 — 실패 확인**

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- inbound-pipeline.integration
```

기대: 모듈을 못 찾아 컴파일 실패.

- [ ] **Step 3: 판독 구현**

`inbound-pipeline.reader.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsSchema, DbTx } from '../../schema/inventory.schema';

export interface InboundPipelineRow {
  skuId: string;
  onOrderQty: number;
  onOrderEta: Date | null;
  awaitingTransferQty: number;
  inTransitQty: number;
  inTransitEta: Date | null;
}

/**
 * 대상 창고(판매 창고) 관점의 공급 파이프라인.
 *
 * ① 발주 잔량   — 비판매 창고로 입고 예정인 pending 계획
 * ② 이동 대기   — 비판매 창고 ON_HAND (아직 선적되지 않음)
 * ③ 이동 중     — IN_TRANSFER 이면서 미도착 정산이 남은 지시서 잔량
 *
 * ②를 빼면 "재고 0, 입고예정 0" 으로 보여 중복 발주가 난다. 예정일이 없는 단계는
 * 숨기지 않고 null 로 낸다 — 숨기면 그 구간이 다시 사각지대가 된다.
 */
@Injectable()
export class InboundPipelineReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async read(tx: DbTx, input: { skuIds: string[]; toWarehouseId: string }): Promise<InboundPipelineRow[]> {
    if (input.skuIds.length === 0) return [];

    const rows = (await tx.execute(sql`
      WITH target AS (SELECT ${input.toWarehouseId}::uuid AS warehouse_id),
      on_order AS (
        SELECT ipi.sku_id,
               SUM(ipi.expected_qty - ipi.received_qty)::int AS qty,
               MIN(ip.expected_date) AS eta
          FROM inbound_plan_items ipi
          JOIN inbound_plans ip ON ip.id = ipi.plan_id
          JOIN warehouses w ON w.id = ip.warehouse_id
         WHERE ipi.status = 'pending'
           AND w.is_sellable = false
           AND ipi.sku_id = ANY(${input.skuIds})
         GROUP BY ipi.sku_id
      ),
      awaiting AS (
        SELECT sl.sku_id, SUM(sl.qty)::int AS qty
          FROM stock_ledgers sl
          JOIN warehouses w ON w.id = sl.warehouse_id
         WHERE sl.stock_state = 'ON_HAND'
           AND w.is_sellable = false
           AND sl.sku_id = ANY(${input.skuIds})
         GROUP BY sl.sku_id
      ),
      in_transit AS (
        SELECT tol.sku_id,
               SUM(tol.shipped_qty - tol.received_qty - tol.lost_qty)::int AS qty,
               MIN(tord.eta) AS eta
          FROM transfer_order_lines tol
          JOIN transfer_orders tord ON tord.id = tol.transfer_order_id
         WHERE (tol.shipped_qty - tol.received_qty - tol.lost_qty) > 0
           AND tord.to_warehouse_id = (SELECT warehouse_id FROM target)
           AND tol.sku_id = ANY(${input.skuIds})
         GROUP BY tol.sku_id
      )
      SELECT s.id AS sku_id,
             COALESCE(on_order.qty, 0) AS on_order_qty, on_order.eta AS on_order_eta,
             COALESCE(awaiting.qty, 0) AS awaiting_qty,
             COALESCE(in_transit.qty, 0) AS in_transit_qty, in_transit.eta AS in_transit_eta
        FROM skus s
        LEFT JOIN on_order ON on_order.sku_id = s.id
        LEFT JOIN awaiting ON awaiting.sku_id = s.id
        LEFT JOIN in_transit ON in_transit.sku_id = s.id
       WHERE s.id = ANY(${input.skuIds})
    `)) as unknown as Array<{
      sku_id: string;
      on_order_qty: number | string;
      on_order_eta: Date | null;
      awaiting_qty: number | string;
      in_transit_qty: number | string;
      in_transit_eta: Date | null;
    }>;

    return rows.map((row) => ({
      skuId: row.sku_id,
      onOrderQty: Number(row.on_order_qty),
      onOrderEta: row.on_order_eta,
      awaitingTransferQty: Number(row.awaiting_qty),
      inTransitQty: Number(row.in_transit_qty),
      inTransitEta: row.in_transit_eta,
    }));
  }
}
```

**주의**: `②` 는 비판매 창고 ON_HAND 전체이고, 선적된 물량은 이미 `IN_TRANSFER` 로 빠져 있으므로 ③과 겹치지 않는다. `sku_id = ANY(...)` 바인딩이 postgres.js 배열로 정상 전달되는지 스펙에서 확인한다 — 안 되면 `inArray` 를 쓰는 Drizzle 쿼리로 바꾼다.

- [ ] **Step 4: 스펙 통과 확인**

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- inbound-pipeline.integration
```

기대: PASS(2건).

- [ ] **Step 5: 변별력 증명 — ② 를 지우고 RED 관측**

`awaiting` CTE 의 `SUM(sl.qty)` 를 `0` 으로 바꾸고 재실행한다. 첫 케이스가 `200 → 0` 으로 실패해야 한다. 확인 후 원복한다. **이 단계를 건너뛰면 파이프라인의 핵심(사각지대 ②)이 실제로 지켜지는지 증명되지 않는다.**

- [ ] **Step 6: DTO·서비스·컨트롤러 배선**

`inbound-pipeline.dto.ts` 에 응답 DTO 를 만든다:

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InboundPipelineItemDto {
  @ApiProperty() skuId: string;
  @ApiProperty({ description: '발주 잔량 (비판매 창고 입고 예정)' }) onOrderQty: number;
  @ApiPropertyOptional({ description: '발주 도착 예정일', nullable: true }) onOrderEta: Date | null;
  @ApiProperty({ description: '이동 대기 (출발 창고 보유, 미선적)' }) awaitingTransferQty: number;
  @ApiProperty({ description: '이동 중 (미도착 잔량)' }) inTransitQty: number;
  @ApiPropertyOptional({ description: '이동 도착 예정일', nullable: true }) inTransitEta: Date | null;
}

export class InboundPipelineResponseDto {
  @ApiProperty({ type: [InboundPipelineItemDto] })
  items: InboundPipelineItemDto[];
}
```

`stock-projection.service.ts` 에 위임 메서드를 추가하고, `stock-projection.controller.ts` 에 `GET /…/inbound-pipeline?warehouseId=&skuIds=` 를 붙인다. 컨트롤러 입력 가드(`if (!warehouseId) throw new BadRequestException('warehouseId is required')`)는 컨트롤러에서 한다. `stock-projection.module.ts` 의 `providers` 에 `InboundPipelineReader` 를 추가한다.

- [ ] **Step 7: 빌드·타입체크·커밋**

```bash
npx nest build core && npm run type-check
git add apps/core/src/modules/inventory/stock-projection
git commit -m "feat(inventory): 공급 파이프라인 판독 — 발주잔량/이동대기/이동중 3단계"
```

---

## Task 9: 체류 감시 크론

②·③에 오래 머무는 물량을 알린다. 이동 지시서 생성을 잊는 운영 실수와 영원한 미도착을 잡는다.

**Files:**
- Create: `apps/core/src/modules/inventory/warehouse-transfer/services/transfer-stagnation.monitor.ts`
- Modify: `apps/core/src/modules/inventory/warehouse-transfer/warehouse-transfer.module.ts`
- Create: `apps/core/src/modules/inventory/warehouse-transfer/services/transfer-stagnation.monitor.spec.ts`

**Interfaces:**
- Consumes: Task 5 의 `WarehouseTransferReader.findOutstanding`
- Produces: `TransferStagnationMonitor.findStagnant(now: Date, outstanding: OutstandingTransfer[], thresholdDays: number): OutstandingTransfer[]` (순수 함수 — 단위 테스트 가능)

- [ ] **Step 1: 순수 판정 함수의 단위 테스트 작성**

크론 자체가 아니라 **판정을 순수 함수로 뽑아** 단위 테스트한다. 이 프로젝트에서 "테스트 초록 ≠ 배선 살아있음"이 반복된 실패라, 판정은 DB 없이 검증하고 배선은 빌드·수동 확인으로 나눈다.

`transfer-stagnation.monitor.spec.ts`:

```typescript
import { findStagnant } from './transfer-stagnation.monitor';

const base = {
  transferOrderId: 'o1',
  transferOrderLineId: 'l1',
  skuId: 's1',
  toWarehouseId: 'w1',
  outstandingQty: 5,
  eta: null as Date | null,
};

describe('findStagnant', () => {
  it('선적 후 임계일을 넘긴 잔량만 고른다', () => {
    const now = new Date('2026-08-12T00:00:00Z');
    const result = findStagnant(
      now,
      [
        { ...base, transferOrderLineId: 'old', shippedAt: new Date('2026-07-01T00:00:00Z') },
        { ...base, transferOrderLineId: 'new', shippedAt: new Date('2026-08-10T00:00:00Z') },
      ],
      30,
    );
    expect(result.map((r) => r.transferOrderLineId)).toEqual(['old']);
  });

  it('선적 시각이 없으면 체류로 보지 않는다', () => {
    const now = new Date('2026-08-12T00:00:00Z');
    expect(findStagnant(now, [{ ...base, shippedAt: null }], 30)).toEqual([]);
  });

  it('ETA 가 지났으면 임계일 이전이라도 고른다', () => {
    const now = new Date('2026-08-12T00:00:00Z');
    const result = findStagnant(
      now,
      [{ ...base, shippedAt: new Date('2026-08-10T00:00:00Z'), eta: new Date('2026-08-11T00:00:00Z') }],
      30,
    );
    expect(result).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx jest --testPathPattern=transfer-stagnation.monitor
```

기대: `Cannot find module './transfer-stagnation.monitor'`.

- [ ] **Step 3: 판정 함수와 크론 구현**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsSchema } from '../../schema/inventory.schema';
import { WarehouseTransferReader, OutstandingTransfer } from './warehouse-transfer.reader';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 체류 판정. 선적 후 임계일을 넘겼거나 ETA 가 지났는데 아직 미도착인 잔량.
 * 순수 함수로 뽑아 DB 없이 검증한다 — 크론 배선은 별도로 확인한다.
 */
export function findStagnant(
  now: Date,
  outstanding: OutstandingTransfer[],
  thresholdDays: number,
): OutstandingTransfer[] {
  return outstanding.filter((row) => {
    if (!row.shippedAt) return false;
    const overThreshold = now.getTime() - row.shippedAt.getTime() > thresholdDays * DAY_MS;
    const pastEta = row.eta !== null && now.getTime() > row.eta.getTime();
    return overThreshold || pastEta;
  });
}

@Injectable()
export class TransferStagnationMonitor {
  private static readonly THRESHOLD_DAYS = 30;
  private readonly logger = new Logger(TransferStagnationMonitor.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly reader: WarehouseTransferReader,
  ) {}

  @Cron('0 4 * * *')
  async report(): Promise<void> {
    const outstanding = await this.dbService.run((trx) => this.reader.findOutstanding(trx));
    const stagnant = findStagnant(new Date(), outstanding, TransferStagnationMonitor.THRESHOLD_DAYS);
    if (stagnant.length === 0) return;

    this.logger.warn(
      `창고간 이동 체류 ${stagnant.length}건: ` +
        stagnant
          .map((row) => `order=${row.transferOrderId} line=${row.transferOrderLineId} qty=${row.outstandingQty}`)
          .join(', '),
    );
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx jest --testPathPattern=transfer-stagnation.monitor
```

기대: PASS(3건).

- [ ] **Step 5: 모듈 등록과 배선 확인**

`warehouse-transfer.module.ts` 의 `providers` 에 `TransferStagnationMonitor` 를 추가한다. `@Cron` 이 동작하려면 `ScheduleModule` 이 앱 어딘가에서 `forRoot()` 로 초기화돼 있어야 한다 — `CoreInventoryModule` 이 이미 한다(`inventory.module.ts:37`). `npx nest build core` 로 확인한다.

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/inventory/warehouse-transfer
git commit -m "feat(inventory): 창고간 이동 체류 감시 크론"
```

---

## Task 10: 죽은 경로 삭제

실측상 `warehouse_transfer` 저널이 0건이라 기존 창고간 경로는 프로덕션 실행 이력이 없다. 두 벌이 남으면 다음 사람이 어느 쪽이 정본인지 모른다.

**Files:**
- Modify: `apps/core/src/modules/inventory/core/services/transfer.service.ts:158-230` (창고간 분기 제거)
- Modify: `apps/core/src/modules/inventory/core/services/stock-event.service.ts:96-157` (`transferBetweenWarehouses` 제거)
- Modify: `apps/core/src/modules/inventory/core/controllers/transfer.controller.ts` (창고간 관련 문구·DTO 정리)
- Modify: `apps/core/src/modules/inventory/stock-projection/services/stock-projection.reader.ts:212`

**Interfaces:**
- Consumes: Task 5·6 이 대체 경로를 제공한 뒤에만 수행
- Produces: 창고 간 이동의 유일한 경로가 `WarehouseTransferService` 다

- [ ] **Step 1: 호출자 전수**

```bash
grep -rn "transferBetweenWarehouses\|isInterWarehouse" apps/ --include=*.ts
```

`transfer.service.ts` 와 `stock-event.service.ts` 외의 호출자가 있으면 삭제 전에 목록을 적어둔다. admin-web 등 프런트에서 `POST /inventory/transfers` 를 창고간으로 쓰고 있으면 **이번에 지우지 말고** 별도 태스크로 남긴다.

- [ ] **Step 2: 창고간 분기 제거**

`transfer.service.ts` 의 `executeTransferJob` 에서 `isInterWarehouse` 분기를 제거하고, 창고가 다르면 거절한다:

```typescript
const isInterWarehouse = fromLocation.warehouseId !== toLocation.warehouseId;
if (isInterWarehouse) {
  // 창고 간 이동은 transfer_orders 가 소유한다. movement job 은 창고 내 전용이다.
  throw new BadRequestException('창고 간 이동은 이동 지시서(warehouse-transfers) 를 사용한다');
}
```

이후 `moveInternal` 분기만 남긴다. `stock-event.service.ts` 의 `transferBetweenWarehouses` 메서드는 통째로 삭제한다.

- [ ] **Step 3: `transfer_pending_qty` 오배선 제거**

`stock-projection.reader.ts:212` 가 `transfer_pending_qty` 를 `returnPendingQuantity`(회송 예정)라는 다른 이름으로 내보내고 있다. 해당 필드 매핑을 제거하고, 컴파일 에러가 나는 DTO 필드도 함께 제거한다. 뷰의 `transfer_pending_qty` 컬럼 자체는 남겨두되(다른 소비자 확인 필요), 이 오배선만 끊는다.

```bash
grep -rn "returnPendingQuantity\|transferPending" apps/ --include=*.ts
```

- [ ] **Step 4: 빌드·타입체크·전체 통합 스펙**

```bash
npx nest build core
npm run type-check
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- "apps/core.*integration"
```

기대: 빌드 성공, type-check 161 이하, 사전 RED 5 suite 외 새 실패 없음.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/inventory
git commit -m "refactor(inventory): 창고간 이동의 옛 경로 제거 — 지시서가 유일한 경로"
```

---

## Task 11: (별도 PR) 기존 destination plan 정리 — contract

**이 태스크는 Task 1~10 이 배포 완료된 뒤에 별도 PR 로 수행한다.** expand-contract 컨벤션상 두 phase 사이에 최소 한 번의 deploy 가 끝나야 한다.

**Files:**
- Create: `apps/core/drizzle/<timestamp>_close-legacy-destination-plans.sql` (수기 작성)

- [ ] **Step 1: 대상 행 재실측**

```sql
SELECT plan_type, status, count(*) FROM inbound_plans
WHERE parent_plan_id IS NOT NULL GROUP BY 1,2;
```

착수 시점 기준 destination plan 수를 확인한다(설계 시점 실측은 135건). 0이면 이 태스크는 불필요하므로 닫는다.

- [ ] **Step 2: 정리 방침 결정**

destination plan 은 이제 아무도 만들지 않고 아무도 읽지 않는다(Task 7 에서 뷰의 집계 키가 `warehouse_id` 로 바뀌어 부천 입고예정에 잡히지도 않는다). 두 선택지 중 하나를 고르고 **선택 이유를 마이그레이션 SQL 주석에 남긴다**:

- **(a) 상태만 마감**: `UPDATE inbound_plans SET status = 'confirmed' WHERE parent_plan_id IS NOT NULL` — 이력을 남긴다. 되돌리기 쉽다.
- **(b) 삭제**: `DELETE FROM inbound_plans WHERE parent_plan_id IS NOT NULL` — `inbound_plan_items` 는 `ON DELETE cascade` 라 함께 사라진다. 되돌릴 수 없다.

**기본은 (a)** — 실물 이력이고, 삭제로 얻는 것이 없다.

- [ ] **Step 3: 마이그레이션 작성 및 적용 확인**

`apps/core/drizzle/` 에 다음 timestamp 로 SQL 파일을 만들고 `drizzle/meta/_journal.json` 에 항목을 추가한다. **수기 작성이므로 journal 등록을 빠뜨리면 영원히 적용되지 않는다** — 이 프로젝트에서 실제로 겪은 실패 양상이다.

로컬에서 적용을 확인한다:

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- purchase-order-single-plan.integration
```

러너가 마이그레이션을 적용하므로, 이 명령이 통과하면 SQL 이 실제로 실행된 것이다.

- [ ] **Step 4: 커밋**

```bash
git add apps/core/drizzle
git commit -m "chore(inventory): 옛 destination 입고 계획 마감 (contract)"
```

---

## 배포 순서

1. **Task 1~10 을 하나의 PR 로.** 마이그레이션이 전부 additive 이므로 **`migrate → deploy`**(expand 순서). contract 의 `deploy → migrate` 와 반대다 — 혼동하면 새 코드가 옛 스키마를 만난다.
2. 배포 후 확인: `product_sellable_quantity` 값이 변하지 않아야 한다(중국 ON_HAND 가 0이므로). 변했다면 필터가 판매 창고까지 걸러낸 것이므로 즉시 조사한다.
3. **한 번의 deploy 가 끝난 뒤** Task 11 을 별도 PR 로.

## 알려진 잔여

- 프론트(storefront·admin-web) 노출은 이 계획 밖이다. `GET /…/inbound-pipeline` 이 core API 로 열리지만, storefront 는 Medusa 를 통해 상품을 읽으므로 Medusa 투영이 한 겹 더 필요하다.
- 중국 창고 ON_HAND 가 0이라 파이프라인 ②·③은 실데이터로 검증할 수 없다. 통합 스펙이 유일한 방어선이며, 그래서 Task 8 Step 5(변별력 증명)를 건너뛰면 안 된다.
- 출고작업 custody 의 창고 grain 확장(#618 후속 2번, 숏피킹 구간의 "예약은 되나 피킹 때 409" 틈)은 별건으로 남는다.
