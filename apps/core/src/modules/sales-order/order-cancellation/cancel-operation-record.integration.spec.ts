import { and, eq, inArray } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import { FULFILLMENT_SYSTEM_ACTOR_ID } from '../../../platform/auth/system-actor';
import { seedChannelOrder, wireCancelRequest } from '../channel-cancel-request/__support__/cancel-request.fixtures';
import type { CancellationRequest } from './order-cancellation.types';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const ADMIN_ID = '7d0a3c6e-0000-4000-8000-0000000000a1';
const INTENT_ID = 'intent-cancel-operation-record-it';

type Wiring = ReturnType<typeof wireCancelRequest>;

/** medusa = 채널에 취소를 요청하는 주문, 3pl = core 가 돈을 쥔 주문 */
async function seedOrder(tx: DbTx, w: Wiring, salesChannel: 'medusa' | '3pl', withFo: boolean) {
  const seed = await seedChannelOrder(tx, w, { withFo, salesChannel });
  if (salesChannel === '3pl') {
    await tx
      .update(wmsTables.salesOrders)
      .set({ walletIntentId: INTENT_ID, totalAmount: 3000 })
      .where(eq(wmsTables.salesOrders.id, seed.salesOrderId));
  }
  return seed;
}

function adminCancel(
  salesOrderId: string,
  sourceKey: string,
  fields: { reasonCode?: string; reasonDetail?: string; requestChannel?: 'phone' | 'kakao' } = {},
): CancellationRequest {
  return {
    requester: { kind: 'operator', actorId: ADMIN_ID },
    actorRoles: ['admin'],
    salesOrderId,
    sourceKey,
    ...fields,
  };
}

async function cancelOperationsOf(tx: DbTx, salesOrderId: string) {
  const boxes = await tx
    .selectDistinct({ shipmentId: wmsTables.shipmentLines.shipmentId })
    .from(wmsTables.shipmentLines)
    .innerJoin(
      wmsTables.fulfillmentOrderItems,
      eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
    )
    .where(eq(wmsTables.fulfillmentOrderItems.salesOrderId, salesOrderId));
  if (boxes.length === 0) return [];
  return tx
    .selectDistinct({
      id: wmsTables.shipmentOperations.id,
      operatorId: wmsTables.shipmentOperations.operatorId,
      reason: wmsTables.shipmentOperations.reason,
      reasonCode: wmsTables.shipmentOperations.reasonCode,
      requestChannel: wmsTables.shipmentOperations.requestChannel,
    })
    .from(wmsTables.shipmentOperations)
    .innerJoin(
      wmsTables.shipmentOperationMembers,
      eq(wmsTables.shipmentOperationMembers.operationId, wmsTables.shipmentOperations.id),
    )
    .where(
      and(
        eq(wmsTables.shipmentOperations.type, 'cancel'),
        inArray(
          wmsTables.shipmentOperationMembers.shipmentId,
          boxes.map((box) => box.shipmentId),
        ),
      ),
    );
}

async function cancellationsOf(tx: DbTx, salesOrderId: string) {
  return tx
    .select()
    .from(wmsTables.salesOrderCancellations)
    .where(eq(wmsTables.salesOrderCancellations.salesOrderId, salesOrderId));
}

function metadataOf(row: { metadata: unknown }): Record<string, unknown> {
  return typeof row.metadata === 'object' && row.metadata !== null ? { ...row.metadata } : {};
}

describeIfDb('관리자 취소의 처리자·요청 경로 (DB integration, rollback-only)', () => {
  jest.setTimeout(180_000);
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it.each([['3pl' as const], ['medusa' as const]])(
    '%s 주문 상자 취소 작업은 처리자가 관리자이고 요청 경로가 남는다',
    async (salesChannel) => {
      await inRollbackTx(db, async (tx) => {
        const w = wireCancelRequest(tx);
        const seed = await seedOrder(tx, w, salesChannel, true);

        await w.cancellation.request(
          adminCancel(seed.salesOrderId, `k-${salesChannel}`, {
            reasonCode: 'CUSTOMER_REQUEST',
            requestChannel: 'phone',
          }),
        );

        const operations = await cancelOperationsOf(tx, seed.salesOrderId);
        expect(operations.length).toBeGreaterThan(0);
        for (const operation of operations) {
          expect(operation).toMatchObject({
            operatorId: ADMIN_ID,
            reasonCode: 'CUSTOMER_REQUEST',
            requestChannel: 'phone',
          });
        }
        const [cancellation] = await cancellationsOf(tx, seed.salesOrderId);
        expect(metadataOf(cancellation).requestChannel).toBe('phone');
      });
    },
  );

  it.each([['3pl' as const], ['medusa' as const]])(
    '%s 주문 상자가 없으면 요청 경로는 취소 기록에 남는다',
    async (salesChannel) => {
      await inRollbackTx(db, async (tx) => {
        const w = wireCancelRequest(tx);
        const seed = await seedOrder(tx, w, salesChannel, false);

        await w.cancellation.request(
          adminCancel(seed.salesOrderId, `k-nobox-${salesChannel}`, {
            reasonCode: 'CUSTOMER_REQUEST',
            requestChannel: 'phone',
          }),
        );

        const [cancellation] = await cancellationsOf(tx, seed.salesOrderId);
        expect(metadataOf(cancellation).requestChannel).toBe('phone');
      });
    },
  );

  it('요청 경로가 없으면 취소 기록에 키를 두지 않고 고객 요청도 경로 없이 저장한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedOrder(tx, w, '3pl', true);

      await w.cancellation.request(adminCancel(seed.salesOrderId, 'k-no-channel', { reasonCode: 'CUSTOMER_REQUEST' }));

      const operations = await cancelOperationsOf(tx, seed.salesOrderId);
      expect(operations.length).toBeGreaterThan(0);
      expect(operations[0]).toMatchObject({ reasonCode: 'CUSTOMER_REQUEST', requestChannel: null });
      const [cancellation] = await cancellationsOf(tx, seed.salesOrderId);
      expect('requestChannel' in metadataOf(cancellation)).toBe(false);
    });
  });

  it('목록 밖 취소 코드도 저장하고, 고객 요청이 아니면 요청 경로는 버린다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedOrder(tx, w, 'medusa', true);

      await w.cancellation.request(
        adminCancel(seed.salesOrderId, 'k-change-of-mind', {
          reasonCode: 'CHANGE_OF_MIND',
          reasonDetail: '단순 변심',
          requestChannel: 'kakao',
        }),
      );

      const operations = await cancelOperationsOf(tx, seed.salesOrderId);
      expect(operations.length).toBeGreaterThan(0);
      expect(operations[0]).toMatchObject({
        operatorId: ADMIN_ID,
        reason: '단순 변심',
        reasonCode: 'CHANGE_OF_MIND',
        requestChannel: null,
      });
      const [cancellation] = await cancellationsOf(tx, seed.salesOrderId);
      expect('requestChannel' in metadataOf(cancellation)).toBe(false);
    });
  });

  it('쇼핑몰이 같은 취소를 수집으로 다시 보내도 아무것도 바뀌지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedOrder(tx, w, 'medusa', true);
      await w.cancellation.request(
        adminCancel(seed.salesOrderId, 'k-redelivery', { reasonCode: 'CUSTOMER_REQUEST', requestChannel: 'phone' }),
      );
      const operationsBefore = await cancelOperationsOf(tx, seed.salesOrderId);
      const cancellationsBefore = await cancellationsOf(tx, seed.salesOrderId);

      await w.cancellation.receiveChannelCancellation(async () => ({
        notice: {
          salesOrderId: seed.salesOrderId,
          lines: undefined,
          reasonCode: 'CUSTOMER_REQUEST',
          cancelledBy: 'medusa',
          metadata: { sourceEventId: 'evt-redelivery' },
        },
      }));

      expect(await cancelOperationsOf(tx, seed.salesOrderId)).toEqual(operationsBefore);
      expect((await cancellationsOf(tx, seed.salesOrderId)).map((row) => row.id)).toEqual(
        cancellationsBefore.map((row) => row.id),
      );
    });
  });

  it('수집된 쇼핑몰 취소는 처리자가 시스템이고 요청 경로가 없다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedOrder(tx, w, 'medusa', true);

      await w.cancellation.receiveChannelCancellation(async () => ({
        notice: {
          salesOrderId: seed.salesOrderId,
          lines: undefined,
          reasonCode: 'CUSTOMER_REQUEST',
          cancelledBy: 'medusa',
          metadata: { sourceEventId: 'evt-consumer' },
        },
      }));

      const operations = await cancelOperationsOf(tx, seed.salesOrderId);
      expect(operations.length).toBeGreaterThan(0);
      expect(operations[0]).toMatchObject({
        operatorId: FULFILLMENT_SYSTEM_ACTOR_ID,
        reasonCode: 'CUSTOMER_REQUEST',
        requestChannel: null,
      });
    });
  });

  it.each([['3pl' as const], ['medusa' as const]])(
    '%s 같은 키 재시도는 요청 경로가 달라도 첫 취소를 돌려준다',
    async (salesChannel) => {
      await inRollbackTx(db, async (tx) => {
        const w = wireCancelRequest(tx);
        const seed = await seedOrder(tx, w, salesChannel, true);
        const first = adminCancel(seed.salesOrderId, `k-replay-${salesChannel}`, {
          reasonCode: 'CUSTOMER_REQUEST',
          requestChannel: 'phone',
        });
        await w.cancellation.request(first);

        const outcome = await w.cancellation.request({ ...first, requestChannel: 'kakao' });

        expect(outcome.kind).toBe(salesChannel === '3pl' ? 'replayed' : 'channel_request');
        expect(await cancellationsOf(tx, seed.salesOrderId)).toHaveLength(1);
        const operations = await cancelOperationsOf(tx, seed.salesOrderId);
        expect(operations.every((operation) => operation.requestChannel === 'phone')).toBe(true);
      });
    },
  );
});
