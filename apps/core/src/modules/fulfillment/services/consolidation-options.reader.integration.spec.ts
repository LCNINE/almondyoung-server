import { NotFoundError } from '@app/shared';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  CONSOLIDATION_RECIPIENT,
  ConsolidationRecipient,
  consolidationBase,
  createConsolidationSource,
  inRollbackTx,
  makeDb,
  makeDbService,
  seedWarehouseWithZone,
  wireLogistics,
  Wired,
} from './__support__';
import { canonicalFulfillmentRequestHash } from './fulfillment-command.service';
import { ConsolidationOptionsReader } from './consolidation-options.reader';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('ConsolidationOptionsReader (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let wired: Wired;
  let reader: ConsolidationOptionsReader;

  beforeAll(() => {
    if (!DATABASE_URL) {
      throw new Error('DATABASE_URL is required');
    }

    ({ sql: client, db } = makeDb(DATABASE_URL));
    const dbService = makeDbService(db);

    wired = wireLogistics(dbService, 'v2');
    reader = new ConsolidationOptionsReader(dbService);
  });

  afterAll(async () => {
    await client.end();
  });

  const setStatus = (tx: DbTx, shipmentId: string, status: 'planned' | 'shipped') =>
    tx.update(wmsTables.shipments).set({ status }).where(eq(wmsTables.shipments.id, shipmentId));

  it('같은 고객의 같은 창고 상자를 막힌 것까지 사유와 함께 돌려준다', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx);
      const customerId = randomUUID();
      const make = (recipient: ConsolidationRecipient = CONSOLIDATION_RECIPIENT, owner = customerId, b = base) =>
        createConsolidationSource(tx, wired, b, { quantity: 1, customerId: owner, recipient });

      const source = await make();

      await setStatus(tx, source.shipment.id, 'planned');
      const [batch] = await tx
        .insert(wmsTables.outboundBatches)
        .values({
          batchNumber: `consolidation-options-${randomUUID()}`,
          warehouseId: base.warehouseId,
          pickingMethod: 'individual',
        })
        .returning();

      await tx.insert(wmsTables.outboundBatchWorkItems).values({ batchId: batch.id, shipmentId: source.shipment.id });
      const trackingNo = `consolidation-options-${randomUUID()}`;

      await tx.insert(wmsTables.waybills).values({
        shipmentId: source.shipment.id,
        source: 'manual',
        carrier: 'HANJIN',
        status: 'registered',
        trackingNo,
        manifestVersion: source.shipment.manifestVersion,
        recipientHash: canonicalFulfillmentRequestHash(source.shipment.recipientSnapshot),
      });

      const same = await make();
      const memo = await make({ ...CONSOLIDATION_RECIPIENT, deliveryNote: '문 앞에 놔 주세요' });
      const addr = await make({ ...CONSOLIDATION_RECIPIENT, roadAddress: 'Seoul other road 9' });

      await setStatus(tx, addr.shipment.id, 'planned');

      const otherCustomer = await make(CONSOLIDATION_RECIPIENT, randomUUID());
      const shipped = await make();

      await setStatus(tx, shipped.shipment.id, 'shipped');

      const { warehouseId: otherWarehouseId, locationId } = await seedWarehouseWithZone(tx);

      await tx.insert(wmsTables.stockLedgers).values({
        skuId: base.skuId,
        warehouseId: otherWarehouseId,
        locationId,
        stockState: 'ON_HAND',
        qty: 100,
      });
      const otherWarehouse = await make(CONSOLIDATION_RECIPIENT, customerId, {
        ...base,
        warehouseId: otherWarehouseId,
      });

      const res = await reader.findOptions(source.shipment.id, tx);

      expect(res.source).toMatchObject({
        shipmentId: source.shipment.id,
        status: 'planned',
        batchId: batch.id,
        waybillTrackingNo: trackingNo,
        totalQty: 1,
        manifestVersion: source.shipment.manifestVersion,
        reservationVersion: source.shipment.reservationVersion,
      });
      expect(res.source.salesOrderNos).toHaveLength(1);
      expect(res.source.itemSummary).not.toBe('');
      expect(res.options.map((o) => [o.shipmentId, o.reason, o.selectable])).toEqual(
        expect.arrayContaining([
          [same.shipment.id, 'ok', true],
          [memo.shipment.id, 'memo_differs', true],
          [addr.shipment.id, 'address_differs', false],
        ]),
      );
      expect(res.options).toHaveLength(3);
      const ids = res.options.map((o) => o.shipmentId);

      for (const excluded of [otherCustomer, shipped, otherWarehouse, source]) {
        expect(ids).not.toContain(excluded.shipment.id);
      }

      const sameOption = res.options.find((o) => o.shipmentId === same.shipment.id);

      expect(sameOption).toMatchObject({ status: 'draft', batchId: null, waybillTrackingNo: null });
    });
  });

  it('비회원 주문은 정규화한 이름과 전화가 같은 상자만 고른다', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx);
      const phone = `010-${randomUUID().replace(/\D/g, '').slice(0, 8)}`;
      const guest = async (customerName: string, customerPhone: string) => {
        const fixture = await createConsolidationSource(tx, wired, base, { quantity: 1, customerId: randomUUID() });

        await tx
          .update(wmsTables.salesOrders)
          .set({ customerId: null, customerName, customerPhone })
          .where(eq(wmsTables.salesOrders.id, fixture.salesOrderId));

        return fixture;
      };

      const source = await guest('Guest Kim', phone);
      const sameGuest = await guest('  guest   KIM ', phone.replace(/-/g, ''));
      const otherGuest = await guest('Guest Park', phone);

      const res = await reader.findOptions(source.shipment.id, tx);

      expect(res.options.map((o) => [o.shipmentId, o.reason])).toEqual([[sameGuest.shipment.id, 'ok']]);
      expect(res.options.map((o) => o.shipmentId)).not.toContain(otherGuest.shipment.id);
    });
  });

  it('없는 상자면 NotFound 를 던진다', async () => {
    await inRollbackTx(db, async (tx) => {
      await expect(reader.findOptions(randomUUID(), tx)).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
