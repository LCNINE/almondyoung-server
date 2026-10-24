import { and, eq } from 'drizzle-orm';
import { BadRequestError } from '@app/shared';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import { calculatePartialCancellationRefund } from '../cancellation-refund/partial-cancellation-refund-calculator';
import type { WalletRefundClient, WalletRefundOutcome } from '../services/wallet-refund.client';
import { seedChannelOrder, wireCancelRequest } from '../channel-cancel-request/__support__/cancel-request.fixtures';
import type { CancellationRequest } from './order-cancellation.types';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const ADMIN_ID = '7d0a3c6e-0000-4000-8000-000000000001';
const CUSTOMER_ID = '7d0a3c6e-0000-4000-8000-000000000002';
const INTENT_ID = 'intent-core-settled-it';
const TOTAL = 3000;

const SUCCESS: WalletRefundOutcome = {
  kind: 'success',
  refunds: [
    {
      refundId: 'rf-it-1',
      intentId: INTENT_ID,
      status: 'SUCCEEDED',
      amount: TOTAL,
      currency: 'KRW',
      reasonCode: null,
      reasonMessage: null,
      manualConfirmable: false,
    },
  ],
};

/**
 * Wallet 만 목이다 — 커널·결제 쪽 매니저·판매주문 취소는 실제다.
 * as 근거: 매니저가 부르는 건 `refundByIntent` 하나다. 클래스의 private 필드 때문에 구조 대입이 안 된다
 */
function walletMock() {
  const refundByIntent = jest.fn().mockResolvedValue(SUCCESS);
  return { refundByIntent, client: { refundByIntent } as unknown as WalletRefundClient };
}

/** core 가 돈을 쥔 주문(3pl) — 결제 intent 와 총액이 있다(전체취소의 즉시 환불 금액 = totalAmount) */
async function seedCoreSettledOrder(tx: DbTx, w: ReturnType<typeof wireCancelRequest>, withFo = false) {
  const seed = await seedChannelOrder(tx, w, { withFo, salesChannel: '3pl' });
  await tx
    .update(wmsTables.salesOrders)
    .set({ walletIntentId: INTENT_ID, totalAmount: TOTAL })
    .where(eq(wmsTables.salesOrders.id, seed.salesOrderId));
  return seed;
}

async function refundLinksOf(tx: DbTx, salesOrderId: string) {
  return tx
    .select()
    .from(wmsTables.businessLinks)
    .where(
      and(
        eq(wmsTables.businessLinks.sourceId, salesOrderId),
        eq(wmsTables.businessLinks.relationName, 'cancellation_linked_wallet_refund'),
      ),
    );
}

/** 링크 metadata 는 jsonb(unknown)다 */
function refundStatusOf(metadata: unknown): unknown {
  return typeof metadata === 'object' && metadata !== null ? Reflect.get(metadata, 'refundStatus') : undefined;
}

async function cancellationIdsOf(tx: DbTx, salesOrderId: string) {
  const rows = await tx
    .select({ id: wmsTables.salesOrderCancellations.id })
    .from(wmsTables.salesOrderCancellations)
    .where(eq(wmsTables.salesOrderCancellations.salesOrderId, salesOrderId));
  return rows.map((row) => row.id);
}

function operator(
  salesOrderId: string,
  sourceKey: string,
  lines?: Array<{ salesOrderLineId: string; quantity: number }>,
) {
  const intent: CancellationRequest = {
    requester: { kind: 'operator', actorId: ADMIN_ID },
    actorRoles: ['admin'],
    salesOrderId,
    sourceKey,
    reasonCode: 'ADMIN_CANCEL',
    ...(lines ? { lines } : {}),
  };
  return intent;
}

describeIfDb('core 정산 주문 취소 — 커널·결제 쪽 매니저 (K7 PR4, DB integration, rollback-only)', () => {
  jest.setTimeout(180_000);
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('운영자 전체취소는 같은 취소 id 의 awaitingDecision manual_pending 링크 하나를 남기고 Wallet 을 부르지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const wallet = walletMock();
      const w = wireCancelRequest(tx, { walletRefundClient: wallet.client });
      const seed = await seedCoreSettledOrder(tx, w);

      const outcome = await w.cancellation.request(operator(seed.salesOrderId, 'k-admin-full'));

      expect(outcome).toEqual({ kind: 'applied', scope: 'full', refund: { refundStatus: 'manual_pending' } });
      const [so] = await tx.select().from(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, seed.salesOrderId));
      expect(so.status).toBe('cancelled');
      const cancellationIds = await cancellationIdsOf(tx, seed.salesOrderId);
      expect(cancellationIds).toHaveLength(1);
      const links = await refundLinksOf(tx, seed.salesOrderId);
      expect(links).toHaveLength(1);
      expect(links[0].metadata).toMatchObject({
        orderCancellationId: cancellationIds[0],
        refundStatus: 'manual_pending',
        awaitingDecision: true,
        actor: 'admin',
        intentId: INTENT_ID,
      });
      expect(wallet.refundByIntent).not.toHaveBeenCalled();
    });
  });

  it('운영자 전체취소 뒤 «환불 실행»이 성공하면 결정 대기 건이 닫혀 «환불 결정 전·실패» 목록에서 빠진다 (C1)', async () => {
    await inRollbackTx(db, async (tx) => {
      const wallet = walletMock();
      const w = wireCancelRequest(tx, { walletRefundClient: wallet.client });
      const seed = await seedCoreSettledOrder(tx, w);
      const refundIssues = () =>
        w.salesOrders.list(
          { keyword: seed.externalOrderId, keywordType: 'orderNo', refundIssueOnly: true, limit: 20, offset: 0 },
          tx,
        );

      await w.cancellation.request(operator(seed.salesOrderId, 'k-admin-then-retry'));
      expect((await refundIssues()).data.map((row: { id: string }) => row.id)).toEqual([seed.salesOrderId]);

      await expect(w.refunds.retry(seed.salesOrderId)).resolves.toEqual({ refundStatus: 'succeeded' });

      expect(wallet.refundByIntent).toHaveBeenCalledTimes(1);
      const links = await refundLinksOf(tx, seed.salesOrderId);
      const awaiting = links.find((link) => refundStatusOf(link.metadata) === 'manual_pending');
      const succeeded = links.find((link) => refundStatusOf(link.metadata) === 'succeeded');
      expect(succeeded?.metadata).toMatchObject({ completedRefundLinkId: awaiting?.id });
      expect((await refundIssues()).data).toHaveLength(0);
    });
  });

  it('운영자 부분취소는 추정액을 담은 링크를 남긴다', async () => {
    await inRollbackTx(db, async (tx) => {
      const wallet = walletMock();
      const w = wireCancelRequest(tx, { walletRefundClient: wallet.client });
      const seed = await seedCoreSettledOrder(tx, w);
      const lines = [{ salesOrderLineId: seed.lineIds[0], quantity: 1 }];
      // 계산기는 바꾸지 않는다(K8) — 기대값도 같은 계산기로 낸다. 시드 줄: 수량 2·1, 단가 1000
      const expected = calculatePartialCancellationRefund({
        salesChannel: '3pl',
        walletIntentId: INTENT_ID,
        totalAmount: TOTAL,
        shippingFee: 0,
        allOrderLines: [
          { id: seed.lineIds[0], quantity: 2, unitPrice: 1000 },
          { id: seed.lineIds[1], quantity: 1, unitPrice: 1000 },
        ],
        cancelledLines: lines,
      });

      const outcome = await w.cancellation.request(operator(seed.salesOrderId, 'k-admin-partial', lines));

      expect(outcome).toEqual({
        kind: 'applied',
        scope: 'partial',
        refund: {
          refundStatus: 'manual_pending',
          refundEstimateAmount: expected.refundEstimateAmount,
          manualReason: expected.manualReason,
        },
      });
      const cancellationIds = await cancellationIdsOf(tx, seed.salesOrderId);
      const links = await refundLinksOf(tx, seed.salesOrderId);
      expect(links).toHaveLength(1);
      expect(links[0].metadata).toMatchObject({
        orderCancellationId: cancellationIds[0],
        refundStatus: 'manual_pending',
        awaitingDecision: true,
        cancellationScope: 'partial',
        refundEstimateAmount: expected.refundEstimateAmount,
        cancelledLines: lines,
      });
      expect(wallet.refundByIntent).not.toHaveBeenCalled();
    });
  });

  it('고객 전체취소는 requested 링크를 남기고, 커밋 뒤 Wallet 을 cancel:<취소 id>:initial 로 부른다', async () => {
    await inRollbackTx(db, async (tx) => {
      const wallet = walletMock();
      const w = wireCancelRequest(tx, { walletRefundClient: wallet.client });
      const seed = await seedCoreSettledOrder(tx, w);
      // 실행 직전의 링크 — 커밋 뒤 실행이 보는 것은 취소 트랜잭션이 남긴 «요청» 한 줄이다
      let linksBeforeExecute: Array<{ metadata: unknown }> = [];
      wallet.refundByIntent.mockImplementationOnce(async () => {
        linksBeforeExecute = await refundLinksOf(tx, seed.salesOrderId);
        return SUCCESS;
      });

      const intent: CancellationRequest = {
        requester: { kind: 'customer', customerId: CUSTOMER_ID },
        salesOrderId: seed.salesOrderId,
        sourceKey: 'k-customer-full',
        reasonCode: 'CUSTOMER_REQUEST',
      };
      const outcome = await w.cancellation.request(intent);

      expect(outcome).toEqual({ kind: 'applied', scope: 'full', refund: { refundStatus: 'succeeded' } });
      const [cancellationId] = await cancellationIdsOf(tx, seed.salesOrderId);
      expect(linksBeforeExecute).toHaveLength(1);
      expect(linksBeforeExecute[0].metadata).toMatchObject({
        orderCancellationId: cancellationId,
        refundStatus: 'requested',
        actor: 'customer',
      });
      expect(wallet.refundByIntent).toHaveBeenCalledTimes(1);
      expect(wallet.refundByIntent).toHaveBeenCalledWith(
        INTENT_ID,
        TOTAL,
        expect.objectContaining({ kind: 'ITEM_CANCEL', correlationId: `cancel:${cancellationId}:initial` }),
      );
      const statuses = (await refundLinksOf(tx, seed.salesOrderId)).map((link) => refundStatusOf(link.metadata));
      expect(statuses.sort()).toEqual(['requested', 'succeeded']);
    });
  });

  it('cancel 이 던지면 환불 링크도 없다', async () => {
    await inRollbackTx(db, async (tx) => {
      const wallet = walletMock();
      const w = wireCancelRequest(tx, { walletRefundClient: wallet.client });
      const seed = await seedCoreSettledOrder(tx, w);
      // 취소가 효과(환불 링크 포함)를 다 쓴 «뒤» 도메인 거절로 끝나는 경우 — 같은 트랜잭션이라 링크도 함께 되돌려져야 한다.
      // 판정(precheck)이 먼저 막는 거절로는 «쓴 뒤 되돌림»을 볼 수 없어 실제 cancel() 뒤에 던진다
      const realCancel = w.salesOrders.cancel.bind(w.salesOrders);
      let linksInsideTx = 0;
      jest.spyOn(w.salesOrders, 'cancel').mockImplementationOnce(async (id, options, trx) => {
        await realCancel(id, options, trx);
        if (!trx) throw new Error('cancel must run inside the kernel transaction');
        linksInsideTx = (await refundLinksOf(trx, id)).length;
        throw new BadRequestError('이미 출고된 줄은 취소할 수 없습니다.');
      });

      await expect(w.cancellation.request(operator(seed.salesOrderId, 'k-admin-refused'))).rejects.toThrow(
        '이미 출고된 줄은 취소할 수 없습니다.',
      );

      expect(linksInsideTx).toBe(1);
      expect(await refundLinksOf(tx, seed.salesOrderId)).toHaveLength(0);
      expect(await cancellationIdsOf(tx, seed.salesOrderId)).toHaveLength(0);
      const [so] = await tx.select().from(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, seed.salesOrderId));
      expect(so.status).toBe('confirmed');
      expect(wallet.refundByIntent).not.toHaveBeenCalled();
    });
  });

  it.each([
    ['상자 후 전체취소', true, false],
    ['상자 전 부분취소', false, true],
  ])('같은 키 두 번째 요청은 링크를 더 만들지 않는다 — %s', async (_name, withFo, partial) => {
    await inRollbackTx(db, async (tx) => {
      const wallet = walletMock();
      const w = wireCancelRequest(tx, { walletRefundClient: wallet.client });
      const seed = await seedCoreSettledOrder(tx, w, withFo);
      // 상자 전 부분취소는 주문이 살아 있어 «이미 취소된 주문» 400 이 막아 주지 않는다 — 키가 기록에 없으면 두 번 적용된다
      const lines = partial ? [{ salesOrderLineId: seed.lineIds[0], quantity: 1 }] : undefined;
      const intent = operator(seed.salesOrderId, 'k-admin-twice', lines);

      await w.cancellation.request(intent);
      const linksAfterFirst = await refundLinksOf(tx, seed.salesOrderId);
      const second = await w.cancellation.request(intent);

      expect(second).toEqual({ kind: 'replayed' });
      expect(linksAfterFirst).toHaveLength(1);
      expect(await refundLinksOf(tx, seed.salesOrderId)).toHaveLength(1);
      expect(await cancellationIdsOf(tx, seed.salesOrderId)).toHaveLength(1);
    });
  });

  it('같은 키에 다른 줄이면 409 — 첫 취소를 덮어쓰지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx, { walletRefundClient: walletMock().client });
      const seed = await seedCoreSettledOrder(tx, w);
      await w.cancellation.request(
        operator(seed.salesOrderId, 'k-admin-mismatch', [{ salesOrderLineId: seed.lineIds[0], quantity: 1 }]),
      );
      await expect(
        w.cancellation.request(
          operator(seed.salesOrderId, 'k-admin-mismatch', [{ salesOrderLineId: seed.lineIds[1], quantity: 1 }]),
        ),
      ).rejects.toMatchObject({ response: { code: 'FULFILLMENT_IDEMPOTENCY_MISMATCH' } });
      expect(await refundLinksOf(tx, seed.salesOrderId)).toHaveLength(1);
    });
  });
});
