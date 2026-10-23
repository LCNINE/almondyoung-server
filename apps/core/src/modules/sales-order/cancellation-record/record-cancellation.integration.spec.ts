import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, Rollback, seedSalesOrder } from '../../fulfillment/services/__support__';
import {
  seedCancellableOrder,
  seedShippedBeforeBoxingFulfillment,
  wireCancellation,
} from './__support__/cancellation-scenarios';
import { CancellationLineDerivationError } from './cancellation-lines';
import { recordSalesOrderCancellation } from './record-cancellation';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

async function cancellationsOf(tx: DbTx, salesOrderId: string) {
  return tx
    .select()
    .from(wmsTables.salesOrderCancellations)
    .where(eq(wmsTables.salesOrderCancellations.salesOrderId, salesOrderId))
    .orderBy(wmsTables.salesOrderCancellations.createdAt);
}

async function linesOf(tx: DbTx, cancellationId: string) {
  return tx
    .select({
      salesOrderLineId: wmsTables.salesOrderCancellationLines.salesOrderLineId,
      quantity: wmsTables.salesOrderCancellationLines.quantity,
      shipmentPhase: wmsTables.salesOrderCancellationLines.shipmentPhase,
    })
    .from(wmsTables.salesOrderCancellationLines)
    .where(eq(wmsTables.salesOrderCancellationLines.cancellationId, cancellationId));
}

describeIfDb('recordSalesOrderCancellation — 취소 행과 라인 행을 같은 트랜잭션에 (K6 PR1)', () => {
  jest.setTimeout(120_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  it('상자 전 부분 취소 — FO 전 writes before_shipment lines', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const o = await seedCancellableOrder(tx, w, 3);

      await w.salesOrders.cancel(
        o.salesOrderId,
        { lines: [{ salesOrderLineId: o.lineId, quantity: 1 }], cancelledBy: 'naver' },
        tx,
      );

      const [cancellation] = await cancellationsOf(tx, o.salesOrderId);
      expect(cancellation.cancellationScope).toBe('partial');
      expect(await linesOf(tx, cancellation.id)).toEqual([
        { salesOrderLineId: o.lineId, quantity: 1, shipmentPhase: 'before_shipment' },
      ]);
      expect(cancellation.metadata).not.toHaveProperty('cancelledLines');
    });
  });

  it('상자 전 부분 취소 — 출고 후 writes after_shipment lines', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const o = await seedCancellableOrder(tx, w, 3);
      await seedShippedBeforeBoxingFulfillment(tx, o, 3);

      await w.salesOrders.cancel(
        o.salesOrderId,
        { lines: [{ salesOrderLineId: o.lineId, quantity: 1 }], cancelledBy: 'naver' },
        tx,
      );

      const [cancellation] = await cancellationsOf(tx, o.salesOrderId);
      expect(await linesOf(tx, cancellation.id)).toEqual([
        { salesOrderLineId: o.lineId, quantity: 1, shipmentPhase: 'after_shipment' },
      ]);
    });
  });

  it('상자 전 전체 writes every remainder', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const o = await seedCancellableOrder(tx, w, 2);

      await w.salesOrders.cancel(
        o.salesOrderId,
        { lines: [{ salesOrderLineId: o.lineId, quantity: 1 }], cancelledBy: 'naver' },
        tx,
      );
      await w.salesOrders.cancel(o.salesOrderId, { cancelledBy: 'naver' }, tx);

      const rows = await cancellationsOf(tx, o.salesOrderId);
      const full = rows.find((row) => row.cancellationScope === 'full');
      expect(full).toBeDefined();
      expect(await linesOf(tx, full!.id)).toEqual([
        { salesOrderLineId: o.lineId, quantity: 1, shipmentPhase: 'before_shipment' },
      ]);
    });
  });

  it('상자 후 전체 writes outstanding lines', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const o = await seedCancellableOrder(tx, w, 2);
      await w.logistics.fulfillments.create({ salesOrderId: o.salesOrderId, warehouseId: o.warehouseId }, tx);

      await w.salesOrders.cancel(
        o.salesOrderId,
        { cancelledBy: 'customer', metadata: { sourceEventId: `self-${randomUUID()}` } },
        tx,
      );

      const [cancellation] = await cancellationsOf(tx, o.salesOrderId);
      expect(cancellation.cancellationScope).toBe('full');
      const lines = await linesOf(tx, cancellation.id);
      expect(lines).toEqual([{ salesOrderLineId: o.lineId, quantity: 2, shipmentPhase: 'before_shipment' }]);
      expect(cancellation.metadata).not.toHaveProperty('cancelledLines');
    });
  });

  it('a partial with metadata only (no line rows) is invisible to the recorder (K6 PR6)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const o = await seedCancellableOrder(tx, w, 2);
      // contract 뒤 취소 수량의 기록은 라인 행뿐이다 — metadata 만 있는 옛 모양의 행은 prior 에 들어가지 않는다.
      // 이런 행이 라이브에 없다는 것은 배포 전 게이트 G1 이 확인한다(PR6 계획 «배포»). 쓰기 문을 일부러 우회한 픽스처다.
      await tx.insert(wmsTables.salesOrderCancellations).values({
        salesOrderId: o.salesOrderId,
        cancellationScope: 'partial',
        effects: [],
        metadata: { cancelledLines: [{ salesOrderLineId: o.lineId, quantity: 1 }] },
      });

      await w.salesOrders.cancel(o.salesOrderId, { cancelledBy: 'naver' }, tx);

      const full = (await cancellationsOf(tx, o.salesOrderId)).find((row) => row.cancellationScope === 'full');
      expect(full).toBeDefined();
      expect(await linesOf(tx, full!.id)).toEqual([
        { salesOrderLineId: o.lineId, quantity: 2, shipmentPhase: 'before_shipment' },
      ]);
    });
  });

  it('상자 후 부분 — 상자 후 전체 뒤 is rejected with 400 and writes nothing', async () => {
    // 상자를 거치지 않는 디지털 줄은 박스 줄 배분 검사에 걸리지 않는다 — 전체 취소 행 확인이 없으면
    // 이미 전체 취소가 뺀 줄을 다시 빼려다 쓰기 문 도출(합 > 주문 수량)이 터져 500 이 된다.
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const o = await seedCancellableOrder(tx, w, 2);
      const [digitalLine] = await tx
        .insert(wmsTables.salesOrderLines)
        .values({
          salesOrderId: o.salesOrderId,
          variantId: randomUUID(),
          productName: 'IT Digital',
          quantity: 1,
          unitPrice: 1000,
          fulfillmentKind: 'digital',
          requiresShipping: false,
        })
        .returning();
      await w.logistics.fulfillments.create({ salesOrderId: o.salesOrderId, warehouseId: o.warehouseId }, tx);
      await w.salesOrders.cancel(
        o.salesOrderId,
        { cancelledBy: 'customer', metadata: { sourceEventId: `self-${randomUUID()}` } },
        tx,
      );
      const before = await cancellationsOf(tx, o.salesOrderId);
      expect(before.map((row) => row.cancellationScope)).toEqual(['full']);

      const error = await w.salesOrders
        .cancel(
          o.salesOrderId,
          {
            lines: [{ salesOrderLineId: digitalLine.id, quantity: 1 }],
            cancelledBy: 'customer',
            metadata: { sourceEventId: `self-${randomUUID()}` },
          },
          tx,
        )
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error instanceof Error ? error.message : '').toMatch(/이미 전체 취소/);
      expect(await cancellationsOf(tx, o.salesOrderId)).toEqual(before);
    });
  });

  it('takes cancelled lines from the argument and keeps them out of metadata (K6 PR6)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { salesOrderId, lineIds } = await seedSalesOrder(tx, { lines: [{ variantId: randomUUID(), quantity: 2 }] });

      const cancellation = await recordSalesOrderCancellation(
        tx,
        { salesOrderId, cancellationScope: 'partial', effects: [], metadata: { sourceEventId: 'e-1' } },
        [{ salesOrderLineId: lineIds[0], quantity: 1 }],
      );

      expect(cancellation.metadata).toEqual({ sourceEventId: 'e-1' });
      expect(await linesOf(tx, cancellation.id)).toEqual([
        { salesOrderLineId: lineIds[0], quantity: 1, shipmentPhase: 'before_shipment' },
      ]);
    });
  });

  it('rejects metadata that carries cancelledLines (K6 PR6)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { salesOrderId, lineIds } = await seedSalesOrder(tx, { lines: [{ variantId: randomUUID(), quantity: 2 }] });

      const error = await tx
        .transaction((nested) =>
          recordSalesOrderCancellation(
            nested as unknown as DbTx,
            {
              salesOrderId,
              cancellationScope: 'partial',
              effects: [],
              metadata: { cancelledLines: [{ salesOrderLineId: lineIds[0], quantity: 1 }] },
            },
            [{ salesOrderLineId: lineIds[0], quantity: 1 }],
          ),
        )
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(CancellationLineDerivationError);
      expect(await cancellationsOf(tx, salesOrderId)).toEqual([]);
    });
  });

  it('rejects over-cancellation', async () => {
    await inRollbackTx(db, async (tx) => {
      const { salesOrderId, lineIds } = await seedSalesOrder(tx, { lines: [{ variantId: randomUUID(), quantity: 1 }] });

      const error = await tx
        .transaction((nested) =>
          recordSalesOrderCancellation(
            nested as unknown as DbTx,
            {
              salesOrderId,
              cancellationScope: 'partial',
              effects: [],
            },
            [{ salesOrderLineId: lineIds[0], quantity: 2 }],
          ),
        )
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(CancellationLineDerivationError);
      expect(await cancellationsOf(tx, salesOrderId)).toEqual([]);
    });
  });

  it('rolls back lines with the cancellation', async () => {
    // 주문은 커밋해 두어야 «트랜잭션 밖에서 0행» 이 취소 기록의 롤백을 뜻한다(주문째 사라진 0행이 아니라).
    const { salesOrderId, lineIds } = await db.transaction((tx) =>
      seedSalesOrder(tx as unknown as DbTx, { lines: [{ variantId: randomUUID(), quantity: 2 }] }),
    );
    try {
      await expect(
        db.transaction(async (tx) => {
          const cancellation = await recordSalesOrderCancellation(
            tx as unknown as DbTx,
            {
              salesOrderId,
              cancellationScope: 'partial',
              effects: [],
            },
            [{ salesOrderLineId: lineIds[0], quantity: 1 }],
          );
          expect(await linesOf(tx as unknown as DbTx, cancellation.id)).toHaveLength(1);
          throw new Rollback('after record');
        }),
      ).rejects.toThrow(Rollback);

      expect(
        await db
          .select()
          .from(wmsTables.salesOrderCancellations)
          .where(eq(wmsTables.salesOrderCancellations.salesOrderId, salesOrderId)),
      ).toEqual([]);
      expect(
        await db
          .select()
          .from(wmsTables.salesOrderCancellationLines)
          .where(eq(wmsTables.salesOrderCancellationLines.salesOrderId, salesOrderId)),
      ).toEqual([]);
    } finally {
      await db.delete(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, salesOrderId));
    }
  });
});
