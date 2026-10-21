import { sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { seedWorld } from '../../fulfillment/order-progress/__support__/order-progress.fixtures';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import { wireCancellation } from '../cancellation-record/__support__/cancellation-scenarios';
import { recordSalesOrderCancellation } from '../cancellation-record/record-cancellation';
import { seedClaim, seedComponentSku, seedDeliveredLine } from './__support__/claim-facts.fixtures';
import { recallParcel } from './__support__/shipment-facts.fixtures';
import { claimTotalsByParcelSql } from './claim-quantities.sql';
import { LineSkuQuantities, readLineQuantities } from './line-quantities.reader';
import { lineSkuQuantitiesSql } from './line-quantities.sql';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

type ClaimExpected = [
  delivered: number,
  returnActive: number,
  returnConsumed: number,
  exchangeActive: number,
  claimable: number,
];

function claims([delivered, returnActive, returnConsumed, exchangeActive, claimable]: ClaimExpected) {
  return { delivered, returnActive, returnConsumed, exchangeActive, claimable };
}

type ClaimRow = {
  sales_order_line_id: string;
  sku_id: string;
  qty_per_unit: number | null;
  required: number;
  shipped: number;
  forwarded: number;
  delivered: number;
  partner_completed: number;
  outstanding: number;
  return_active: number;
  return_consumed: number;
  exchange_active: number;
  claimable: number;
};

/**
 * (가) 문의 결과와 (나) 문을 거치지 않고 조각을 다른 범위 모양(주문 테이블 select)으로 직접 select 한 결과가 같은지 본다.
 * 갈리면 조각이 바깥 쿼리 모양에 따라 다르게 풀린다는 뜻이다(2b 교차 검사와 같은 뜻).
 */
async function skusOf(tx: DbTx, order: { salesOrderId: string; lineId: string }): Promise<LineSkuQuantities[]> {
  const read = (await readLineQuantities(tx, order.salesOrderId)).get(order.lineId)?.skus ?? [];
  const rows = await tx.execute<ClaimRow>(
    lineSkuQuantitiesSql(sql`select so.id from ${wmsTables.salesOrders} as so where so.id = ${order.salesOrderId}`),
  );
  const direct = [...rows]
    .filter((row) => row.sales_order_line_id === order.lineId)
    .sort((a, b) => (a.sku_id < b.sku_id ? -1 : 1))
    .map((row) => ({
      skuId: row.sku_id,
      qtyPerUnit: row.qty_per_unit,
      required: row.required,
      shipped: row.shipped,
      forwarded: row.forwarded,
      delivered: row.delivered,
      partnerCompleted: row.partner_completed,
      outstanding: row.outstanding,
      returnActive: row.return_active,
      returnConsumed: row.return_consumed,
      exchangeActive: row.exchange_active,
      claimable: row.claimable,
    }));
  expect(direct).toEqual(read);
  return read;
}

async function onlySku(tx: DbTx, order: { salesOrderId: string; lineId: string }): Promise<LineSkuQuantities> {
  const skus = await skusOf(tx, order);
  expect(skus).toHaveLength(1);
  return skus[0];
}

describeIfDb('readLineQuantities — SKU 층 청구 사실 (K6 PR3a)', () => {
  jest.setTimeout(120_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  /** 수량 2, A×1, 소포 하나에 A 2 — 배송완료. */
  async function seedSimple(tx: DbTx) {
    const w = await seedWorld(tx);
    const line = await seedDeliveredLine(tx, w, {
      quantity: 2,
      composition: [{ skuId: w.skuId, qtyPerUnit: 1 }],
      parcels: [{ qtyBySku: { [w.skuId]: 2 } }],
    });
    const parcel = line.parcels[0];
    const item = (quantity: number) => ({
      salesOrderLineId: line.lineId,
      shipmentLineId: parcel.shipmentLineIdBySku.get(w.skuId) ?? null,
      dispatchAttemptId: parcel.dispatchAttemptId,
      quantity,
    });
    return { w, line, parcel, item };
  }

  it('delivered single line is fully claimable', async () => {
    await inRollbackTx(db, async (tx) => {
      const { line } = await seedSimple(tx);

      expect(await onlySku(tx, line)).toMatchObject(claims([2, 0, 0, 0, 2]));
    });
  });

  it('active and completed returns both reduce claimable', async () => {
    await inRollbackTx(db, async (tx) => {
      const { line, item } = await seedSimple(tx);
      await seedClaim(tx, { kind: 'return', salesOrderId: line.salesOrderId, status: 'requested', items: [item(1)] });
      await seedClaim(tx, { kind: 'return', salesOrderId: line.salesOrderId, status: 'completed', items: [item(1)] });

      expect(await onlySku(tx, line)).toMatchObject(claims([2, 1, 1, 0, 0]));
    });
  });

  it('rejected and cancelled returns do not count', async () => {
    await inRollbackTx(db, async (tx) => {
      const { line, item } = await seedSimple(tx);
      await seedClaim(tx, { kind: 'return', salesOrderId: line.salesOrderId, status: 'rejected', items: [item(1)] });
      await seedClaim(tx, { kind: 'return', salesOrderId: line.salesOrderId, status: 'cancelled', items: [item(1)] });

      expect(await onlySku(tx, line)).toMatchObject(claims([2, 0, 0, 0, 2]));
    });
  });

  it('active exchange reduces claimable but a completed one does not', async () => {
    await inRollbackTx(db, async (tx) => {
      const { line, item } = await seedSimple(tx);
      await seedClaim(tx, { kind: 'exchange', salesOrderId: line.salesOrderId, status: 'approved', items: [item(1)] });
      await seedClaim(tx, { kind: 'exchange', salesOrderId: line.salesOrderId, status: 'completed', items: [item(1)] });

      expect(await onlySku(tx, line)).toMatchObject(claims([2, 0, 0, 1, 1]));
    });
  });

  it('item without a parcel is not counted', async () => {
    await inRollbackTx(db, async (tx) => {
      const { line } = await seedSimple(tx);
      // 옛 행 모양 — 소포 칸이 비면 SKU 를 몰라 세지 않는다(N1)
      await seedClaim(tx, {
        kind: 'return',
        salesOrderId: line.salesOrderId,
        status: 'completed',
        items: [{ salesOrderLineId: line.lineId, shipmentLineId: null, dispatchAttemptId: null, quantity: 1 }],
      });

      expect(await onlySku(tx, line)).toMatchObject(claims([2, 0, 0, 0, 2]));
    });
  });

  it('set line claims per component', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const skuA = w.skuId;
      const skuB = await seedComponentSku(tx, w);
      const line = await seedDeliveredLine(tx, w, {
        quantity: 1,
        composition: [
          { skuId: skuA, qtyPerUnit: 1 },
          { skuId: skuB, qtyPerUnit: 2 },
        ],
        parcels: [{ qtyBySku: { [skuA]: 1, [skuB]: 2 } }],
      });
      const parcel = line.parcels[0];
      await seedClaim(tx, {
        kind: 'return',
        salesOrderId: line.salesOrderId,
        status: 'requested',
        items: [
          {
            salesOrderLineId: line.lineId,
            shipmentLineId: parcel.shipmentLineIdBySku.get(skuB) ?? null,
            dispatchAttemptId: parcel.dispatchAttemptId,
            quantity: 1,
          },
        ],
      });

      const skus = await skusOf(tx, line);
      expect(skus).toHaveLength(2);
      expect(skus.find((sku) => sku.skuId === skuA)).toMatchObject(claims([1, 0, 0, 0, 1]));
      expect(skus.find((sku) => sku.skuId === skuB)).toMatchObject(claims([2, 1, 0, 0, 1]));
    });
  });

  it('undelivered parcel is not claimable', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const line = await seedDeliveredLine(tx, w, {
        quantity: 2,
        composition: [{ skuId: w.skuId, qtyPerUnit: 1 }],
        parcels: [{ qtyBySku: { [w.skuId]: 2 }, delivered: false }],
      });

      expect(await onlySku(tx, line)).toMatchObject(claims([0, 0, 0, 0, 0]));
    });
  });

  it('recalled parcel is not claimable', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, line, parcel } = await seedSimple(tx);
      await recallParcel(tx, {
        dispatchAttemptId: parcel.dispatchAttemptId,
        lines: [{ foItemId: line.foItemIdBySku.get(w.skuId) ?? '', qty: 2 }],
      });

      expect(await onlySku(tx, line)).toMatchObject(claims([0, 0, 0, 0, 0]));
    });
  });

  it('after-shipment cancellation reduces claimable', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const line = await seedDeliveredLine(tx, w, {
        quantity: 2,
        composition: [{ skuId: w.skuId, qtyPerUnit: 2 }],
        parcels: [{ qtyBySku: { [w.skuId]: 4 } }],
      });
      // R1 — 취소 엔진은 V2 상자가 있는 주문에서 남은 수량만 취소한다(다 나간 라인의 부분취소는 거절한다). 수량 문의
      // 산술을 고정하는 스펙이라 엔진이 V1 사후취소에서 남기는 모양(보존 효과 + cancelledLines)을 쓰기 문에 직접 넘긴다.
      // 엔진 호출은 savepoint 안에서 — 거절이 SQL 오류로 나도 바깥 롤백 트랜잭션이 깨지지 않게. drizzle 의 중첩 트랜잭션
      // 타입은 DbTx 와 이름만 다른 같은 모양이라 record-cancellation.integration.spec.ts 와 같은 이중 캐스트를 쓴다.
      await expect(
        tx.transaction((nested) =>
          wireCancellation(nested as unknown as DbTx).salesOrders.cancel(
            line.salesOrderId,
            { lines: [{ salesOrderLineId: line.lineId, quantity: 1 }], cancelledBy: 'naver' },
            nested as unknown as DbTx,
          ),
        ),
      ).rejects.toThrow('includes shipped or already canceled quantity');
      await recordSalesOrderCancellation(tx, {
        salesOrderId: line.salesOrderId,
        cancellationScope: 'partial',
        reasonCode: 'customer',
        metadata: { cancelledLines: [{ salesOrderLineId: line.lineId, quantity: 1 }] },
        effects: [
          {
            type: 'preserved_shipped_fulfillment_order_item',
            metadata: {
              salesOrderLineId: line.lineId,
              skuId: w.skuId,
              requestedFulfillmentQuantity: 2,
              affectedShippedQuantity: 2,
            },
          },
        ],
      });

      const read = await readLineQuantities(tx, line.salesOrderId);
      expect(read.get(line.lineId)?.canceledAfterShipment).toBe(1);
      // 4 − 1 × 2
      expect(await onlySku(tx, line)).toMatchObject(claims([4, 0, 0, 0, 2]));
    });
  });

  it('stray sku without composition is not claimable', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const skuB = await seedComponentSku(tx, w);
      const line = await seedDeliveredLine(tx, w, {
        quantity: 1,
        composition: [
          { skuId: w.skuId, qtyPerUnit: 1 },
          { skuId: skuB, qtyPerUnit: 1 },
        ],
        parcels: [{ qtyBySku: { [w.skuId]: 1, [skuB]: 1 } }],
      });
      // 구성 대체가 B 를 구성에서 뺐다 — B 의 FOI 는 남고 1개당 수량을 모른다(N4)
      await tx.execute(sql`
        delete from ${wmsTables.salesOrderLineCompositions} as composition
         where composition.sales_order_line_id = ${line.lineId} and composition.sku_id = ${skuB}
      `);

      const skus = await skusOf(tx, line);
      const stray = skus.find((sku) => sku.skuId === skuB);
      expect(stray).toMatchObject({ qtyPerUnit: null, delivered: 1, claimable: 0 });
      expect(skus.find((sku) => sku.skuId === w.skuId)).toMatchObject(claims([1, 0, 0, 0, 1]));
    });
  });

  it('claims of another order do not count', async () => {
    await inRollbackTx(db, async (tx) => {
      const { line, item } = await seedSimple(tx);
      const other = await seedSimple(tx);
      // 다른 주문의 요청이 이 주문의 소포를 적었다 — 범위는 요청의 주문으로 거른다
      await seedClaim(tx, {
        kind: 'return',
        salesOrderId: other.line.salesOrderId,
        status: 'completed',
        items: [item(1)],
      });

      expect(await onlySku(tx, line)).toMatchObject(claims([2, 0, 0, 0, 2]));
    });
  });

  it('parcel totals count active and consumed returns and active exchanges', async () => {
    await inRollbackTx(db, async (tx) => {
      const { line, parcel, item, w } = await seedSimple(tx);
      await seedClaim(tx, { kind: 'return', salesOrderId: line.salesOrderId, status: 'requested', items: [item(1)] });
      await seedClaim(tx, { kind: 'return', salesOrderId: line.salesOrderId, status: 'completed', items: [item(1)] });
      await seedClaim(tx, { kind: 'return', salesOrderId: line.salesOrderId, status: 'rejected', items: [item(1)] });
      await seedClaim(tx, { kind: 'exchange', salesOrderId: line.salesOrderId, status: 'approved', items: [item(1)] });
      await seedClaim(tx, { kind: 'exchange', salesOrderId: line.salesOrderId, status: 'completed', items: [item(1)] });
      await seedClaim(tx, {
        kind: 'return',
        salesOrderId: line.salesOrderId,
        status: 'completed',
        items: [{ ...item(1), dispatchAttemptId: null }],
      });

      const rows = await tx.execute<{ dispatch_attempt_id: string; shipment_line_id: string; claimed: number }>(
        claimTotalsByParcelSql(sql`select ${line.salesOrderId}::uuid`),
      );
      expect([...rows]).toEqual([
        {
          dispatch_attempt_id: parcel.dispatchAttemptId,
          shipment_line_id: parcel.shipmentLineIdBySku.get(w.skuId),
          claimed: 3,
        },
      ]);
    });
  });
});
