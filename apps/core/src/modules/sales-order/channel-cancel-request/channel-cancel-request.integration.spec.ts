import { randomUUID } from 'crypto';
import { and, eq, sql as drizzleSql } from 'drizzle-orm';
import { BadRequestError } from '@app/shared';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import { CHANNEL_CANCEL_REQUEST_REASON } from './channel-cancel-request.types';
import { markLineShipped, seedChannelOrder, wireCancelRequest } from './__support__/cancel-request.fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const OPERATOR = { kind: 'operator' as const, actorId: '7d0a3c6e-0000-4000-8000-000000000001' };

async function requestsOf(tx: DbTx, salesOrderId: string) {
  return tx
    .select()
    .from(wmsTables.salesOrderAmendments)
    .where(
      and(
        eq(wmsTables.salesOrderAmendments.salesOrderId, salesOrderId),
        eq(wmsTables.salesOrderAmendments.reasonCode, CHANNEL_CANCEL_REQUEST_REASON),
      ),
    );
}

async function commandsOf(tx: DbTx, externalOrderId: string) {
  return tx.execute<{ event_type: string; payload: { payload: Record<string, unknown> } }>(
    drizzleSql`SELECT event_type, payload FROM event.outbox_events WHERE aggregate_id = ${`medusa:${externalOrderId}`} ORDER BY created_at`,
  );
}

describeIfDb('채널 취소 요청 (DB integration, rollback-only)', () => {
  jest.setTimeout(180_000);
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('전체 — requested 행 하나, 같은 트랜잭션에 CancelChannelOrder 하나, 박스·취소 기록은 그대로', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      const view = await w.manager.request(
        { salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' },
        tx,
      );
      expect(view).toMatchObject({ status: 'requested', scope: 'full', stage: null, convertedFromFull: false });

      const [row] = await requestsOf(tx, seed.salesOrderId);
      expect(row).toMatchObject({ id: view.id, origin: 'operator', status: 'requested', amendmentKind: 'commercial' });
      expect(row.deltas).toEqual([
        { type: 'cancel_line', salesOrderLineId: seed.lineIds[0], channelOrderItemId: seed.lines[0].item, quantity: 2 },
        { type: 'cancel_line', salesOrderLineId: seed.lineIds[1], channelOrderItemId: seed.lines[1].item, quantity: 1 },
      ]);

      const commands = await commandsOf(tx, seed.externalOrderId);
      expect(commands).toHaveLength(1);
      expect(commands[0].event_type).toBe('CancelChannelOrder');
      expect(commands[0].payload.payload).toMatchObject({
        requestId: view.id,
        salesChannel: 'medusa',
        externalOrderId: seed.externalOrderId,
        scope: 'full',
        requestedBy: 'operator',
      });
      expect('lines' in commands[0].payload.payload).toBe(false);

      const cancellations = await tx
        .select()
        .from(wmsTables.salesOrderCancellations)
        .where(eq(wmsTables.salesOrderCancellations.salesOrderId, seed.salesOrderId));
      expect(cancellations).toHaveLength(0);
      const so = await w.salesOrders.getOne(seed.salesOrderId, tx);
      expect(so?.status).toBe('confirmed');
      expect(so?.cancelRequest).toMatchObject({ id: view.id, status: 'requested' });
    });
  });

  it('같은 키 재요청은 같은 행 — 명령도 하나', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      const first = await w.manager.request(
        { salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' },
        tx,
      );
      const again = await w.manager.request(
        { salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' },
        tx,
      );
      expect(again.id).toBe(first.id);
      expect(await requestsOf(tx, seed.salesOrderId)).toHaveLength(1);
      expect(await commandsOf(tx, seed.externalOrderId)).toHaveLength(1);
    });
  });

  it('다른 키라도 열린 요청이 있으면 그것을 돌려받는다(고객·운영자 동시)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      const first = await w.manager.request(
        { salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' },
        tx,
      );
      const other = await w.manager.request(
        { salesOrderId: seed.salesOrderId, requester: { kind: 'customer', customerId: randomUUID() }, sourceKey: 'k2' },
        tx,
      );
      expect(other.id).toBe(first.id);
      expect(await requestsOf(tx, seed.salesOrderId)).toHaveLength(1);
    });
  });

  it('요청 뒤 주문이 취소돼도 같은 키 재전송은 저장된 그 행 — 상태 가드가 재전송을 막지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      const first = await w.manager.request(
        { salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' },
        tx,
      );
      await tx
        .update(wmsTables.salesOrders)
        .set({ status: 'cancelled' })
        .where(eq(wmsTables.salesOrders.id, seed.salesOrderId));
      const replay = await w.manager.request(
        { salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' },
        tx,
      );
      expect(replay).toEqual(first);
      expect(await requestsOf(tx, seed.salesOrderId)).toHaveLength(1);
      expect(await commandsOf(tx, seed.externalOrderId)).toHaveLength(1);
    });
  });

  it('닫힌 요청의 키로 다시 오면 그 행(새 요청을 만들지 않는다)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      const first = await w.manager.request(
        { salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' },
        tx,
      );
      await tx
        .update(wmsTables.salesOrderAmendments)
        .set({ status: 'rejected' })
        .where(eq(wmsTables.salesOrderAmendments.id, first.id));
      const replay = await w.manager.request(
        { salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' },
        tx,
      );
      expect(replay).toMatchObject({ id: first.id, status: 'rejected' });
      expect(await requestsOf(tx, seed.salesOrderId)).toHaveLength(1);
    });
  });

  it('부분 — 명령 줄은 채널 줄 번호와 «취소할» 수량', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      const view = await w.manager.request(
        {
          salesOrderId: seed.salesOrderId,
          lines: [{ salesOrderLineId: seed.lineIds[0], quantity: 1 }],
          requester: OPERATOR,
          sourceKey: 'k1',
        },
        tx,
      );
      expect(view.scope).toBe('partial');
      const [command] = await commandsOf(tx, seed.externalOrderId);
      expect(command.payload.payload).toMatchObject({
        scope: 'partial',
        lines: [{ channelOrderItemId: seed.lines[0].item, quantity: 1 }],
      });
    });
  });

  it('부분 요청이 남는 수량을 0 으로 만들면 전체로 보낸다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      const view = await w.manager.request(
        {
          salesOrderId: seed.salesOrderId,
          lines: [
            { salesOrderLineId: seed.lineIds[0], quantity: 2 },
            { salesOrderLineId: seed.lineIds[1], quantity: 1 },
          ],
          requester: OPERATOR,
          sourceKey: 'k1',
        },
        tx,
      );
      expect(view.scope).toBe('full');
    });
  });

  it('31번 — 운영자 전체취소인데 나간 몫이 있으면 안 나간 몫의 부분취소로 바꾼다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      await markLineShipped(tx, seed.lineIds[0], 2);
      const view = await w.manager.request(
        { salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' },
        tx,
      );
      expect(view).toMatchObject({ scope: 'partial', convertedFromFull: true });
      const [command] = await commandsOf(tx, seed.externalOrderId);
      expect(command.payload.payload).toMatchObject({
        scope: 'partial',
        lines: [{ channelOrderItemId: seed.lines[1].item, quantity: 1 }],
      });
    });
  });

  it('남은 몫이 0 이면 지금처럼 거절 — 행도 명령도 없다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      await markLineShipped(tx, seed.lineIds[0], 2);
      await markLineShipped(tx, seed.lineIds[1], 1);
      await expect(
        w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' }, tx),
      ).rejects.toThrow('no outstanding physical quantity');
      expect(await requestsOf(tx, seed.salesOrderId)).toHaveLength(0);
    });
  });

  it.each([
    ['naver', '네이버 판매자센터에서 취소해 주세요.'],
    ['coupang', '쿠팡 판매자센터에서 취소해 주세요.'],
  ] as const)('%s 주문은 판매자센터 문구로 거절', async (salesChannel, message) => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true, salesChannel });
      const attempt = w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' }, tx);
      await expect(attempt).rejects.toBeInstanceOf(BadRequestError);
      await expect(
        w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k2' }, tx),
      ).rejects.toThrow(message);
    });
  });

  it('채널 줄 번호가 없는 줄의 부분 요청은 400', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true, noChannelItemIds: true });
      await expect(
        w.manager.request(
          {
            salesOrderId: seed.salesOrderId,
            lines: [{ salesOrderLineId: seed.lineIds[0], quantity: 1 }],
            requester: OPERATOR,
            sourceKey: 'k1',
          },
          tx,
        ),
      ).rejects.toBeInstanceOf(BadRequestError);
    });
  });

  it('취소된 주문은 400', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: false });
      await tx
        .update(wmsTables.salesOrders)
        .set({ status: 'cancelled' })
        .where(eq(wmsTables.salesOrders.id, seed.salesOrderId));
      await expect(
        w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' }, tx),
      ).rejects.toThrow('이미 취소된 주문입니다.');
    });
  });

  it('DB 도 열린 요청을 하나만 받는다(코드 밖 경로의 방어선)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: false });
      await w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' }, tx);
      await expect(
        tx.transaction((sp) =>
          sp.insert(wmsTables.salesOrderAmendments).values({
            salesOrderId: seed.salesOrderId,
            amendmentKind: 'commercial',
            reasonCode: CHANNEL_CANCEL_REQUEST_REASON,
            deltas: [],
            origin: 'operator',
            status: 'requested',
          }),
        ),
      ).rejects.toThrow();
    });
  });
});
