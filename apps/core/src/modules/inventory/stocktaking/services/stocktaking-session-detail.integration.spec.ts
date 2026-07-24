import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql as dsql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { NotFoundError } from '@app/shared';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { StocktakingService } from './stocktaking.service';
import { InventoryCommandService } from '../../core/services/inventory-command.service';
import { LocationService } from '../../core/services/location.service';
import { StockEventStore } from '../../core/repositories/stock-event.store';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('stocktaking session detail (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let svc: StocktakingService;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: wmsSchema });
    const dbService = {
      db,
      run: async (fn: (t: DbTx) => Promise<unknown>, t?: DbTx) => (t ? fn(t) : db.transaction(fn)),
    } as unknown as DbService<typeof wmsSchema>;
    const outbox = new OutboxService(dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, outbox);
    const eventStore = new StockEventStore(dbService, sellable);
    const location = new LocationService(dbService);
    const command = new InventoryCommandService(dbService, eventStore, outbox, location);
    svc = new StocktakingService(dbService, command);
  });
  afterAll(async () => {
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

  async function seed(tx: DbTx) {
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `it-wh-${randomUUID().slice(0, 8)}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `it-h-${randomUUID().slice(0, 8)}` })
      .returning();
    const [skuB] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'sku-b', code: `IT-B-${randomUUID()}`, holderId: holder.id })
      .returning();
    const [skuA] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'sku-a', code: `IT-A-${randomUUID()}`, holderId: holder.id })
      .returning();
    const [loc] = await tx
      .insert(wmsTables.locations)
      .values({ warehouseId: warehouse.id, code: `IT-LOC-${randomUUID().slice(0, 8)}`, locationType: 'zone' })
      .returning();
    const [session] = await tx
      .insert(wmsTables.stocktakingSessions)
      .values({ warehouseId: warehouse.id, sessionName: 'it-session', status: 'in_progress' })
      .returning();
    await tx.insert(wmsTables.stocktakingLines).values([
      {
        sessionId: session.id,
        skuId: skuB.id,
        locationId: loc.id,
        expectedQuantity: 4,
        countedQuantity: 4,
        variance: 0,
        status: 'counted',
      },
      {
        sessionId: session.id,
        skuId: skuA.id,
        locationId: loc.id,
        expectedQuantity: 9,
        status: 'pending',
      },
    ]);
    return { warehouse, session, loc, skuA, skuB };
  }

  it('세션 메타 + 라인 전체 + 진행률을 반환한다', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, session, loc } = await seed(tx);

      const detail = await svc.getSession(session.id, tx);

      expect(detail.id).toBe(session.id);
      expect(detail.warehouseId).toBe(warehouse.id);
      expect(detail.sessionName).toBe('it-session');
      expect(detail.status).toBe('in_progress');
      expect(detail.lines).toHaveLength(2);
      expect(detail.lines[0].locationCode).toBe(loc.code);
      // progress.counted = countedQuantity IS NOT NULL 인 라인 수
      expect(detail.progress).toEqual({ total: 2, counted: 1 });
    });
  });

  it('라인을 locationCode → skuCode 순으로 정렬한다', async () => {
    await inRollbackTx(async (tx) => {
      // seed()는 skuB 라인을 skuA 라인보다 먼저 삽입한다(기대 출력 순서와 반대).
      const { session, skuA, skuB } = await seed(tx);

      // 삽입 순서 역전만으로는 이 정렬 키 누락을 못 잡는다: 기본 플래너가
      // (session_id) 등 인덱스의 Index Scan 이나 Hash Join 경로를 타면 skuCode
      // ORDER BY 항을 지워도 "우연히" 기대 순서와 같게 나올 수 있다(직접 3회
      // 반복 실행으로 확인 — skuCode 를 지운 orderBy 는 3회 중 1회만 실패했다).
      // 인덱스/해시/머지 경로를 꺼서 Nested Loop + Seq Scan 을 강제해야 정렬 키가
      // 실제로 하는 일(삽입 순서를 뒤엎는 것)이 결정적으로 드러난다.
      await tx.execute(dsql`SET LOCAL enable_indexscan = off`);
      await tx.execute(dsql`SET LOCAL enable_bitmapscan = off`);
      await tx.execute(dsql`SET LOCAL enable_indexonlyscan = off`);
      await tx.execute(dsql`SET LOCAL enable_hashjoin = off`);
      await tx.execute(dsql`SET LOCAL enable_mergejoin = off`);

      const detail = await svc.getSession(session.id, tx);

      // 같은 로케이션이므로 skuCode(IT-A… < IT-B…) 순
      expect(detail.lines.map((l) => l.skuId)).toEqual([skuA.id, skuB.id]);
    });
  });

  it('미카운트 라인의 countedQuantity/variance 는 null 로 남는다', async () => {
    await inRollbackTx(async (tx) => {
      const { session, skuA } = await seed(tx);

      const detail = await svc.getSession(session.id, tx);
      const pending = detail.lines.find((l) => l.skuId === skuA.id);

      expect(pending?.countedQuantity).toBeNull();
      expect(pending?.variance).toBeNull();
      expect(pending?.status).toBe('pending');
    });
  });

  it('없는 세션은 NotFoundError 를 던진다', async () => {
    await inRollbackTx(async (tx) => {
      await expect(svc.getSession(randomUUID(), tx)).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
