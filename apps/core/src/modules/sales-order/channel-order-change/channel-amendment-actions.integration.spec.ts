import { randomUUID } from 'crypto';
import { eq, sql as drizzleSql } from 'drizzle-orm';
import { ConflictError, NotFoundError } from '@app/shared';
import { CHANNEL_ORDERS_COMMAND_STREAM } from '@packages/event-contracts/streams';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import { ambientDbService } from '../../fulfillment/services/__support__/simple-outbound-wiring';
import { outboxPublisherFor } from '../../fulfillment/outbox/__support__/outbox-publisher.factory';
import { ChannelAmendmentActionsService } from './channel-amendment-actions.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const ADDRESS = { recipientName: '김', phone: '010', postalCode: '1', roadAddress: '서울', detailAddress: '1' };
const OPERATOR = '7d0a3c6e-0000-4000-8000-000000000001';

describeIfDb('ChannelAmendmentActionsService (DB integration, rollback-only)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  function wire(tx: DbTx) {
    const dbService = ambientDbService(tx);
    return new ChannelAmendmentActionsService(dbService, outboxPublisherFor(CHANNEL_ORDERS_COMMAND_STREAM, dbService));
  }

  async function amendment(tx: DbTx, over: { origin?: 'channel' | 'operator'; status?: 'pending' | 'superseded' | 'applied' } = {}) {
    const externalOrderId = `ext-${randomUUID().slice(0, 8)}`;
    const [so] = await tx
      .insert(wmsTables.salesOrders)
      .values({ channelOrderId: externalOrderId, salesChannel: 'medusa', status: 'pending', shippingAddress: ADDRESS, orderDate: new Date() })
      .returning();
    const [row] = await tx
      .insert(wmsTables.salesOrderAmendments)
      .values({
        salesOrderId: so.id,
        amendmentKind: 'commercial',
        reasonCode: 'CHANNEL_ORDER_MODIFIED',
        deltas: [],
        metadata: { salesChannel: 'medusa', externalOrderId },
        origin: over.origin ?? 'channel',
        status: over.status ?? 'pending',
      })
      .returning();
    return { id: row.id, externalOrderId };
  }

  it('무시 — dismissed·시각·운영자·메모', async () => {
    await inRollbackTx(db, async (tx) => {
      const { id } = await amendment(tx);
      await expect(wire(tx).dismiss(id, { note: '채널 쪽 오류', operatorId: OPERATOR }, tx)).resolves.toEqual({ id, status: 'dismissed' });
      const [row] = await tx.select().from(wmsTables.salesOrderAmendments).where(eq(wmsTables.salesOrderAmendments.id, id));
      expect(row).toMatchObject({ status: 'dismissed', dismissedBy: OPERATOR, dismissNote: '채널 쪽 오류' });
      expect(row.dismissedAt).toBeInstanceOf(Date);
    });
  });

  it.each([
    ['superseded 채널 행', { status: 'superseded' as const }],
    ['applied 채널 행', { status: 'applied' as const }],
    ['운영자 행', { origin: 'operator' as const }],
  ])('무시·다시 확인 — %s 은 409', async (_label, over) => {
    await inRollbackTx(db, async (tx) => {
      const { id } = await amendment(tx, over);
      await expect(wire(tx).dismiss(id, {}, tx)).rejects.toBeInstanceOf(ConflictError);
      await expect(wire(tx).requestResync(id, tx)).rejects.toBeInstanceOf(ConflictError);
    });
  });

  it('두 번째 무시는 409 — 겹친 클릭', async () => {
    await inRollbackTx(db, async (tx) => {
      const { id } = await amendment(tx);
      await wire(tx).dismiss(id, {}, tx);
      await expect(wire(tx).dismiss(id, {}, tx)).rejects.toBeInstanceOf(ConflictError);
    });
  });

  it('없는 행은 404', async () => {
    await inRollbackTx(db, async (tx) => {
      await expect(wire(tx).dismiss(randomUUID(), {}, tx)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  it('다시 확인 — 시각을 찍고 같은 트랜잭션에 ResyncChannelOrder 명령을 outbox 에 넣는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { id, externalOrderId } = await amendment(tx);
      const result = await wire(tx).requestResync(id, tx);
      const [row] = await tx.select().from(wmsTables.salesOrderAmendments).where(eq(wmsTables.salesOrderAmendments.id, id));
      expect(row.status).toBe('pending');
      expect(row.resyncRequestedAt).toEqual(result.resyncRequestedAt);
      const outbox = await tx.execute<{ topic: string; event_type: string; partition_key: string; payload: Record<string, unknown> }>(
        drizzleSql`SELECT topic, event_type, partition_key, payload FROM event.outbox_events WHERE aggregate_id = ${`medusa:${externalOrderId}`}`,
      );
      expect(outbox).toHaveLength(1);
      expect(outbox[0]).toMatchObject({
        topic: 'channel-orders.commands.v1',
        event_type: 'ResyncChannelOrder',
        partition_key: `medusa:${externalOrderId}`,
        payload: { payload: { salesChannel: 'medusa', externalOrderId } }, // outbox payload 는 envelope — 명령 본문은 payload.payload
      });
    });
  });
});
