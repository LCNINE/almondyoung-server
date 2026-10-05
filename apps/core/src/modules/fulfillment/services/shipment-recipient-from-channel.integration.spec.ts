import { randomUUID } from 'crypto';
import { ConflictException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { canonicalFulfillmentRequestHash } from './fulfillment-command.service';
import {
  inRollbackTx,
  makeDb,
  makeDbService,
  wireLogistics,
  seedWarehouseWithZone,
  seedHolder,
  seedSku,
  seedMatching,
  receiveStock,
} from './__support__';
import { assembleOutbound } from './__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const actor = { id: '00000000-0000-4000-8000-000000000010', roles: ['master'] };
const ADDRESS = { recipientName: '김', phone: '010-1', postalCode: '12345', roadAddress: '서울', detailAddress: '101' };
const NEXT = { ...ADDRESS, roadAddress: '부산', detailAddress: '202' };

describeIfDb('reviseRecipientFromChannel (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  /** 판매주문 1건 → FO → draft 박스 1개. */
  async function draftBox(tx: DbTx) {
    const w = wireLogistics(makeDbService(db));
    const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const { skuId } = await seedSku(tx, holderId);
    await receiveStock(w.command, tx, { skuId, warehouseId, locationId, quantity: 10 });
    const variantId = randomUUID();
    await seedMatching(tx, { variantId, skuId, quantity: 1 });
    const [so] = await tx
      .insert(wmsTables.salesOrders)
      .values({
        channelOrderId: `IT-${randomUUID().slice(0, 8)}`,
        salesChannel: 'medusa',
        status: 'confirmed',
        shippingAddress: ADDRESS,
        orderDate: new Date(),
      })
      .returning();
    await tx.insert(wmsTables.salesOrderLines).values({
      salesOrderId: so.id,
      variantId,
      productName: 'IT',
      quantity: 1,
      unitPrice: 1000,
      channelOrderItemId: `ci-${randomUUID().slice(0, 8)}`,
    });
    await w.fulfillments.create({ salesOrderId: so.id, warehouseId }, tx);
    const [row] = await tx
      .select({ shipmentId: wmsTables.shipmentLines.shipmentId })
      .from(wmsTables.shipmentLines)
      .innerJoin(wmsTables.fulfillmentOrderItems, eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId))
      .innerJoin(wmsTables.fulfillmentOrders, eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId))
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, so.id))
      .limit(1);
    return { salesOrderId: so.id, shipmentId: row.shipmentId, warehouseId };
  }

  async function codeOf(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
    } catch (error) {
      if (error instanceof ConflictException) {
        const response = error.getResponse();
        if (typeof response === 'object' && response !== null && 'code' in response && typeof response.code === 'string') {
          return response.code;
        }
      }
      throw error;
    }
    throw new Error('expected a conflict');
  }

  it('draft 박스의 수령인을 바꾸고 manifestVersion 을 올리며 recipient_revision 작업을 남긴다', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await draftBox(tx);
      const [before] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipmentId));
      const result = await assembleOutbound(tx).planning.reviseRecipientFromChannel(
        box.shipmentId, box.salesOrderId, NEXT, `k-${randomUUID()}`, actor, tx,
      );
      expect(result).toEqual({ changed: true });
      const [after] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipmentId));
      expect(after.recipientSnapshot).toEqual(NEXT);
      expect(after.manifestVersion).toBe(before.manifestVersion + 1);
      const ops = await tx.select().from(wmsTables.shipmentOperations).where(eq(wmsTables.shipmentOperations.type, 'recipient_revision'));
      expect(ops.some((op) => op.reason === 'CHANNEL_ORDER_MODIFIED' && op.status === 'completed')).toBe(true);
    });
  });

  it('같은 주소면 바꾸지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await draftBox(tx);
      const result = await assembleOutbound(tx).planning.reviseRecipientFromChannel(
        box.shipmentId, box.salesOrderId, ADDRESS, `k-${randomUUID()}`, actor, tx,
      );
      expect(result).toEqual({ changed: false });
    });
  });

  it('배치 밖 planned 박스도 받는다 — 불완전한 새 주소는 거절', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await draftBox(tx);
      await tx.update(wmsTables.shipments).set({ status: 'planned' }).where(eq(wmsTables.shipments.id, box.shipmentId));
      const planning = assembleOutbound(tx).planning;
      await expect(
        planning.reviseRecipientFromChannel(box.shipmentId, box.salesOrderId, NEXT, `k-${randomUUID()}`, actor, tx),
      ).resolves.toEqual({ changed: true });
      expect(
        await codeOf(
          planning.reviseRecipientFromChannel(box.shipmentId, box.salesOrderId, { ...NEXT, detailAddress: '' }, `k-${randomUUID()}`, actor, tx),
        ),
      ).toBe('SHIPMENT_RECIPIENT_INCOMPLETE');
    });
  });

  it('살아 있는 송장이 있으면 SHIPMENT_ACTIVE_INVOICE', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await draftBox(tx);
      const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipmentId));
      await tx.insert(wmsTables.waybills).values({
        shipmentId: box.shipmentId,
        source: 'manual',
        carrier: 'HANJIN',
        status: 'registered',
        trackingNo: `T${Date.now()}`,
        manifestVersion: shipment.manifestVersion,
        recipientHash: canonicalFulfillmentRequestHash(ADDRESS),
      });
      expect(
        await codeOf(
          assembleOutbound(tx).planning.reviseRecipientFromChannel(box.shipmentId, box.salesOrderId, NEXT, `k-${randomUUID()}`, actor, tx),
        ),
      ).toBe('SHIPMENT_ACTIVE_INVOICE');
    });
  });

  it('다른 판매주문의 라인을 실은 박스는 SHIPMENT_CONSOLIDATED', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await draftBox(tx);
      expect(
        await codeOf(
          assembleOutbound(tx).planning.reviseRecipientFromChannel(box.shipmentId, randomUUID(), NEXT, `k-${randomUUID()}`, actor, tx),
        ),
      ).toBe('SHIPMENT_CONSOLIDATED');
    });
  });

  it('shipped 박스는 SHIPMENT_REOPEN_REQUIRED', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await draftBox(tx);
      await tx.update(wmsTables.shipments).set({ status: 'shipped' }).where(eq(wmsTables.shipments.id, box.shipmentId));
      expect(
        await codeOf(
          assembleOutbound(tx).planning.reviseRecipientFromChannel(box.shipmentId, box.salesOrderId, NEXT, `k-${randomUUID()}`, actor, tx),
        ),
      ).toBe('SHIPMENT_REOPEN_REQUIRED');
    });
  });
});
