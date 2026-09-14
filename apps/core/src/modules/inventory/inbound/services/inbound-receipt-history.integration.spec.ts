import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { InboundReceiptHistoryResponseDto } from '../dto/inbound-response.dto';
import { Database, inRollbackTx, makeInboundService } from './__fixtures__/inbound-harness';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/**
 * GET /inbound/receipts 의 회차별 계약. 페이지와 total 은 헤더 단위이고 SKU 필터는 회차를 고른 뒤
 * 그 회차의 전체 라인을 돌려준다. 전달받은 tx 안의 미커밋 행으로 검증하여 tx 전파도 함께 고정한다.
 *
 * 실행: DATABASE_URL=... npx jest --runInBand --testPathPattern=inbound-receipt-history
 */
describeIfDb('InboundService.listInboundReceipts 회차별 이력 (PostgreSQL integration)', () => {
  jest.setTimeout(120_000);

  let client: postgres.Sql;
  let db: Database;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 2 });
    db = drizzle(client, { schema: wmsSchema });
  });

  afterAll(async () => {
    await client.end();
  });

  async function seedHistory(tx: DbTx) {
    const suffix = randomUUID();
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `receipt-history-wh-${suffix.slice(0, 8)}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `receipt-history-holder-${suffix.slice(0, 8)}` })
      .returning();
    const [skuA, skuB] = await tx
      .insert(wmsTables.skus)
      .values([
        { name: 'history sku A', code: `HISTORY-A-${suffix}`, holderId: holder.id },
        { name: 'history sku B', code: `HISTORY-B-${suffix}`, holderId: holder.id },
      ])
      .returning();
    const [newest, older, voided] = await tx
      .insert(wmsTables.inboundReceipts)
      .values([
        {
          method: 'planned',
          warehouseId: warehouse.id,
          occurredAt: new Date('2026-09-13T00:00:00.000Z'),
          status: 'posted',
          totalQuantity: 10,
        },
        {
          method: 'simple',
          warehouseId: warehouse.id,
          occurredAt: new Date('2026-09-12T00:00:00.000Z'),
          status: 'posted',
          totalQuantity: 3,
        },
        {
          method: 'individual',
          warehouseId: warehouse.id,
          occurredAt: new Date('2026-09-14T00:00:00.000Z'),
          status: 'voided',
          totalQuantity: 0,
        },
      ])
      .returning();
    const [newestA, newestB, olderA] = await tx
      .insert(wmsTables.inboundReceiptLines)
      .values([
        {
          receiptId: newest.id,
          skuId: skuA.id,
          quantity: 4,
          source: 'purchase_order',
          canceledQty: 1,
          returnedQty: 2,
          putawayFromOriginQty: 1,
        },
        {
          receiptId: newest.id,
          skuId: skuB.id,
          quantity: 6,
          source: 'purchase_order',
          canceledQty: 0,
          returnedQty: 1,
          putawayFromOriginQty: 3,
        },
        {
          receiptId: older.id,
          skuId: skuA.id,
          quantity: 3,
          source: 'direct',
        },
      ])
      .returning();

    return { warehouse, skuA, skuB, newest, older, voided, newestA, newestB, olderA };
  }

  it('헤더 단위 total/page를 반환하고 voided를 제외하며 실제 ID/source/counter를 싣는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedHistory(tx);
      const service = makeInboundService(db);

      const page: InboundReceiptHistoryResponseDto = await service.listInboundReceipts(
        { warehouseId: fixture.warehouse.id, limit: 1, offset: 1 },
        tx,
      );

      expect(page.total).toBe(2);
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({
        id: fixture.older.id,
        status: 'posted',
        method: 'simple',
        totalQuantity: 3,
        lines: [
          {
            id: fixture.olderA.id,
            receiptId: fixture.older.id,
            skuId: fixture.skuA.id,
            source: 'direct',
            quantity: 3,
            canceledQty: 0,
            returnedQty: 0,
            putawayFromOriginQty: 0,
          },
        ],
      });

      const filtered = await service.listInboundReceipts(
        {
          warehouseId: fixture.warehouse.id,
          method: 'planned',
          startDate: '2026-09-13',
          endDate: '2026-09-13',
        },
        tx,
      );
      expect(filtered).toMatchObject({ total: 1, items: [{ id: fixture.newest.id, status: 'posted' }] });
    });
  });

  it('SKU 필터는 포함 회차를 고른 뒤 그 회차의 전체 라인을 반환한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedHistory(tx);
      const service = makeInboundService(db);

      const result: InboundReceiptHistoryResponseDto = await service.listInboundReceipts(
        { skuId: fixture.skuB.id, warehouseId: fixture.warehouse.id },
        tx,
      );

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.id).toBe(fixture.newest.id);
      expect(result.items[0]?.lines).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: fixture.newestA.id,
            skuId: fixture.skuA.id,
            source: 'purchase_order',
            quantity: 4,
            canceledQty: 1,
            returnedQty: 2,
            putawayFromOriginQty: 1,
          }),
          expect.objectContaining({
            id: fixture.newestB.id,
            skuId: fixture.skuB.id,
            source: 'purchase_order',
            quantity: 6,
            canceledQty: 0,
            returnedQty: 1,
            putawayFromOriginQty: 3,
          }),
        ]),
      );
    });
  });
});
