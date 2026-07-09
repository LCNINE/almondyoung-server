import { eq, and } from 'drizzle-orm';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { randomUUID } from 'crypto';
import { ConflictError } from '@app/shared';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { StockEventStore } from '../repositories/stock-event.store';
import { InventoryCommandService } from './inventory-command.service';
import { LocationService } from './location.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';
import { InventoryIdempotencyService } from './inventory-idempotency.service';
import { SkuCatalogReader } from '../../sku-catalog/services/sku-catalog.reader';
import { SkuCatalogManager } from '../../sku-catalog/services/sku-catalog.manager';
import { SkuCatalogService } from '../../sku-catalog/services/sku-catalog.service';
import { InboundService } from '../../inbound/services/inbound.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('inventory idempotency (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let inbound: InboundService;
  let idempotency: InventoryIdempotencyService;

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
    const skuReader = new SkuCatalogReader(dbService);
    const skuManager = new SkuCatalogManager(dbService, skuReader);
    const skuCatalog = new SkuCatalogService(skuReader, skuManager);
    idempotency = new InventoryIdempotencyService(dbService);
    inbound = new InboundService(dbService, skuCatalog, command, location, eventStore, idempotency);
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

  // 시드: 창고 + holder + SKU 생성 (재고는 각 케이스가 필요에 맞게 스스로 입고)
  async function seed(tx: DbTx) {
    const [wh] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `it-wh-${randomUUID().slice(0, 8)}` })
      .returning();
    const [h] = await tx
      .insert(wmsTables.holders)
      .values({ name: `it-h-${randomUUID().slice(0, 8)}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'it-sku', code: `IT-${randomUUID()}`, holderId: h.id })
      .returning();
    return { wh, sku };
  }

  it('simpleInbound 같은 키 2회 → 두 응답 deep-equal, stock_events 1건, inbound_receipts 1건', async () => {
    await inRollbackTx(async (tx) => {
      const { wh, sku } = await seed(tx);
      const dto = {
        warehouseId: wh.id,
        items: [{ skuId: sku.id, quantity: 5 }],
        idempotencyKey: randomUUID(),
      };

      const r1 = await inbound.simpleInbound(dto, tx);
      const r2 = await inbound.simpleInbound(dto, tx);
      expect(r2).toEqual(r1);

      const events = await tx.select().from(wmsTables.stockEvents).where(eq(wmsTables.stockEvents.skuId, sku.id));
      expect(events).toHaveLength(1);

      const receipts = await tx
        .select()
        .from(wmsTables.inboundReceipts)
        .where(eq(wmsTables.inboundReceipts.warehouseId, wh.id));
      expect(receipts).toHaveLength(1);
    });
  });

  it('returnInbound 같은 키 2회 → returnedQty 1회만 증가', async () => {
    await inRollbackTx(async (tx) => {
      const { wh, sku } = await seed(tx);
      // 회송 대상 라인 준비: 별도 키로 먼저 정상 입고
      const receiptDto = {
        warehouseId: wh.id,
        items: [{ skuId: sku.id, quantity: 10 }],
        idempotencyKey: randomUUID(),
      };
      const { lines } = await inbound.simpleInbound(receiptDto, tx);
      const line = lines[0];

      const returnDto = { lineId: line.id, quantity: 3, idempotencyKey: randomUUID() };
      const r1 = await inbound.returnInbound(returnDto, tx);
      const r2 = await inbound.returnInbound(returnDto, tx);
      expect(r2).toEqual(r1);

      const [updatedLine] = await tx
        .select()
        .from(wmsTables.inboundReceiptLines)
        .where(eq(wmsTables.inboundReceiptLines.id, line.id));
      expect(updatedLine.returnedQty).toBe(3); // 6이 아니라 3 — 두 번째 호출은 replay
    });
  });

  it('같은 키 + 다른 본문 → ConflictError', async () => {
    await inRollbackTx(async (tx) => {
      const { wh, sku } = await seed(tx);
      const key = randomUUID();
      const dto1 = { warehouseId: wh.id, items: [{ skuId: sku.id, quantity: 5 }], idempotencyKey: key };
      const dto2 = { warehouseId: wh.id, items: [{ skuId: sku.id, quantity: 7 }], idempotencyKey: key };

      await inbound.simpleInbound(dto1, tx);
      await expect(inbound.simpleInbound(dto2, tx)).rejects.toThrow(ConflictError);
    });
  });

  // moveImmediately(MovementService) 는 tx 파라미터가 없어 rollback-tx 하네스로 같은 tx 2회 호출을 만들 수 없다
  // (내부적으로 dbService.run 이 own transaction 을 새로 연다 — 브리프 케이스 4 주석 참조).
  // MovementService 의 배선(엔드포인트 'movement.move' 로 withIdempotency 호출)은
  // movement.service.idempotency.spec.ts 단위 스펙으로 이미 검증됨.
  // 여기서는 moveImmediately 가 실제로 위임하는 InventoryIdempotencyService.withIdempotency 자체를
  // 같은 endpoint('movement.move')로 같은 tx 안에서 2회 호출해, 래퍼의 DB-레벨 replay 동작을 검증한다.
  it('movement.move 엔드포인트 키 2회 → 두 번째는 저장된 응답 replay (핸들러 재실행 없음)', async () => {
    await inRollbackTx(async (tx) => {
      const key = randomUUID();
      const dto = {
        lines: [{ skuId: randomUUID(), fromLocationId: randomUUID(), toLocationId: randomUUID(), quantity: 1 }],
        idempotencyKey: key,
      };
      let handlerCalls = 0;
      const handler = (): Promise<{ jobId: string }> => {
        handlerCalls += 1;
        return Promise.resolve({ jobId: `job-${handlerCalls}` });
      };

      const r1 = await idempotency.withIdempotency('movement.move', key, dto, handler, tx);
      const r2 = await idempotency.withIdempotency('movement.move', key, dto, handler, tx);

      expect(handlerCalls).toBe(1); // 두 번째 호출은 handler 를 재실행하지 않음
      expect(r2).toEqual(r1);

      const rows = await tx
        .select()
        .from(wmsTables.inventoryIdempotencyRequests)
        .where(
          and(
            eq(wmsTables.inventoryIdempotencyRequests.endpoint, 'movement.move'),
            eq(wmsTables.inventoryIdempotencyRequests.key, key),
          ),
        );
      expect(rows).toHaveLength(1);
      expect(rows[0].response).toEqual(r1);
    });
  });
});
