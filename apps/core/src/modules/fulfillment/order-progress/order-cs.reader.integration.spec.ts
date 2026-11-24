import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { eq, sql } from 'drizzle-orm';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { salesOrderContacts } from '../../customer-service/schema/customer-service.schema';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { makeDbService } from '../services/__support__';
import { OrderCsReader } from './order-cs.reader';
import { OrderProgressManager } from './order-progress.manager';
import { OrderProgressReader } from './order-progress.reader';
import * as f from './__support__/order-progress.fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('정체 보드 CS 조회 (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let reader: OrderCsReader;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 2 });
    db = drizzle(client, { schema: wmsSchema });
    reader = new OrderCsReader(makeDbService(db));
  });
  afterAll(async () => {
    await client.end();
  });

  const rollback = (run: (tx: DbTx) => Promise<void>) =>
    expect(
      db.transaction(async (rawTx) => {
        await run(rawTx as unknown as DbTx);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);

  type Patch = Partial<typeof wmsTables.salesOrders.$inferInsert>;
  const order = async (tx: DbTx, patch: Patch) => {
    const { salesOrderId } = await f.seedOrder(tx);
    await tx.update(wmsTables.salesOrders).set(patch).where(eq(wmsTables.salesOrders.id, salesOrderId));
    return salesOrderId;
  };
  const contact = (tx: DbTx, salesOrderId: string, at: string, followUpOn: string | null) =>
    tx.insert(salesOrderContacts).values({
      id: randomUUID(),
      salesOrderId,
      outcome: 'no_answer',
      body: '',
      followUpOn,
      authorId: randomUUID(),
      createdAt: new Date(at),
    });

  it('줄: 연락처·받는 분·상품 수·메모·마지막 연락', async () => {
    await rollback(async (tx) => {
      const id = await order(tx, {
        customerPhone: '010-1111-2222',
        shippingAddress: { recipientName: '받는이', phone: '010-3333-4444' },
        totalAmount: 12000,
        memo: ' ',
      });
      await tx.insert(wmsTables.salesOrderLines).values({
        salesOrderId: id,
        variantId: randomUUID(),
        productName: '나중',
        quantity: 3,
        createdAt: new Date('2099-01-01T00:00:00Z'),
      });
      // 앞 기록에만 다시 연락할 날이 있다 — 가장 최근 기록이 이긴다
      await contact(tx, id, '2026-11-01T00:00:00Z', '2026-12-01');
      await contact(tx, id, '2026-11-02T00:00:00Z', null);

      const brief = (await reader.briefs([id], tx)).get(id);
      expect(brief).toMatchObject({
        customerPhone: '010-1111-2222',
        recipientName: '받는이',
        recipientPhone: '010-3333-4444',
        totalAmount: 12000,
        firstItemName: 'OP',
        firstItemQty: 1,
        itemCount: 2,
        hasMemo: false,
        lastContact: { outcome: 'no_answer', at: '2026-11-02T00:00:00.000Z', followUpOn: null },
      });
    });
  });

  it('오늘 연락할 주문만: 가장 최근 기록의 날이 한국 오늘이거나 지났을 때', async () => {
    await rollback(async (tx) => {
      const now = new Date('2026-11-24T16:00:00Z'); // 한국 11월 25일
      const manager = new OrderProgressManager(makeDbService(db));
      const board = new OrderProgressReader(makeDbService(db));
      const make = async (...days: (string | null)[]) => {
        const { salesOrderId } = await f.seedOrder(tx);
        await f.seedBacklog(tx, salesOrderId, 'awaiting_matching');
        for (const [i, day] of days.entries()) await contact(tx, salesOrderId, `2026-11-0${i + 1}T00:00:00Z`, day);
        return salesOrderId;
      };
      const today = await make('2026-11-25');
      const past = await make('2026-12-30', '2026-11-20');
      const ids = [today, past, await make('2026-11-26'), await make('2026-11-20', null), await make()];
      await manager.refreshScope(
        sql`SELECT unnest(ARRAY[${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}])`,
        now,
        tx,
      );
      const page = await board.listOrders({ stage: 'fo', followUpDue: true, sort: 'dwell', limit: 200 }, now, tx);
      expect(
        page.items
          .map((i) => i.salesOrderId)
          .filter((id) => ids.includes(id))
          .sort(),
      ).toEqual([today, past].sort());
    });
  });

  it('다른 주문: 같은 회원이거나 주문자 연락처가 같다 — 자기 자신·안심번호·남은 뺀다', async () => {
    await rollback(async (tx) => {
      const me = randomUUID();
      const phone = `010${String(Date.now()).slice(-8)}`;
      const dashed = `${phone.slice(0, 3)}-${phone.slice(3, 7)}-${phone.slice(7)}`;
      const at = (d: string) => new Date(`2026-11-${d}T00:00:00Z`);
      const base = await order(tx, {
        customerId: me,
        customerPhone: phone,
        shippingAddressHash: 'h1',
        orderDate: at('10'),
      });
      const sameMember = await order(tx, { customerId: me, shippingAddressHash: 'h2', orderDate: at('09') });
      const samePhone = await order(tx, {
        customerId: randomUUID(),
        customerPhone: dashed,
        shippingAddressHash: 'h1',
        orderDate: at('08'),
      });
      await order(tx, { customerId: randomUUID(), customerPhone: '010-9', orderDate: at('07') });

      const { otherOrders, moreOtherOrders } = await reader.context(base, tx);
      expect(otherOrders.map((o) => [o.salesOrderId, o.matchedBy, o.sameAddress, o.phase])).toEqual([
        [sameMember, 'customer', false, 'preparing'],
        [samePhone, 'phone', true, 'preparing'],
      ]);
      expect(moreOtherOrders).toBe(false);
    });
  });

  it('안심번호(050…)·채워 넣은 번호·빈 번호·회원 없음은 같은 고객으로 묶지 않는다', async () => {
    await rollback(async (tx) => {
      const virtual = `0507${String(Date.now()).slice(-8)}`;
      for (const customerPhone of [virtual, '010-0000-0000', null, '']) {
        const a = await order(tx, { customerPhone });
        await order(tx, { customerPhone });
        expect((await reader.context(a, tx)).otherOrders).toEqual([]);
      }
    });
  });

  it('다른 주문이 많으면 최근 것만 내고 더 있다고 알린다', async () => {
    await rollback(async (tx) => {
      const me = randomUUID();
      const base = await order(tx, { customerId: me });
      for (let i = 0; i < 11; i += 1) await order(tx, { customerId: me });
      const ctx = await reader.context(base, tx);
      expect(ctx.otherOrders).toHaveLength(10);
      expect(ctx.moreOtherOrders).toBe(true);
    });
  });

  it('상자마다 한 줄, 살아 있는 송장만', async () => {
    await rollback(async (tx) => {
      const w = await f.seedWorld(tx);
      const o = await f.seedOrder(tx);
      const { foId, foItemId } = await f.seedFo(tx, w, o);
      const [line] = await tx
        .insert(wmsTables.salesOrderLines)
        .values({ salesOrderId: o.salesOrderId, variantId: randomUUID(), productName: '둘째', quantity: 1 })
        .returning();
      const [second] = await tx
        .insert(wmsTables.fulfillmentOrderItems)
        .values({
          fulfillmentOrderId: foId,
          salesOrderId: o.salesOrderId,
          salesOrderLineId: line.id,
          skuId: w.skuId,
          qty: 1,
        })
        .returning();
      const sent = await f.seedBox(tx, w, [foItemId, second.id], {
        status: 'shipped',
        openedAt: new Date('2026-11-01T00:00:00Z'),
        shippedAt: new Date('2026-11-02T00:00:00Z'),
      });
      await f.seedWaybill(tx, sent.shipmentId, 'voided');
      await f.seedWaybill(tx, sent.shipmentId, 'used');
      const waiting = await f.seedBox(tx, w, [foItemId], { status: 'draft' });
      const ctx = await reader.context(o.salesOrderId, tx);
      expect(ctx.boxes).toEqual([
        {
          shipmentId: sent.shipmentId,
          fulfillmentOrderId: foId,
          status: 'shipped',
          carrier: 'HANJIN',
          trackingNo: expect.stringMatching(/^T\d+$/),
          shippedAt: '2026-11-02T00:00:00.000Z',
        },
        expect.objectContaining({ shipmentId: waiting.shipmentId, status: 'draft', carrier: null, trackingNo: null }),
      ]);
    });
  });

  it('없는 주문은 404', async () => {
    await rollback(async (tx) => {
      await expect(reader.context(randomUUID(), tx)).rejects.toThrow('Sales order not found');
    });
  });
});
