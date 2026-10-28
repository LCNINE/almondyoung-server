import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import { seedBox, seedWorld, World } from '../../fulfillment/order-progress/__support__/order-progress.fixtures';
import { insertCustomerReturn, seedDeliveredLine } from '../line-quantities/__support__/claim-facts.fixtures';
import { seedDispatchedParcel } from '../line-quantities/__support__/shipment-facts.fixtures';
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

  async function waybill(
    tx: DbTx,
    shipmentId: string,
    status: 'used' | 'voided',
    trackingNo: string | null,
    issuedAt = new Date(),
  ) {
    await tx.insert(wmsTables.waybills).values({
      shipmentId,
      source: 'manual',
      carrier: 'HANJIN',
      status,
      trackingNo,
      manifestVersion: 1,
      recipientHash: 'x'.repeat(64),
      issuedAt,
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

  it('반품 줄이 아닌 줄만 실은 더 늦은 상자는 무시한다', () =>
    inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const { line, customerReturnId } = await seedReturn(tx, w, 1);
      await stamp(tx, line.parcels[0].shipmentId, new Date('2026-10-20T00:00:00Z'), '반품줄상자');
      await waybill(tx, line.parcels[0].shipmentId, 'used', 'WB-A');

      // 같은 주문·같은 FO 의 줄 B — 반품하지 않았고, 더 늦게 별도 상자로 배송완료
      const [lineB] = await tx
        .insert(wmsTables.salesOrderLines)
        .values({
          salesOrderId: line.salesOrderId,
          variantId: randomUUID(),
          productName: 'OP-B',
          quantity: 1,
          unitPrice: 1000,
        })
        .returning();
      const [foiA] = await tx
        .select({ fulfillmentOrderId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId })
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.salesOrderLineId, line.lineId));
      const [foiB] = await tx
        .insert(wmsTables.fulfillmentOrderItems)
        .values({
          fulfillmentOrderId: foiA.fulfillmentOrderId,
          salesOrderId: line.salesOrderId,
          salesOrderLineId: lineB.id,
          skuId: w.skuId,
          qty: 1,
        })
        .returning();
      const box = await seedBox(tx, w, [foiB.id], { status: 'planned', qty: [1] });
      await seedDispatchedParcel(tx, w, {
        shipmentId: box.shipmentId,
        lines: [{ shipmentLineId: box.lineIds[0], foItemId: foiB.id, qty: 1 }],
        delivered: true,
      });
      await stamp(tx, box.shipmentId, new Date('2026-10-25T00:00:00Z'), '다른줄상자');
      await waybill(tx, box.shipmentId, 'used', 'WB-B');

      const source = await readPickupSource(tx, customerReturnId);
      expect(source).toMatchObject({ kind: 'ok', originalWaybillNo: 'WB-A' });
      if (source.kind === 'ok') expect(source.snapshot).toEqual(snapshotOf('반품줄상자'));
    }));

  it('배송완료 시각이 같으면 shipment_id 가 큰 상자가 이긴다', () =>
    inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const { line, customerReturnId } = await seedReturn(tx, w, 2);
      const at = new Date('2026-10-21T00:00:00Z');
      const ids = line.parcels.map((p) => p.shipmentId);
      for (const id of ids) {
        await stamp(tx, id, at, `상자-${id}`);
        await waybill(tx, id, 'used', `WB-${id}`);
      }
      const winner = [...ids].sort().pop() as string;

      const source = await readPickupSource(tx, customerReturnId);
      expect(source).toMatchObject({ kind: 'ok', originalWaybillNo: `WB-${winner}` });
      if (source.kind === 'ok') expect(source.snapshot).toEqual(snapshotOf(`상자-${winner}`));
    }));

  it('한 상자에 voided 와 used 가 있으면 used 번호', () =>
    inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const { line, customerReturnId } = await seedReturn(tx, w, 1);
      const id = line.parcels[0].shipmentId;
      await stamp(tx, id, new Date('2026-10-20T00:00:00Z'), '고객');
      await waybill(tx, id, 'voided', 'WB-VOID', new Date('2026-10-19T12:00:00Z'));
      await waybill(tx, id, 'used', 'WB-USED', new Date('2026-10-19T10:00:00Z'));

      expect(await readPickupSource(tx, customerReturnId)).toMatchObject({ originalWaybillNo: 'WB-USED' });
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
