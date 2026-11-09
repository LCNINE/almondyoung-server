import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { seedOrder, seedWorld } from '../../fulfillment/order-progress/__support__/order-progress.fixtures';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import { seedComponentSku, seedDeliveredLine } from '../line-quantities/__support__/claim-facts.fixtures';
import {
  findOrderIdsByChannelOrderItemIds,
  readLineReservationCandidates,
  readLineReservationStates,
} from './line-reservation-state.reader';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

async function addPlainLine(tx: DbTx, salesOrderId: string, quantity: number, channelOrderItemId: string | null) {
  const [line] = await tx
    .insert(wmsTables.salesOrderLines)
    .values({
      salesOrderId,
      variantId: randomUUID(),
      productName: 'LRS',
      quantity,
      unitPrice: 1000,
      channelOrderItemId,
    })
    .returning();
  return line.id;
}

async function cancelBeforeShipment(tx: DbTx, salesOrderId: string, lineId: string, quantity: number) {
  const [cancellation] = await tx.insert(wmsTables.salesOrderCancellations).values({ salesOrderId }).returning();
  await tx.insert(wmsTables.salesOrderCancellationLines).values({
    cancellationId: cancellation.id,
    salesOrderId,
    salesOrderLineId: lineId,
    quantity,
    shipmentPhase: 'before_shipment',
  });
}

describeIfDb('line reservation state reader', () => {
  jest.setTimeout(120_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  it('세트 줄·단일 줄·FO 없는 줄의 demand·heldUnits·version, 출고 전 취소는 demand 에서 빠진다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const skuB = await seedComponentSku(tx, w);
      // 세트 줄: 2세트 = A 1개 + B 2개씩. 소포에 A 2·B 2 가 나갔다 → min(2/1, 2/2) = 1 세트 잡음
      const set = await seedDeliveredLine(tx, w, {
        quantity: 2,
        composition: [
          { skuId: w.skuId, qtyPerUnit: 1 },
          { skuId: skuB, qtyPerUnit: 2 },
        ],
        parcels: [{ qtyBySku: { [w.skuId]: 2, [skuB]: 2 } }],
      });
      await tx
        .update(wmsTables.salesOrderLines)
        .set({ channelOrderItemId: 'ordli_set' })
        .where(eq(wmsTables.salesOrderLines.id, set.lineId));
      await tx
        .update(wmsTables.salesOrders)
        .set({ lineStateVersion: 7 })
        .where(eq(wmsTables.salesOrders.id, set.salesOrderId));
      // 단일 줄(구성 없음 = FO 전) 2개: 하나는 출고 전 취소 1
      const plain = await addPlainLine(tx, set.salesOrderId, 3, 'ordli_plain');
      const canceled = await addPlainLine(tx, set.salesOrderId, 4, 'ordli_canceled');
      await cancelBeforeShipment(tx, set.salesOrderId, canceled, 1);

      const asOf = new Date('2026-11-09T01:00:00.000Z');
      const [state] = await readLineReservationStates(tx, [set.salesOrderId], asOf);

      expect(state).toMatchObject({
        salesOrderId: set.salesOrderId,
        salesChannel: 'medusa',
        version: 7,
        asOf: '2026-11-09T01:00:00.000Z',
      });
      expect(typeof state.orderedAt).toBe('string');
      const byLine = new Map(state.lines.map((line) => [line.salesOrderLineId, line]));
      expect(byLine.get(set.lineId)).toMatchObject({
        channelOrderItemId: 'ordli_set',
        ordered: 2,
        canceledBeforeShipment: 0,
        demand: 2,
        heldUnits: 1,
      });
      expect(byLine.get(plain)).toMatchObject({ ordered: 3, demand: 3, heldUnits: 0 });
      expect(byLine.get(canceled)).toMatchObject({ ordered: 4, canceledBeforeShipment: 1, demand: 3, heldUnits: 0 });
      expect(state.lines).toHaveLength(3);
    });
  });

  it('없는 주문 id 와 빈 목록은 결과가 비어 있다', async () => {
    await inRollbackTx(db, async (tx) => {
      expect(await readLineReservationStates(tx, [], new Date())).toEqual([]);
      expect(await readLineReservationStates(tx, [randomUUID()], new Date())).toEqual([]);
    });
  });

  it('채널 줄 id 로 주문을 찾되 다른 채널의 줄은 찾지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const o = await seedOrder(tx);
      const itemId = `ordli_${randomUUID()}`;
      await tx
        .update(wmsTables.salesOrderLines)
        .set({ channelOrderItemId: itemId })
        .where(eq(wmsTables.salesOrderLines.id, o.lineId));

      expect(await findOrderIdsByChannelOrderItemIds(tx, 'medusa', [itemId])).toEqual([
        { channelOrderItemId: itemId, salesOrderId: o.salesOrderId },
      ]);
      expect(await findOrderIdsByChannelOrderItemIds(tx, 'naver', [itemId])).toEqual([]);
    });
  });

  it('후보는 끝난 주문과 윈도 이전 주문, 채널 줄 id 없는 줄을 뺀다', async () => {
    await inRollbackTx(db, async (tx) => {
      const since = new Date('2026-10-01T00:00:00.000Z');
      const mark = randomUUID();
      const seed = async (
        status: 'confirmed' | 'cancelled' | 'shipped' | 'delivered',
        createdAt: Date,
        itemId: string | null,
      ) => {
        const o = await seedOrder(tx, { status, createdAt });
        await tx
          .update(wmsTables.salesOrderLines)
          .set({ channelOrderItemId: itemId })
          .where(eq(wmsTables.salesOrderLines.id, o.lineId));
      };
      await seed('confirmed', new Date('2026-10-05T00:00:00.000Z'), `${mark}-open`);
      await seed('cancelled', new Date('2026-10-05T00:00:00.000Z'), `${mark}-cancelled`);
      await seed('shipped', new Date('2026-10-05T00:00:00.000Z'), `${mark}-shipped`);
      await seed('delivered', new Date('2026-10-05T00:00:00.000Z'), `${mark}-delivered`);
      await seed('confirmed', new Date('2026-09-30T00:00:00.000Z'), `${mark}-old`);
      await seed('confirmed', new Date('2026-10-05T00:00:00.000Z'), null);

      const page = await readLineReservationCandidates(tx, {
        salesChannel: 'medusa',
        orderedAtOrAfter: since,
        limit: 500,
      });
      const mine = page.channelOrderItemIds.filter((id) => id.startsWith(mark));
      expect(mine).toEqual([`${mark}-open`]);
      expect(page.nextAfterLineId).toBeNull();
    });
  });

  it('후보는 줄 id 순 keyset 으로 나뉜다', async () => {
    await inRollbackTx(db, async (tx) => {
      const since = new Date('2026-10-01T00:00:00.000Z');
      const mark = randomUUID();
      for (let i = 0; i < 3; i += 1) {
        const o = await seedOrder(tx, { createdAt: new Date('2026-10-05T00:00:00.000Z') });
        await tx
          .update(wmsTables.salesOrderLines)
          .set({ channelOrderItemId: `${mark}-${i}` })
          .where(eq(wmsTables.salesOrderLines.id, o.lineId));
      }
      const seen: string[] = [];
      let after: string | undefined;
      for (let guard = 0; guard < 1000; guard += 1) {
        const page = await readLineReservationCandidates(tx, {
          salesChannel: 'medusa',
          orderedAtOrAfter: since,
          afterLineId: after,
          limit: 2,
        });
        seen.push(...page.channelOrderItemIds);
        if (page.nextAfterLineId === null) break;
        after = page.nextAfterLineId;
      }
      expect(seen.filter((id) => id.startsWith(mark))).toHaveLength(3);
      expect(new Set(seen).size).toBe(seen.length);
    });
  });
});
