import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { InboundReceiptHistoryResponseDto } from '../dto/inbound-response.dto';
import { Database, inRollbackTx, makeInboundReceiptKernel, makeInboundService } from './__fixtures__/inbound-harness';

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
            skuCode: fixture.skuA.code,
            skuName: fixture.skuA.name,
            originLocationCode: null,
            source: 'direct',
            quantity: 3,
            canceledQty: 0,
            returnedQty: 0,
            putawayFromOriginQty: 0,
            canCancel: false,
            cancelBlockReason: 'MISSING_ORIGIN_OR_EVENT',
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

  it('status 기본값은 posted이고 all/voided는 total과 items에 같은 조건을 쓴다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedHistory(tx);
      const service = makeInboundService(db);

      const posted = await service.listInboundReceipts({ warehouseId: fixture.warehouse.id }, tx);
      expect(posted.total).toBe(2);
      expect(posted.items).toHaveLength(2);
      expect(posted.items.every((item) => item.status === 'posted')).toBe(true);

      const all = await service.listInboundReceipts({ warehouseId: fixture.warehouse.id, status: 'all' }, tx);
      expect(all.total).toBe(3);
      expect(all.items).toHaveLength(3);
      expect(all.items.map((item) => item.id)).toContain(fixture.voided.id);

      const voided = await service.listInboundReceipts(
        {
          warehouseId: fixture.warehouse.id,
          status: 'voided',
        },
        tx,
      );
      expect(voided.total).toBe(1);
      expect(voided.items).toHaveLength(1);
      expect(voided.items[0]?.id).toBe(fixture.voided.id);
      expect(voided.serverTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  it('receiptId 필터는 선택한 warehouseId 범위를 벗어난 회차를 반환하지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedHistory(tx);
      const service = makeInboundService(db);
      const [otherWarehouse] = await tx
        .insert(wmsTables.warehouses)
        .values({ name: `receipt-history-other-${randomUUID().slice(0, 8)}` })
        .returning();

      const matching = await service.listInboundReceipts(
        { warehouseId: fixture.warehouse.id, receiptId: fixture.newest.id },
        tx,
      );
      expect(matching).toMatchObject({ total: 1, items: [{ id: fixture.newest.id }] });

      await expect(service.listInboundReceipts({ receiptId: fixture.newest.id }, tx)).rejects.toThrow(
        'warehouseId is required when filtering by receiptId',
      );

      const wrongWarehouse = await service.listInboundReceipts(
        { warehouseId: otherWarehouse.id, receiptId: fixture.newest.id },
        tx,
      );
      expect(wrongWarehouse).toMatchObject({ total: 0, items: [] });
    });
  });

  it('서울 날짜를 [00:00, 다음날 00:00) 경계로 조회한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const suffix = randomUUID();
      const [warehouse] = await tx
        .insert(wmsTables.warehouses)
        .values({ name: `receipt-history-date-${suffix.slice(0, 8)}` })
        .returning();
      const inserted = await tx
        .insert(wmsTables.inboundReceipts)
        .values([
          { method: 'simple', warehouseId: warehouse.id, occurredAt: new Date('2026-09-14T14:59:59.999Z') },
          { method: 'simple', warehouseId: warehouse.id, occurredAt: new Date('2026-09-14T15:00:00.000Z') },
          { method: 'simple', warehouseId: warehouse.id, occurredAt: new Date('2026-09-15T14:59:59.999Z') },
          { method: 'simple', warehouseId: warehouse.id, occurredAt: new Date('2026-09-15T15:00:00.000Z') },
        ])
        .returning();

      const result = await makeInboundService(db).listInboundReceipts(
        { warehouseId: warehouse.id, startDate: '2026-09-15', endDate: '2026-09-15' },
        tx,
      );

      expect(result.total).toBe(2);
      expect(result.items.map((item) => item.id).sort()).toEqual([inserted[1].id, inserted[2].id].sort());
    });
  });

  it('direct와 purchase_order 라인에 같은 현재 상태 취소 가능 조건과 표시 정보를 붙인다', async () => {
    jest.useFakeTimers({
      doNotFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'setImmediate',
        'clearImmediate',
        'nextTick',
        'queueMicrotask',
        'performance',
        'hrtime',
      ],
    });
    jest.setSystemTime(new Date('2026-09-15T01:00:00.000Z'));

    try {
      await inRollbackTx(db, async (tx) => {
        const suffix = randomUUID();
        const [warehouse] = await tx
          .insert(wmsTables.warehouses)
          .values({ name: `receipt-history-eligible-${suffix.slice(0, 8)}` })
          .returning();
        const [holder] = await tx
          .insert(wmsTables.holders)
          .values({ name: `receipt-history-eligible-holder-${suffix.slice(0, 8)}` })
          .returning();
        const [directSku, purchaseSku] = await tx
          .insert(wmsTables.skus)
          .values([
            { name: 'eligible direct', code: `ELIGIBLE-D-${suffix}`, holderId: holder.id },
            { name: 'eligible purchase', code: `ELIGIBLE-P-${suffix}`, holderId: holder.id },
          ])
          .returning();
        const service = makeInboundService(db);
        const direct = await service.simpleInbound(
          {
            warehouseId: warehouse.id,
            items: [{ skuId: directSku.id, quantity: 4 }],
            idempotencyKey: randomUUID(),
          },
          tx,
        );
        const purchase = await makeInboundReceiptKernel(db).recordArrival(
          {
            source: 'purchase_order',
            warehouseId: warehouse.id,
            reason: 'planned_inbound',
            lines: [{ skuId: purchaseSku.id, quantity: 5, eventKey: randomUUID() }],
          },
          tx,
        );

        const result = await service.listInboundReceipts({ warehouseId: warehouse.id }, tx);
        const lines = result.items.flatMap((item) => item.lines);
        expect(lines).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: direct.lines[0].id,
              source: 'direct',
              skuCode: directSku.code,
              skuName: 'eligible direct',
              pendingQty: 4,
              canPutaway: true,
              putawayBlockReason: null,
              originLocationCode: 'zone-inbound-default',
              canCancel: true,
              cancelBlockReason: null,
            }),
            expect.objectContaining({
              id: purchase.lines[0].id,
              source: 'purchase_order',
              skuCode: purchaseSku.code,
              skuName: 'eligible purchase',
              pendingQty: 5,
              canPutaway: true,
              putawayBlockReason: null,
              originLocationCode: 'zone-inbound-default',
              canCancel: true,
              cancelBlockReason: null,
            }),
          ]),
        );

        const readDirectHint = async () => {
          const fresh = await service.listInboundReceipts(
            { warehouseId: warehouse.id, receiptId: direct.receipt.id, status: 'all' },
            tx,
          );
          return fresh.items[0]?.lines[0];
        };

        await tx
          .update(wmsTables.inboundReceiptLines)
          .set({ eventId: null })
          .where(eq(wmsTables.inboundReceiptLines.id, direct.lines[0].id));
        await expect(readDirectHint()).resolves.toMatchObject({
          canCancel: false,
          cancelBlockReason: 'MISSING_ORIGIN_OR_EVENT',
        });

        await tx
          .update(wmsTables.inboundReceiptLines)
          .set({ eventId: direct.lines[0].eventId })
          .where(eq(wmsTables.inboundReceiptLines.id, direct.lines[0].id));
        await tx
          .update(wmsTables.stockLedgers)
          .set({ qty: 3 })
          .where(
            and(
              eq(wmsTables.stockLedgers.skuId, directSku.id),
              eq(wmsTables.stockLedgers.warehouseId, warehouse.id),
              eq(wmsTables.stockLedgers.locationId, direct.lines[0].originLocationId!),
              eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
            ),
          );
        await expect(readDirectHint()).resolves.toMatchObject({
          canCancel: false,
          cancelBlockReason: 'INSUFFICIENT_ORIGIN_STOCK',
        });

        await tx
          .update(wmsTables.stockLedgers)
          .set({ qty: 4 })
          .where(
            and(
              eq(wmsTables.stockLedgers.skuId, directSku.id),
              eq(wmsTables.stockLedgers.warehouseId, warehouse.id),
              eq(wmsTables.stockLedgers.locationId, direct.lines[0].originLocationId!),
              eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
            ),
          );
        await tx
          .update(wmsTables.inboundReceiptLines)
          .set({ putawayFromOriginQty: 1 })
          .where(eq(wmsTables.inboundReceiptLines.id, direct.lines[0].id));
        await expect(readDirectHint()).resolves.toMatchObject({
          canCancel: false,
          cancelBlockReason: 'PUTAWAY_EXISTS',
        });

        await tx
          .update(wmsTables.inboundReceiptLines)
          .set({ putawayFromOriginQty: 0, returnedQty: 1 })
          .where(eq(wmsTables.inboundReceiptLines.id, direct.lines[0].id));
        await expect(readDirectHint()).resolves.toMatchObject({
          canCancel: false,
          cancelBlockReason: 'RETURN_EXISTS',
        });

        await tx
          .update(wmsTables.inboundReceiptLines)
          .set({ returnedQty: 0, canceledQty: 4 })
          .where(eq(wmsTables.inboundReceiptLines.id, direct.lines[0].id));
        await expect(readDirectHint()).resolves.toMatchObject({
          canCancel: false,
          cancelBlockReason: 'ALREADY_CANCELED',
        });

        await tx
          .update(wmsTables.inboundReceiptLines)
          .set({ canceledQty: 0 })
          .where(eq(wmsTables.inboundReceiptLines.id, direct.lines[0].id));
        await tx
          .update(wmsTables.inboundReceipts)
          .set({ occurredAt: new Date('2026-09-14T14:59:59.999Z') })
          .where(eq(wmsTables.inboundReceipts.id, direct.receipt.id));
        await expect(readDirectHint()).resolves.toMatchObject({
          canCancel: false,
          cancelBlockReason: 'NOT_TODAY',
        });
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
