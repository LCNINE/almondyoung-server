import { outboxPublisherFor } from '../../../fulfillment/outbox/__support__/outbox-publisher.factory';
import { INVENTORY_STREAM } from '@packages/event-contracts/streams';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql as dsql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { NotFoundError } from '@app/shared';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { StockProjectionReader } from './stock-projection.reader';
import { StockEventStore } from '../../core/repositories/stock-event.store';
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

// 이 파일의 두 describeIfDb 블록(by-location / getLocationContents)이 공유하는 셋업.
// 모듈 스코프에 둬야 두 블록에서 동일한 reader/inRollbackTx/seedEntities 를 재사용할 수 있다.
jest.setTimeout(120_000);
let sql: postgres.Sql;
let db: PostgresJsDatabase<typeof wmsSchema>;
let reader: StockProjectionReader;

beforeAll(() => {
  if (!DATABASE_URL) return;
  sql = postgres(DATABASE_URL, { max: 1 });
  db = drizzle(sql, { schema: wmsSchema });
  const dbService = {
    db,
    run: async (fn: (t: DbTx) => Promise<unknown>, t?: DbTx) => (t ? fn(t) : db.transaction(fn)),
  } as unknown as DbService<typeof wmsSchema>;
  const outbox = outboxPublisherFor(INVENTORY_STREAM, dbService);
  const sellable = new ProductSellableQuantityService(dbService as never, outbox);
  const eventStore = new StockEventStore(dbService, sellable);
  reader = new StockProjectionReader(dbService, eventStore);
});
afterAll(async () => {
  if (!DATABASE_URL) return;
  await sql.end();
});

async function inRollbackTx(fn: (tx: DbTx) => Promise<void>) {
  await expect(
    db.transaction(async (tx) => {
      await fn(tx);
      throw new Rollback();
    }),
  ).rejects.toThrow(Rollback);
}

// 엔티티(창고/보유자/SKU/로케이션)만 시딩한다. 원장 행은 각 테스트가 필요한 모양대로 얹는다.
async function seedEntities(tx: DbTx) {
  const [warehouse] = await tx
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
  // 코드 역순으로 삽입해 정렬이 실제로 적용되는지 본다.
  const [locB] = await tx
    .insert(wmsTables.locations)
    .values({ warehouseId: warehouse.id, code: `IT-LOC-B-${randomUUID().slice(0, 8)}`, locationType: 'zone' })
    .returning();
  const [locA] = await tx
    .insert(wmsTables.locations)
    .values({ warehouseId: warehouse.id, code: `IT-LOC-A-${randomUUID().slice(0, 8)}`, locationType: 'zone' })
    .returning();
  return { warehouse, sku, locA, locB };
}

describeIfDb('stock projection by-location (DB integration, rollback-only)', () => {
  it('details 각 행에 locationCode 를 동반하고 위치 코드 오름차순으로 정렬한다', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, sku, locA, locB } = await seedEntities(tx);
      await tx.insert(wmsTables.stockLedgers).values([
        { skuId: sku.id, warehouseId: warehouse.id, locationId: locB.id, stockState: 'ON_HAND', qty: 7 },
        { skuId: sku.id, warehouseId: warehouse.id, locationId: locA.id, stockState: 'ON_HAND', qty: 5 },
      ]);

      const result = await reader.getBySkuAndWarehouse(sku.id, warehouse.id, tx);

      expect(result.details).toHaveLength(2);
      expect(result.details[0].locationId).toBe(locA.id);
      expect(result.details[0].locationCode).toBe(locA.code);
      expect(result.details[0].quantity).toBe(5);
      expect(result.details[1].locationId).toBe(locB.id);
      expect(result.details[1].locationCode).toBe(locB.code);
      expect(result.details[1].quantity).toBe(7);
    });
  });

  // stock_ledgers.location_id 는 NOT NULL 이자 복합 PK 구성 컬럼이다
  // (apps/core/drizzle/20260518141559_baseline.sql:1205,1209) — locationId: null 행은
  // 애초에 삽입 불가능해 "NULLS LAST" 경로 자체는 실사용 데이터로 재현할 수 없다.
  // 대신 동일 locationCode 내에서 stockState 오름차순으로 2차 정렬되는지 검증한다.
  it('locationCode 가 같으면 stockState 오름차순으로 2차 정렬한다', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, sku, locA, locB } = await seedEntities(tx);
      // 삽입 순서를 기대 출력 순서와 반대로 둔다(DEFECTIVE 먼저, ON_HAND 나중).
      await tx.insert(wmsTables.stockLedgers).values([
        { skuId: sku.id, warehouseId: warehouse.id, locationId: locB.id, stockState: 'ON_HAND', qty: 7 },
        { skuId: sku.id, warehouseId: warehouse.id, locationId: locA.id, stockState: 'DEFECTIVE', qty: 2 },
        { skuId: sku.id, warehouseId: warehouse.id, locationId: locA.id, stockState: 'ON_HAND', qty: 5 },
      ]);

      // 위 삽입 순서 역전만으로는 이 정렬 키 누락을 못 잡는다: 기본 플래너는
      // (sku_id, warehouse_id, location_id, stock_state) 복합 인덱스(ix_ledgers_lookup)의
      // Index Scan 이나, Hash Join 의 LIFO 버킷 순서를 타서 stockState ORDER BY 항을
      // 지워도 "우연히" location_id, stock_state 순으로 나온다 — EXPLAIN ANALYZE 로 직접
      // 확인함. 인덱스/해시/머지 경로를 꺼서 Nested Loop + Seq Scan 을 강제해야
      // 정렬 키가 실제로 하는 일(삽입 순서를 뒤엎는 것)이 드러난다.
      await tx.execute(dsql`SET LOCAL enable_indexscan = off`);
      await tx.execute(dsql`SET LOCAL enable_bitmapscan = off`);
      await tx.execute(dsql`SET LOCAL enable_indexonlyscan = off`);
      await tx.execute(dsql`SET LOCAL enable_hashjoin = off`);
      await tx.execute(dsql`SET LOCAL enable_mergejoin = off`);

      const result = await reader.getBySkuAndWarehouse(sku.id, warehouse.id, tx);

      expect(result.details).toHaveLength(3);
      // locA 코드가 locB보다 작으므로 locA 의 두 행이 먼저 오고, 그 안에서 stockState ASC.
      // stock_state 는 Postgres enum 이라 선언 순서(ON_HAND, DEFECTIVE, IN_TRANSFER)로
      // 정렬된다(사전순이 아님) — ON_HAND 가 DEFECTIVE 보다 먼저다.
      expect(result.details[0].locationId).toBe(locA.id);
      expect(result.details[0].stockState).toBe('ON_HAND');
      expect(result.details[0].quantity).toBe(5);
      expect(result.details[1].locationId).toBe(locA.id);
      expect(result.details[1].stockState).toBe('DEFECTIVE');
      expect(result.details[1].quantity).toBe(2);
      expect(result.details[2].locationId).toBe(locB.id);
      expect(result.details[2].stockState).toBe('ON_HAND');
      expect(result.details[2].quantity).toBe(7);
    });
  });
});

describeIfDb('getLocationContents (DB integration, rollback-only)', () => {
  it('로케이션 내용물을 skuCode 오름차순으로, 조인된 코드·이름과 함께 반환한다', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, locA } = await seedEntities(tx);
      const [holderX] = await tx
        .insert(wmsTables.holders)
        .values({ name: `it-hx-${randomUUID().slice(0, 8)}` })
        .returning();
      // 4번째 문자 'A' < 'Z' 라 접미 uuid 와 무관하게 skuLo.code < skuHi.code 가 확정된다.
      const [skuLo] = await tx
        .insert(wmsTables.skus)
        .values({ name: 'lo', code: `IT-A-${randomUUID()}`, holderId: holderX.id })
        .returning();
      const [skuHi] = await tx
        .insert(wmsTables.skus)
        .values({ name: 'hi', code: `IT-Z-${randomUUID()}`, holderId: holderX.id })
        .returning();
      // 기대 출력과 반대 순서로 삽입해 정렬이 실제로 적용되는지 본다.
      await tx.insert(wmsTables.stockLedgers).values([
        { skuId: skuHi.id, warehouseId: warehouse.id, locationId: locA.id, stockState: 'ON_HAND', qty: 4 },
        { skuId: skuLo.id, warehouseId: warehouse.id, locationId: locA.id, stockState: 'ON_HAND', qty: 9 },
      ]);

      const result = await reader.getLocationContents(locA.id, tx);

      expect(result.locationId).toBe(locA.id);
      expect(result.locationCode).toBe(locA.code);
      expect(result.warehouseId).toBe(warehouse.id);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].skuId).toBe(skuLo.id);
      expect(result.items[0].skuCode).toBe(skuLo.code);
      expect(result.items[0].skuName).toBe('lo');
      expect(result.items[0].quantity).toBe(9);
      expect(result.items[1].skuId).toBe(skuHi.id);
    });
  });

  it('없는 로케이션은 NotFoundError 를 던진다', async () => {
    await inRollbackTx(async (tx) => {
      await expect(reader.getLocationContents(randomUUID(), tx)).rejects.toThrow(NotFoundError);
    });
  });

  it('재고가 없는 로케이션은 빈 items 를 준다', async () => {
    await inRollbackTx(async (tx) => {
      const { locB } = await seedEntities(tx);
      const result = await reader.getLocationContents(locB.id, tx);
      expect(result.items).toEqual([]);
    });
  });

  it('ON_HAND 가 아닌 상태(DEFECTIVE)도 필터 없이 함께 반환한다', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, sku, locA } = await seedEntities(tx);
      await tx.insert(wmsTables.stockLedgers).values([
        { skuId: sku.id, warehouseId: warehouse.id, locationId: locA.id, stockState: 'ON_HAND', qty: 5 },
        { skuId: sku.id, warehouseId: warehouse.id, locationId: locA.id, stockState: 'DEFECTIVE', qty: 1 },
      ]);
      const result = await reader.getLocationContents(locA.id, tx);
      expect(result.items).toHaveLength(2);
      expect(result.items.map((i) => i.stockState).sort()).toEqual(['DEFECTIVE', 'ON_HAND']);
    });
  });
});
