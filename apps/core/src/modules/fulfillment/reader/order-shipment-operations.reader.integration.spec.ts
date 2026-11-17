import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { OrderShipmentOperationsReader } from './order-shipment-operations.reader';
import { inRollbackTx, makeDb, makeDbService, wireLogistics } from '../services/__support__';
import { ambientDbService } from '../services/__support__/simple-outbound-wiring';
import { consolidationBase, createConsolidationSource } from '../services/__support__/consolidation-fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('주문 이력용 상자 작업 조회', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  const wired = wireLogistics(makeDbService(db), 'v2');
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  const readerFor = (tx: DbTx) => new OrderShipmentOperationsReader(ambientDbService(tx));

  async function seedOperation(
    tx: DbTx,
    type: 'split' | 'consolidate' | 'cancel',
    members: Array<{ shipmentId: string; role: 'source' | 'target' }>,
    values: Partial<typeof wmsTables.shipmentOperations.$inferInsert> = {},
  ) {
    const [op] = await tx
      .insert(wmsTables.shipmentOperations)
      .values({
        type,
        status: 'completed',
        operatorId: randomUUID(),
        reason: '사유',
        idempotencyKey: randomUUID(),
        requestHash: 'a'.repeat(64),
        completedAt: new Date(),
        ...values,
      })
      .returning();
    await tx.insert(wmsTables.shipmentOperationMembers).values(members.map((m) => ({ operationId: op.id, ...m })));
    return op;
  }

  async function twoOrders(tx: DbTx) {
    const base = await consolidationBase(tx);
    const customerId = randomUUID();
    const a = await createConsolidationSource(tx, wired, base, { quantity: 1, customerId });
    const b = await createConsolidationSource(tx, wired, base, { quantity: 1, customerId });
    return { a, b };
  }

  it('분할 한 건은 상자 둘을 한 줄로 묶고 사유 칸을 그대로 돌려준다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { a } = await twoOrders(tx);
      const [target] = await tx
        .insert(wmsTables.shipments)
        .values({ ...a.shipment, id: randomUUID() })
        .returning();
      await tx
        .insert(wmsTables.shipmentLines)
        .values({ ...a.line, id: randomUUID(), shipmentId: target.id, createdFromLineId: a.line.id });
      const op = await seedOperation(
        tx,
        'split',
        [
          { shipmentId: a.shipmentId, role: 'source' },
          { shipmentId: target.id, role: 'target' },
        ],
        { reasonCode: 'does_not_fit', requestChannel: 'phone', note: '메모' },
      );

      const { items } = await readerFor(tx).list(a.salesOrderId);

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        operationId: op.id,
        type: 'split',
        status: 'completed',
        fulfillmentOrderId: a.fulfillmentOrderId,
        otherOrdersInBox: false,
        reasonCode: 'does_not_fit',
        reason: '사유',
        requestChannel: 'phone',
        note: '메모',
        operatorId: op.operatorId,
      });
      expect([...items[0].shipmentIds].sort()).toEqual([a.shipmentId, target.id].sort());
    });
  });

  it('합포장 상자의 작업은 다른 주문이 든 상자로 표시된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { a, b } = await twoOrders(tx);
      await tx
        .update(wmsTables.shipmentLines)
        .set({ shipmentId: a.shipmentId })
        .where(eq(wmsTables.shipmentLines.id, b.line.id));
      const op = await seedOperation(tx, 'consolidate', [
        { shipmentId: a.shipmentId, role: 'target' },
        { shipmentId: b.shipmentId, role: 'source' },
      ]);

      const forA = await readerFor(tx).list(a.salesOrderId);
      const forB = await readerFor(tx).list(b.salesOrderId);

      expect(forA.items.map((i) => [i.operationId, i.otherOrdersInBox, i.shipmentIds])).toEqual([
        [op.id, true, expect.arrayContaining([a.shipmentId])],
      ]);
      expect(forB.items.map((i) => [i.operationId, i.otherOrdersInBox])).toEqual([[op.id, true]]);
    });
  });

  it('다른 주문 상자의 작업은 나오지 않고 시각 오름차순이며 상자가 없는 주문은 빈 목록이다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { a, b } = await twoOrders(tx);
      const late = await seedOperation(tx, 'cancel', [{ shipmentId: a.shipmentId, role: 'source' }], {
        createdAt: new Date('2030-01-02T00:00:00Z'),
      });
      const early = await seedOperation(tx, 'split', [{ shipmentId: a.shipmentId, role: 'source' }], {
        createdAt: new Date('2030-01-01T00:00:00Z'),
      });
      await seedOperation(tx, 'split', [{ shipmentId: b.shipmentId, role: 'source' }]);

      const { items } = await readerFor(tx).list(a.salesOrderId);
      const empty = await readerFor(tx).list(randomUUID());

      expect(items.map((i) => i.operationId)).toEqual([early.id, late.id]);
      expect(empty).toEqual({ salesOrderId: expect.any(String), items: [] });
    });
  });
});
