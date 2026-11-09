import { randomUUID } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { outbox_events } from '@app/events';
import { CORE_ORDER_STREAM } from '@packages/event-contracts/streams';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { outboxPublisherFor } from '../../fulfillment/outbox/__support__/outbox-publisher.factory';
import { ambientDbService } from '../../fulfillment/services/__support__/simple-outbound-wiring';
import { makeDb, seedSalesOrder } from '../../fulfillment/services/__support__';
import { markLineStateDirty } from './line-state-dirty';
import { publishDirtyLineStates } from './line-state.publisher';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/**
 * 폴러 배치의 동시성 불변식은 커밋된 행과 두 연결로만 보인다 — 롤백 트랜잭션 하나로는 행 잠금이 서로를 막지 않는다.
 * 이 스펙이 만든 주문·outbox 행은 끝에 지운다.
 */
describeIfDb('publishDirtyLineStates (#1247)', () => {
  jest.setTimeout(120_000);
  const a = makeDb(DATABASE_URL as string);
  const b = makeDb(DATABASE_URL as string);
  const created: string[] = [];

  afterAll(async () => {
    if (created.length > 0) {
      await a.db.delete(outbox_events).where(inArray(outbox_events.aggregateId, created));
      await a.db.delete(wmsTables.salesOrders).where(inArray(wmsTables.salesOrders.id, created));
    }
    await a.sql.end();
    await b.sql.end();
  });

  async function seedDirtyOrder(): Promise<string> {
    const salesOrderId = await a.db.transaction(async (tx) => {
      const { salesOrderId } = await seedSalesOrder(tx as unknown as DbTx, {
        lines: [{ variantId: randomUUID(), quantity: 1 }],
      });
      await markLineStateDirty(tx as unknown as DbTx, [salesOrderId]);
      return salesOrderId;
    });
    created.push(salesOrderId);
    return salesOrderId;
  }

  async function versionsOf(salesOrderId: string) {
    const [row] = await a.db
      .select({
        version: wmsTables.salesOrders.lineStateVersion,
        published: wmsTables.salesOrders.lineStatePublishedVersion,
      })
      .from(wmsTables.salesOrders)
      .where(eq(wmsTables.salesOrders.id, salesOrderId));
    return row;
  }

  async function keysOf(salesOrderId: string) {
    const rows = await a.db
      .select({ key: outbox_events.idempotencyKey })
      .from(outbox_events)
      .where(
        and(eq(outbox_events.aggregateId, salesOrderId), eq(outbox_events.eventType, 'SalesOrderLineReservationState')),
      );
    return rows.map((row) => row.key).sort();
  }

  function publishOn(conn: typeof a, afterBatch?: () => void) {
    return conn.db.transaction(async (raw) => {
      const tx = raw as unknown as DbTx;
      const picked = await publishDirtyLineStates(tx, outboxPublisherFor(CORE_ORDER_STREAM, ambientDbService(tx)), {
        limit: 10_000,
        asOf: new Date(),
      });
      afterBatch?.();
      // 표시 트랜잭션이 이 잠금에 걸릴 시간을 준다
      if (afterBatch) await new Promise((resolve) => setTimeout(resolve, 300));
      return picked;
    });
  }

  it('읽은 뒤 버전이 오르면 published 는 읽은 값까지만 오르고 다음 배치가 새 버전으로 다시 낸다', async () => {
    const salesOrderId = await seedDirtyOrder();
    let marking: Promise<void> | undefined;

    await publishOn(a, () => {
      // 폴러가 잠근 행에 다른 트랜잭션이 표시한다 — 폴러가 커밋할 때까지 기다린다
      marking = b.db.transaction((tx) => markLineStateDirty(tx as unknown as DbTx, [salesOrderId]));
    });
    await marking;

    expect(await versionsOf(salesOrderId)).toEqual({ version: 2, published: 1 });
    expect(await keysOf(salesOrderId)).toEqual([`so-line-state:${salesOrderId}:1`]);

    await publishOn(a);

    expect(await versionsOf(salesOrderId)).toEqual({ version: 2, published: 2 });
    expect(await keysOf(salesOrderId)).toEqual([`so-line-state:${salesOrderId}:1`, `so-line-state:${salesOrderId}:2`]);
  });

  it('다른 트랜잭션이 잡고 있는 주문은 건너뛴다(SKIP LOCKED) — 그 트랜잭션이 끝난 뒤 다음 배치가 낸다', async () => {
    const salesOrderId = await seedDirtyOrder();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    const holder = b.db.transaction(async (tx) => {
      await markLineStateDirty(tx as unknown as DbTx, [salesOrderId]);
      locked();
      await held;
    });
    await isLocked;

    await publishOn(a);
    expect(await keysOf(salesOrderId)).toEqual([]);

    release();
    await holder;
    await publishOn(a);
    expect(await keysOf(salesOrderId)).toEqual([`so-line-state:${salesOrderId}:2`]);
    expect(await versionsOf(salesOrderId)).toEqual({ version: 2, published: 2 });
  });

  it('같은 버전을 다시 실어도 outbox 행은 하나다 — published 를 되돌려 재실행해도 멱등', async () => {
    const salesOrderId = await seedDirtyOrder();
    await publishOn(a);
    await a.db
      .update(wmsTables.salesOrders)
      .set({ lineStatePublishedVersion: 0 })
      .where(eq(wmsTables.salesOrders.id, salesOrderId));

    await publishOn(a);

    expect(await keysOf(salesOrderId)).toEqual([`so-line-state:${salesOrderId}:1`]);
    expect(await versionsOf(salesOrderId)).toEqual({ version: 1, published: 1 });
  });

  it('더러운 주문이 없으면 아무것도 싣지 않는다', async () => {
    const salesOrderId = await seedDirtyOrder();
    await publishOn(a);
    const before = await a.db.select({ id: outbox_events.id }).from(outbox_events);

    await expect(publishOn(a)).resolves.toBe(0);

    expect(await a.db.select({ id: outbox_events.id }).from(outbox_events)).toHaveLength(before.length);
    expect(await keysOf(salesOrderId)).toEqual([`so-line-state:${salesOrderId}:1`]);
  });
});
