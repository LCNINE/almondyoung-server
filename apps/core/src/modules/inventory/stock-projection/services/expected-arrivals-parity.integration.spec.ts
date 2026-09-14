import { randomUUID } from 'node:crypto';
import * as postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbService } from '@app/db';
import { makeDb } from '../../../fulfillment/services/__support__';
import { RESTOCK_SQL } from '../../../../../../channel-adapter/scripts/sync-restock-to-medusa';
import { PurchaseOrderReader } from '../../procurement/services/purchase-order.reader';
import { PurchaseOrderExpectedArrivalReader } from '../../procurement/services/purchase-order-expected-arrival.reader';
import { WarehouseTransferReader } from '../../warehouse-transfer/services/warehouse-transfer.reader';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { ExpectedArrivalsReader } from './expected-arrivals.reader';
import { InboundPipelineReader } from './inbound-pipeline.reader';

/**
 * 읽기 파리티(스펙 §12 #8) + 스토어프론트 동기화 SQL 실행(#12).
 * 입고 대기 잔량 = VIEW inbound_pending_qty = 파이프라인 ①(비판매 출발 창고)·전사 합계 = 헤더 도착예정일.
 * 실행: DATABASE_URL=... npx jest --runInBand expected-arrivals-parity
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('입고예정 읽기 파리티 (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });

  afterAll(async () => {
    await client.end();
  });

  async function inRollback(fn: (trx: DbTx) => Promise<void>): Promise<void> {
    await db
      .transaction(async (trx) => {
        await fn(trx as unknown as DbTx);
        throw new Rollback();
      })
      .catch((error) => {
        if (!(error instanceof Rollback)) throw error;
      });
  }

  function boundDbService(trx: DbTx): DbService<typeof wmsSchema> {
    // 테스트 fixture와 조회를 같은 rollback tx에 묶기 위한 DbService 대역이다.
    return {
      db,
      run: <T>(fn: (current: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
  }

  async function readViewQty(trx: DbTx, skuId: string, warehouseId: string): Promise<number> {
    const rows = (await trx.execute(sql`
      SELECT inbound_pending_qty
        FROM stock_summary_view
       WHERE sku_id = ${skuId} AND warehouse_id = ${warehouseId}
    `)) as unknown as Array<{ inbound_pending_qty: number | string }>;
    return Number(rows[0]?.inbound_pending_qty ?? 0);
  }

  async function seedFixture(trx: DbTx) {
    const holderId = randomUUID();
    const supplierId = randomUUID();
    const nonSellableWarehouseId = randomUUID();
    const sellableWarehouseId = randomUUID();
    const skuA = randomUUID();
    const skuB = randomUUID();
    const skuCodeA = `T7-A-${randomUUID()}`;
    const skuCodeB = `T7-B-${randomUUID()}`;

    await trx.insert(wmsTables.holders).values({ id: holderId, name: 'T7 holder' });
    await trx.insert(wmsTables.warehouses).values([
      { id: nonSellableWarehouseId, name: 'T7 중국', type: 'overseas', isSellable: false },
      { id: sellableWarehouseId, name: 'T7 부천', type: 'domestic', isSellable: true },
    ]);
    await trx.insert(wmsTables.suppliers).values({ id: supplierId, name: 'T7 공급처' });
    await trx.insert(wmsTables.skus).values([
      { id: skuA, holderId, name: 'T7 SKU A', code: skuCodeA },
      { id: skuB, holderId, name: 'T7 SKU B', code: skuCodeB },
    ]);

    const [foreignPo, domesticPo, cancelledPo, closedPo] = await trx
      .insert(wmsTables.purchaseOrders)
      .values([
        {
          type: 'foreign',
          supplierId,
          status: 'confirmed',
          sourceWarehouseId: nonSellableWarehouseId,
          destinationWarehouseId: sellableWarehouseId,
          requiresTransfer: true,
        },
        {
          type: 'domestic',
          supplierId,
          status: 'confirmed',
          sourceWarehouseId: sellableWarehouseId,
          destinationWarehouseId: sellableWarehouseId,
        },
        {
          type: 'foreign',
          supplierId,
          status: 'cancelled',
          sourceWarehouseId: nonSellableWarehouseId,
          destinationWarehouseId: sellableWarehouseId,
          requiresTransfer: true,
          cancelledReason: '통합 테스트',
          cancelledAt: new Date(),
        },
        {
          type: 'domestic',
          supplierId,
          status: 'confirmed',
          sourceWarehouseId: sellableWarehouseId,
          destinationWarehouseId: sellableWarehouseId,
        },
      ])
      .returning({ id: wmsTables.purchaseOrders.id });

    await trx.insert(wmsTables.purchaseOrderLines).values([
      {
        poId: foreignPo.id,
        skuId: skuA,
        quantity: 10,
        status: 'ordered',
        orderedQty: 10,
        receivedQty: 0,
        expectedArrival: '2026-09-20',
      },
      {
        poId: foreignPo.id,
        skuId: skuB,
        quantity: 5,
        status: 'ordered',
        orderedQty: 5,
        receivedQty: 2,
        expectedArrival: '2026-09-15',
      },
      {
        poId: domesticPo.id,
        skuId: skuA,
        quantity: 7,
        status: 'ordered',
        orderedQty: 7,
        receivedQty: 0,
        expectedArrival: '2026-09-18',
      },
      {
        poId: cancelledPo.id,
        skuId: skuA,
        quantity: 3,
        status: 'ordered',
        orderedQty: 3,
        receivedQty: 0,
        expectedArrival: '2026-09-02',
      },
      {
        poId: closedPo.id,
        skuId: skuA,
        quantity: 4,
        status: 'ordered',
        orderedQty: 4,
        receivedQty: 0,
        expectedArrival: '2026-09-01',
        closedAt: new Date(),
        closedReason: '잔량 포기',
      },
    ]);

    return {
      supplierId,
      nonSellableWarehouseId,
      sellableWarehouseId,
      skuA,
      skuB,
      skuCodeA,
      skuCodeB,
      foreignPoId: foreignPo.id,
    };
  }

  it('창고별 입고 대기 = VIEW inbound_pending_qty', async () => {
    await inRollback(async (trx) => {
      const fx = await seedFixture(trx);
      const purchaseOrders = new PurchaseOrderExpectedArrivalReader(boundDbService(trx));
      const result = await new ExpectedArrivalsReader(purchaseOrders).listByWarehouse(fx.nonSellableWarehouseId, trx);
      const expectedLines = [
        {
          skuId: fx.skuA,
          skuName: 'T7 SKU A',
          skuCode: fx.skuCodeA,
          orderedQty: 10,
          receivedQty: 0,
          outstandingQty: 10,
          expectedArrival: '2026-09-20',
        },
        {
          skuId: fx.skuB,
          skuName: 'T7 SKU B',
          skuCode: fx.skuCodeB,
          orderedQty: 5,
          receivedQty: 2,
          outstandingQty: 3,
          expectedArrival: '2026-09-15',
        },
      ].sort((left, right) => left.skuId.localeCompare(right.skuId));

      expect(result).toEqual({
        warehouseId: fx.nonSellableWarehouseId,
        totalDocuments: 1,
        totalOutstandingQuantity: 13,
        arrivals: [
          {
            source: 'purchase_order',
            documentId: fx.foreignPoId,
            type: 'foreign',
            supplier: { id: fx.supplierId, name: 'T7 공급처' },
            expectedDate: '2026-09-15',
            totalOutstandingQuantity: 13,
            lines: expectedLines,
          },
        ],
      });
      expect(await readViewQty(trx, fx.skuA, fx.nonSellableWarehouseId)).toBe(10);
      expect(await readViewQty(trx, fx.skuB, fx.nonSellableWarehouseId)).toBe(3);
      expect(await readViewQty(trx, fx.skuA, fx.sellableWarehouseId)).toBe(7);
    });
  });

  it('파이프라인 ① = 비판매 출발 창고 남은 수량, 전사 = 창고 불문 합', async () => {
    await inRollback(async (trx) => {
      const fx = await seedFixture(trx);
      const dbService = boundDbService(trx);
      const purchaseOrders = new PurchaseOrderExpectedArrivalReader(dbService);
      const pipeline = new InboundPipelineReader(dbService, new WarehouseTransferReader(dbService), purchaseOrders);
      const rows = await pipeline.read(trx, {
        skuIds: [fx.skuA, fx.skuB],
        toWarehouseId: fx.sellableWarehouseId,
      });

      expect(rows).toEqual([
        expect.objectContaining({
          skuId: fx.skuA,
          onOrderQty: 10,
          onOrderEta: new Date('2026-09-20'),
          onOrderTotalQty: 17,
        }),
        expect.objectContaining({
          skuId: fx.skuB,
          onOrderQty: 3,
          onOrderEta: new Date('2026-09-15'),
          onOrderTotalQty: 3,
        }),
      ]);
    });
  });

  it('헤더 도착예정일 = 목록의 expectedDate (남은 수량 있는 라인의 MIN)', async () => {
    await inRollback(async (trx) => {
      const fx = await seedFixture(trx);
      const dbService = boundDbService(trx);
      const list = await new PurchaseOrderExpectedArrivalReader(dbService).listByWarehouse(
        fx.nonSellableWarehouseId,
        trx,
      );
      const header = await new PurchaseOrderReader(dbService).findById(fx.foreignPoId, trx);

      expect(header.expectedArrival).toEqual(new Date('2026-09-15T00:00:00.000Z'));
      expect(list[0].expectedDate).toBe(header.expectedArrival?.toISOString().slice(0, 10));
    });
  });

  it('취소된 발주의 ordered 라인은 어디에도 잡히지 않는다', async () => {
    await inRollback(async (trx) => {
      const fx = await seedFixture(trx);
      const dbService = boundDbService(trx);
      const purchaseOrders = new PurchaseOrderExpectedArrivalReader(dbService);

      expect((await purchaseOrders.listByWarehouse(fx.nonSellableWarehouseId, trx))[0].totalOutstandingQuantity).toBe(
        13,
      );
      expect((await purchaseOrders.sumOutstandingBySku([fx.skuA], 'all', trx)).get(fx.skuA)?.qty).toBe(17);
      expect(await readViewQty(trx, fx.skuA, fx.nonSellableWarehouseId)).toBe(10);
    });
  });

  it('#12 스토어프론트 동기화 SQL은 실제 상품 조인에서 ETA와 해외 여부를 내고 닫힘·취소를 제외한다', async () => {
    await inRollback(async (trx) => {
      const fx = await seedFixture(trx);
      const masterId = randomUUID();
      const versionId = randomUUID();
      const variantA = randomUUID();
      const variantB = randomUUID();
      const matchingA = randomUUID();
      const matchingB = randomUUID();

      await trx.execute(sql`INSERT INTO product_masters (id) VALUES (${masterId})`);
      await trx.execute(sql`
        INSERT INTO product_master_versions (id, master_id, name, status)
        VALUES (${versionId}, ${masterId}, 'T7 상품', 'active')
      `);
      await trx.execute(sql`INSERT INTO product_variants (id) VALUES (${variantA}), (${variantB})`);
      await trx.execute(sql`
        INSERT INTO product_master_variants (id, master_id, variant_id, version_id)
        VALUES (${randomUUID()}, ${masterId}, ${variantA}, ${versionId}),
               (${randomUUID()}, ${masterId}, ${variantB}, ${versionId})
      `);
      await trx.insert(wmsTables.productMatchings).values([
        { id: matchingA, variantId: variantA, masterId, status: 'matched', strategy: 'variant', isResolved: true },
        { id: matchingB, variantId: variantB, masterId, status: 'matched', strategy: 'variant', isResolved: true },
      ]);
      await trx.insert(wmsTables.productVariantSkuLinks).values([
        { productMatchingId: matchingA, skuId: fx.skuA },
        { productMatchingId: matchingB, skuId: fx.skuB },
      ]);

      const rows = (await trx.execute(sql.raw(RESTOCK_SQL))) as unknown as Array<{
        master_id: string;
        variant_id: string;
        expected_date: string;
        approximate: boolean;
      }>;

      const expected = [
        { master_id: masterId, variant_id: variantA, expected_date: '2026-09-18', approximate: true },
        { master_id: masterId, variant_id: variantB, expected_date: '2026-09-15', approximate: true },
      ];
      expect([...rows].sort((left, right) => left.variant_id.localeCompare(right.variant_id))).toEqual(
        expected.sort((left, right) => left.variant_id.localeCompare(right.variant_id)),
      );
    });
  });
});
