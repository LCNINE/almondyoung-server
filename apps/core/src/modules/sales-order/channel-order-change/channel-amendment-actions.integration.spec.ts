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
  // 잠금 경합 케이스 전용 두 번째 커넥션 — makeDb 는 max: 1 이라 한 풀로는 두 트랜잭션을 동시에 못 연다.
  const contender = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
    await contender.sql.end({ timeout: 5 });
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

  /**
   * 무시는 판매주문 잠금을 먼저 잡는다(§6.3). `OrderModified` 처리(`handle`)가 판매주문을 잠근 채 «무시한 행이 없다» 를
   * 읽은 뒤 무시가 끼어들면, 같은 차이로 dismissed 행과 새 pending 행이 동시에 남는다. 잠금 순서(판매주문 → amendment)를
   * handle 과 맞춰 둘을 직렬화했는지를 본다 — 두 커넥션이 서로의 행을 봐야 하므로 이 케이스만 커밋된 행을 쓰고 직접 지운다.
   */
  it('무시는 판매주문 잠금을 기다린다 — 처리 중인 OrderModified 와 직렬화', async () => {
    const externalOrderId = `ext-${randomUUID().slice(0, 8)}`;
    const [so] = await db
      .insert(wmsTables.salesOrders)
      .values({ channelOrderId: externalOrderId, salesChannel: 'medusa', status: 'pending', shippingAddress: ADDRESS, orderDate: new Date() })
      .returning();
    let amendmentId: string | undefined;
    try {
      const [row] = await db
        .insert(wmsTables.salesOrderAmendments)
        .values({
          salesOrderId: so.id,
          amendmentKind: 'commercial',
          reasonCode: 'CHANNEL_ORDER_MODIFIED',
          deltas: [],
          metadata: { salesChannel: 'medusa', externalOrderId },
          origin: 'channel',
          status: 'pending',
        })
        .returning();
      amendmentId = row.id;
      const id = row.id;

      let entered!: () => void;
      const enteredSignal = new Promise<void>((resolve) => (entered = resolve));
      let release!: () => void;
      const releaseSignal = new Promise<void>((resolve) => (release = resolve));
      // handle 이 lockEffectiveOrder 로 잡는 것과 같은 잠금을 쥐고 놓지 않는다.
      const held = db.transaction(async (tx) => {
        await tx.select({ id: wmsTables.salesOrders.id }).from(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, so.id)).for('update');
        entered();
        await releaseSignal;
      });
      await Promise.race([enteredSignal, held]);
      try {
        const outcome = await contender.db
          .transaction(async (tx) => {
            await tx.execute(drizzleSql`SET LOCAL lock_timeout = '300ms'`);
            await wire(tx as unknown as DbTx).dismiss(id, {}, tx as unknown as DbTx);
          })
          .then(
            () => 'dismissed',
            (error: unknown) => error,
          );
        expect(pgErrorCode(outcome) ?? outcome).toBe('55P03'); // 잠금을 안 기다리면 'dismissed' 로 끝난다
      } finally {
        release();
        await held;
      }
    } finally {
      if (amendmentId) await db.delete(wmsTables.salesOrderAmendments).where(eq(wmsTables.salesOrderAmendments.id, amendmentId));
      await db.delete(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, so.id));
    }
  });
});

/** drizzle 0.44 는 쿼리 에러를 DrizzleQueryError 로 감싸 Postgres 코드가 `.cause` 에만 남는다. */
function pgErrorCode(error: unknown, depth = 5): string | undefined {
  let current: unknown = error;
  for (let i = 0; i < depth && current !== null && typeof current === 'object'; i += 1) {
    if ('code' in current && typeof current.code === 'string') return current.code;
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}
