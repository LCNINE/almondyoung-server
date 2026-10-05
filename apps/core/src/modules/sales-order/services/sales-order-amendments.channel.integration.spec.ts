import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import { ambientDbService } from '../../fulfillment/services/__support__/simple-outbound-wiring';
import { SalesOrderAmendmentsService } from './sales-order-amendments.service';
import type { RecordedChannelDelta } from '../channel-order-change/channel-order-change.types';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const ADDRESS = { recipientName: '김', phone: '010', postalCode: '1', roadAddress: '서울', detailAddress: '1' };
const PENDING: RecordedChannelDelta = {
  type: 'add_product',
  channelOrderItemId: 'ci-9',
  channelProductId: null,
  quantity: 1,
  unitPrice: 1,
  outcome: 'pending',
  blockers: [{ code: 'OUT_OF_SCOPE' }],
};

describeIfDb('SalesOrderAmendmentsService 채널 기록·목록 (DB integration, rollback-only)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function salesOrder(tx: DbTx, status: 'pending' | 'cancelled' = 'pending') {
    const [so] = await tx
      .insert(wmsTables.salesOrders)
      .values({ channelOrderId: `IT-${randomUUID().slice(0, 8)}`, salesChannel: 'medusa', status, shippingAddress: ADDRESS, orderDate: new Date() })
      .returning();
    return so.id;
  }

  function record(service: SalesOrderAmendmentsService, salesOrderId: string, deltas: RecordedChannelDelta[], tx: DbTx) {
    const id = randomUUID();
    return service
      .recordChannelAmendment(
        { id, salesOrderId, deltas, occurredAt: new Date(), sourceEventId: `msg-${id}`, salesChannel: 'medusa', externalOrderId: 'ext' },
        tx,
      )
      .then(() => id);
  }

  it('pending 델타가 있으면 status=pending, 다음 채널 행이 오면 이전 pending 은 superseded', async () => {
    await inRollbackTx(db, async (tx) => {
      const service = new SalesOrderAmendmentsService(ambientDbService(tx));
      const soId = await salesOrder(tx);
      const first = await record(service, soId, [PENDING], tx);
      const second = await record(service, soId, [PENDING], tx);
      const rows = await tx.select().from(wmsTables.salesOrderAmendments).where(eq(wmsTables.salesOrderAmendments.salesOrderId, soId));
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(byId.get(first)).toMatchObject({ origin: 'channel', status: 'superseded', supersededById: second });
      expect(byId.get(second)).toMatchObject({ origin: 'channel', status: 'pending', reasonCode: 'CHANNEL_ORDER_MODIFIED', amendmentKind: 'commercial' });
    });
  });

  it('델타가 비면 행을 쓰지 않고 이전 pending 만 superseded(대체 행 없음)', async () => {
    await inRollbackTx(db, async (tx) => {
      const service = new SalesOrderAmendmentsService(ambientDbService(tx));
      const soId = await salesOrder(tx);
      const first = await record(service, soId, [PENDING], tx);
      await record(service, soId, [], tx);
      const rows = await tx.select().from(wmsTables.salesOrderAmendments).where(eq(wmsTables.salesOrderAmendments.salesOrderId, soId));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: first, status: 'superseded', supersededById: null });
    });
  });

  it('주소 델타만 있으면 fulfillment_only, 전부 applied 면 status=applied', async () => {
    await inRollbackTx(db, async (tx) => {
      const service = new SalesOrderAmendmentsService(ambientDbService(tx));
      const soId = await salesOrder(tx);
      const id = await record(service, soId, [{ type: 'shipping_address_change', before: ADDRESS, after: { ...ADDRESS, detailAddress: '2' }, outcome: 'applied' }], tx);
      const [row] = await tx.select().from(wmsTables.salesOrderAmendments).where(eq(wmsTables.salesOrderAmendments.id, id));
      expect(row).toMatchObject({ amendmentKind: 'fulfillment_only', status: 'applied' });
    });
  });

  it('대기 목록은 취소된 판매주문의 행을 뺀다', async () => {
    await inRollbackTx(db, async (tx) => {
      const service = new SalesOrderAmendmentsService(ambientDbService(tx));
      const open = await salesOrder(tx);
      const cancelled = await salesOrder(tx, 'cancelled');
      const visible = await record(service, open, [PENDING], tx);
      const hidden = await record(service, cancelled, [PENDING], tx);
      const page = await service.list({ status: 'pending', origin: 'channel', limit: 200 }, tx);
      const ids = page.items.map((item) => item.id);
      expect(ids).toContain(visible);
      expect(ids).not.toContain(hidden);
      expect(page.items.find((item) => item.id === visible)).toMatchObject({ salesChannel: 'medusa', salesOrderId: open });
    });
  });

  it('같은 occurredAt 3행을 limit 2 로 두 쪽에 걸쳐 한 번씩 낸다', async () => {
    await inRollbackTx(db, async (tx) => {
      const service = new SalesOrderAmendmentsService(ambientDbService(tx));
      const occurredAt = new Date('2099-01-01T00:00:00.000Z');
      const ids: string[] = [];
      for (let n = 0; n < 3; n += 1) {
        const id = randomUUID();
        await service.recordChannelAmendment(
          { id, salesOrderId: await salesOrder(tx), deltas: [PENDING], occurredAt, sourceEventId: `msg-${id}`, salesChannel: 'medusa', externalOrderId: 'ext' },
          tx,
        );
        ids.push(id);
      }
      const first = await service.list({ status: 'pending', origin: 'channel', limit: 2 }, tx);
      expect(first.nextCursor).not.toBeNull();
      const second = await service.list({ status: 'pending', origin: 'channel', limit: 2, cursor: first.nextCursor ?? undefined }, tx);
      const seen = [...first.items, ...second.items].map((item) => item.id).filter((id) => ids.includes(id));
      expect([...seen].sort()).toEqual([...ids].sort());
      expect(second.nextCursor).toBeNull();
    });
  });
});
