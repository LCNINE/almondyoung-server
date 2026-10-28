import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import { seedWorld, World } from '../../fulfillment/order-progress/__support__/order-progress.fixtures';
import { insertCustomerReturn, seedDeliveredLine } from '../line-quantities/__support__/claim-facts.fixtures';
import { readPickupSource } from './customer-return-pickup-source.reader';

/**
 * 반품 회수 본문 읽기 (K8 PR9 Task 3). rollback 전용 트랜잭션.
 * 실행: DATABASE_URL=<scratch core DB> npx jest customer-return-pickup-source --runInBand
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('readPickupSource — 반품 회수 본문 (K8 PR9)', () => {
  jest.setTimeout(120_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  const snapshotOf = (name: string) => ({
    recipientName: name,
    phone: '010-1111-2222',
    postalCode: '03154',
    roadAddress: '서울 종로구 세종대로 209',
    detailAddress: '101호',
  });

  async function stamp(tx: DbTx, shipmentId: string, deliveredAt: Date, name: string) {
    await tx
      .update(wmsTables.shipmentTracking)
      .set({ timestamp: deliveredAt })
      .where(eq(wmsTables.shipmentTracking.shipmentId, shipmentId));
    await tx
      .update(wmsTables.shipments)
      .set({ recipientSnapshot: snapshotOf(name) })
      .where(eq(wmsTables.shipments.id, shipmentId));
  }

  async function waybill(tx: DbTx, shipmentId: string, status: 'used' | 'voided', trackingNo: string | null) {
    await tx.insert(wmsTables.waybills).values({
      shipmentId,
      source: 'manual',
      carrier: 'HANJIN',
      status,
      trackingNo,
      manifestVersion: 1,
      recipientHash: 'x'.repeat(64),
      issuedAt: new Date(),
    });
  }

  async function seedReturn(tx: DbTx, w: World, parcels: number, returnQty = 2) {
    const line = await seedDeliveredLine(tx, w, {
      quantity: 2,
      composition: [{ skuId: w.skuId, qtyPerUnit: 1 }],
      parcels: Array.from({ length: parcels }, () => ({ qtyBySku: { [w.skuId]: parcels === 1 ? 2 : 1 } })),
      customerId: randomUUID(),
    });
    const { customerReturnId } = await insertCustomerReturn(tx, {
      salesOrderId: line.salesOrderId,
      status: 'expected',
      lines: [{ salesOrderLineId: line.lineId, quantity: returnQty }],
    });
    return { line, customerReturnId };
  }

  it('상자 둘에 나뉜 줄은 가장 늦게 배송완료된 상자의 주소·used 운송장을 쓴다', () =>
    inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const { line, customerReturnId } = await seedReturn(tx, w, 2);
      const [s1, s2] = line.parcels;
      await stamp(tx, s1.shipmentId, new Date('2026-10-20T00:00:00Z'), '첫째상자');
      await stamp(tx, s2.shipmentId, new Date('2026-10-22T00:00:00Z'), '둘째상자');
      await waybill(tx, s1.shipmentId, 'used', 'WB-S1');
      await waybill(tx, s2.shipmentId, 'used', 'WB-S2');

      const source = await readPickupSource(tx, customerReturnId);
      expect(source.kind).toBe('ok');
      if (source.kind !== 'ok') return;
      expect(source.snapshot).toEqual(snapshotOf('둘째상자'));
      expect(source.originalWaybillNo).toBe('WB-S2');
      const [so] = await tx
        .select({ name: wmsTables.salesOrderLines.productName })
        .from(wmsTables.salesOrderLines)
        .where(eq(wmsTables.salesOrderLines.id, line.lineId));
      expect(source.items).toEqual([{ name: so.name, quantity: 2 }]);
    }));

  it('운송장 행이 voided 뿐이면 originalWaybillNo 는 null', () =>
    inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const { line, customerReturnId } = await seedReturn(tx, w, 1);
      await stamp(tx, line.parcels[0].shipmentId, new Date('2026-10-20T00:00:00Z'), '고객');
      await waybill(tx, line.parcels[0].shipmentId, 'voided', null);

      const source = await readPickupSource(tx, customerReturnId);
      expect(source).toMatchObject({ kind: 'ok', originalWaybillNo: null });
    }));

  it('배송완료 상자가 없으면 no_delivered_shipment', () =>
    inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const line = await seedDeliveredLine(tx, w, {
        quantity: 2,
        composition: [{ skuId: w.skuId, qtyPerUnit: 1 }],
        parcels: [{ qtyBySku: { [w.skuId]: 2 }, delivered: false }],
        customerId: randomUUID(),
      });
      const { customerReturnId } = await insertCustomerReturn(tx, {
        salesOrderId: line.salesOrderId,
        status: 'expected',
        lines: [{ salesOrderLineId: line.lineId, quantity: 2 }],
      });
      expect(await readPickupSource(tx, customerReturnId)).toEqual({ kind: 'no_delivered_shipment' });
    }));
});
