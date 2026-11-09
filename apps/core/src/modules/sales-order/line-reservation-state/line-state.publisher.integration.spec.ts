import { randomUUID } from 'crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { outbox_events } from '@app/events';
import { CORE_ORDER_STREAM } from '@packages/event-contracts/streams';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { outboxPublisherFor } from '../../fulfillment/outbox/__support__/outbox-publisher.factory';
import { ambientDbService } from '../../fulfillment/services/__support__/simple-outbound-wiring';
import { makeDb, makeDbService, seedSalesOrder } from '../../fulfillment/services/__support__';
import { markLineStateDirty } from './line-state-dirty';
import { LineStatePublisher, publishLineStateOf } from './line-state.publisher';

/**
 * 폴러의 동시성 불변식은 커밋된 행과 두 연결로만 보인다 — 롤백 트랜잭션 하나로는 행 잠금·가시성이 서로를 가리지 않는다.
 * 그래서 이 스펙은 행을 커밋하고(끝에 지운다), 폴러 루프는 **그 DB 의 모든 표시를 실제로 낸다.**
 * 공유 개발 DB 의 진짜 표시를 건드리지 않도록 DB 이름이 `scratch`·`test` 로 시작할 때만 돈다
 * (`DATABASE_URL` 의 DB 이름으로 고르고, `current_database()` 로 한 번 더 확인한다).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const DISPOSABLE_DB = /^(scratch|test)/;
function databaseNameOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    return '';
  }
}
const describeIfScratchDb = DISPOSABLE_DB.test(databaseNameOf(DATABASE_URL)) ? describe : describe.skip;

describeIfScratchDb('LineStatePublisher — 커밋된 표시 (#1247)', () => {
  jest.setTimeout(120_000);
  const a = makeDb(DATABASE_URL as string);
  const b = makeDb(DATABASE_URL as string);
  const created: string[] = [];

  beforeAll(async () => {
    const [row] = await a.sql<{ name: string }[]>`select current_database() as name`;
    if (!DISPOSABLE_DB.test(row.name)) throw new Error(`버릴 수 있는 DB 가 아니다: ${row.name}`);
  });

  afterAll(async () => {
    if (created.length > 0) {
      await a.db.delete(outbox_events).where(inArray(outbox_events.aggregateId, created));
      await a.db
        .delete(wmsTables.salesOrderLineStateMarks)
        .where(inArray(wmsTables.salesOrderLineStateMarks.salesOrderId, created));
      await a.db.delete(wmsTables.salesOrders).where(inArray(wmsTables.salesOrders.id, created));
    }
    await a.sql.end();
    await b.sql.end();
  });

  async function seedOrder(options: { marked: boolean }): Promise<string> {
    const salesOrderId = await a.db.transaction(async (raw) => {
      const tx = raw as unknown as DbTx;
      const { salesOrderId } = await seedSalesOrder(tx, { lines: [{ variantId: randomUUID(), quantity: 1 }] });
      if (options.marked) await markLineStateDirty(tx, [salesOrderId]);
      return salesOrderId;
    });
    created.push(salesOrderId);
    return salesOrderId;
  }

  function markOn(conn: typeof a, salesOrderId: string) {
    return conn.db.transaction((tx) => markLineStateDirty(tx as unknown as DbTx, [salesOrderId]));
  }

  async function stateOf(salesOrderId: string) {
    const [so] = await a.db
      .select({ version: wmsTables.salesOrders.lineStateVersion })
      .from(wmsTables.salesOrders)
      .where(eq(wmsTables.salesOrders.id, salesOrderId));
    const marks = await a.db
      .select({ id: wmsTables.salesOrderLineStateMarks.id })
      .from(wmsTables.salesOrderLineStateMarks)
      .where(eq(wmsTables.salesOrderLineStateMarks.salesOrderId, salesOrderId));
    const events = await a.db
      .select({ key: outbox_events.idempotencyKey })
      .from(outbox_events)
      .where(
        and(eq(outbox_events.aggregateId, salesOrderId), eq(outbox_events.eventType, 'SalesOrderLineReservationState')),
      );
    return { version: so?.version, marks: marks.length, keys: events.map((row) => row.key).sort() };
  }

  /** 주문 하나를 `a` 연결의 트랜잭션에서 낸다. `beforeCommit` 은 낸 뒤·커밋 전에 돈다. */
  function publishOn(salesOrderId: string, beforeCommit?: () => Promise<void>) {
    return a.db.transaction(async (raw) => {
      const tx = raw as unknown as DbTx;
      const outcome = await publishLineStateOf(
        tx,
        outboxPublisherFor(CORE_ORDER_STREAM, ambientDbService(tx)),
        salesOrderId,
        new Date(),
      );
      await beforeCommit?.();
      return outcome;
    });
  }

  const key = (id: string, version: number) => `so-line-state:${id}:${version}`;

  it('표시를 지운 뒤 커밋된 표시는 남아서 다음 틱이 새 버전으로 낸다', async () => {
    const id = await seedOrder({ marked: true });

    // 폴러가 표시를 지운 뒤·커밋 전에 다른 트랜잭션이 표시하고 커밋한다(판매주문 행을 안 잡으니 기다리지 않는다)
    await expect(publishOn(id, () => markOn(b, id))).resolves.toBe('published');

    expect(await stateOf(id)).toEqual({ version: 1, marks: 1, keys: [key(id, 1)] });
    await expect(publishOn(id)).resolves.toBe('published');
    expect(await stateOf(id)).toEqual({ version: 2, marks: 0, keys: [key(id, 1), key(id, 2)] });
  });

  it('번호가 더 작아도 폴러가 볼 때 커밋 전이던 표시는 지워지지 않는다', async () => {
    const id = await seedOrder({ marked: false });
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let inserted!: () => void;
    const isInserted = new Promise<void>((resolve) => (inserted = resolve));
    const early = b.db.transaction(async (tx) => {
      await markLineStateDirty(tx as unknown as DbTx, [id]); // 먼저 번호를 받는다
      inserted();
      await held;
    });
    await isInserted;
    await markOn(a, id); // 나중 번호, 먼저 커밋

    await expect(publishOn(id)).resolves.toBe('published');
    release();
    await early;

    expect(await stateOf(id)).toEqual({ version: 1, marks: 1, keys: [key(id, 1)] });
    await expect(publishOn(id)).resolves.toBe('published');
    expect(await stateOf(id)).toEqual({ version: 2, marks: 0, keys: [key(id, 1), key(id, 2)] });
  });

  it('다른 트랜잭션이 판매주문 행을 잡고 있으면 기다리지 않고 건너뛴다 — 표시는 남는다', async () => {
    const id = await seedOrder({ marked: true });
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    const holder = b.db.transaction(async (tx) => {
      await tx.execute(sql`select id from sales_orders where id = ${id}::uuid for update`);
      locked();
      await held;
    });
    await isLocked;

    await expect(publishOn(id)).resolves.toBe('locked');
    expect(await stateOf(id)).toEqual({ version: 0, marks: 1, keys: [] });

    release();
    await holder;
    await expect(publishOn(id)).resolves.toBe('published');
    expect(await stateOf(id)).toEqual({ version: 1, marks: 0, keys: [key(id, 1)] });
  });

  it('같은 버전을 다시 실어도 outbox 행은 하나다', async () => {
    const id = await seedOrder({ marked: true });
    await publishOn(id);
    await a.db.update(wmsTables.salesOrders).set({ lineStateVersion: 0 }).where(eq(wmsTables.salesOrders.id, id));
    await markOn(a, id);

    await publishOn(id);

    expect(await stateOf(id)).toEqual({ version: 1, marks: 0, keys: [key(id, 1)] });
  });

  it('판매주문이 없는 표시는 지우기만 한다', async () => {
    const ghost = randomUUID();
    created.push(ghost);
    await markOn(a, ghost);

    await expect(publishOn(ghost)).resolves.toBe('gone');

    expect(await stateOf(ghost)).toEqual({ version: undefined, marks: 0, keys: [] });
  });

  it('폴러 루프: 표시된 주문을 다 내고, 표시가 없으면 아무것도 싣지 않는다', async () => {
    const ids = [await seedOrder({ marked: true }), await seedOrder({ marked: true })];
    const dbService = makeDbService(a.db);
    const poller = new LineStatePublisher(dbService, outboxPublisherFor(CORE_ORDER_STREAM, dbService));

    await expect(poller.drainCurrentDatabase(Date.now() + 30_000)).resolves.toBeGreaterThanOrEqual(2);
    for (const id of ids) expect(await stateOf(id)).toEqual({ version: 1, marks: 0, keys: [key(id, 1)] });

    const outboxBefore = await a.db.select({ id: outbox_events.id }).from(outbox_events);
    await expect(poller.drainCurrentDatabase(Date.now() + 30_000)).resolves.toBe(0);
    expect(await a.db.select({ id: outbox_events.id }).from(outbox_events)).toHaveLength(outboxBefore.length);
  });
});
