// apps/medusa/integration-tests/http/return-prepay.spec.ts
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { ensureReturnShippingOption } from '../../src/modules/almond-fulfillment/return-shipping-option';
import { partialCancelOrder } from '../../src/workflows/orders/partial-cancel/partial-cancel-order';
import { readReturnPrepayRecord } from '../../src/workflows/orders/returns/return-prepay-record';
import { ensureReturnReasons } from '../../src/workflows/orders/returns/return-reasons';
import { requestOrderReturn } from '../../src/workflows/orders/returns/request-order-return';
import { loadOrderView } from '../../src/workflows/orders/settlement/load-order-view';
import { FakeWallet, WALLET_BASE_URL, setupCommerce, placeOrder, loadOrder, Commerce } from './fixtures/partial-cancel-fixture';
import { CORE_BASE_URL, CORE_INTERNAL_KEY, FakeCore } from './fixtures/return-fixture';

jest.setTimeout(300 * 1000);
process.env.WALLET_BASE_URL = WALLET_BASE_URL;
process.env.WALLET_API_KEY = 'test-wallet-key';
process.env.CORE_SERVICE_URL = CORE_BASE_URL;
process.env.CORE_INTERNAL_KEY = CORE_INTERNAL_KEY;
const wallet = new FakeWallet();
const core = new FakeCore();
const num = (v: any) => Number(v?.numeric_ ?? v?.value ?? v);

/**
 * K8 PR6b Task 4 — 반품 선환불(수령 없이 RETURN 환불)과 미리보기. 조건부 무료 그룹(50,000 이상 무료 / 3,000), A 30,000.
 * A×2 변심 전량: 품목 값 V 60,000, 택배비 예상 F = 반품비 3,000 + 왕복 3,000 → 기본 54,000.
 * 반품 요청이 열린 동안 선환불엔 크레딧 라인이 붙지 않고 loadOrderView 차액이 +P 가 된다(Task 1 실측) — 수령이 그만큼 상계한다.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: { WALLET_BASE_URL, WALLET_API_KEY: 'test-wallet-key', CORE_SERVICE_URL: CORE_BASE_URL, CORE_INTERNAL_KEY },
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let c: Commerce;
    const ctx = { api, getContainer };
    beforeAll(async () => {
      await wallet.start();
      await core.start();
      c = await setupCommerce(ctx);
      await ensureReturnShippingOption(getContainer());
      await ensureReturnReasons(getContainer());
    });
    afterAll(async () => {
      await wallet.stop();
      await core.stop();
    });
    beforeEach(() => {
      wallet.reset();
      core.reset();
    });

    let seq = 0;
    const rid = (p: string) => `${p}-${++seq}-${Math.random().toString(36).slice(2, 8)}`;
    const yesterday = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const deliveredOrder = async (lines: Array<{ variant: 'A' | 'B' | 'E'; quantity: number }>, delivered?: Array<'A' | 'B' | 'E'>) => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines });
      const o = await loadOrder(getContainer(), orderId);
      const itemOf = (v: 'A' | 'B' | 'E') => o.items.find((i: any) => i.variant_id === c.variants[v]).id as string;
      const deliveredSet = new Set(delivered ?? lines.map((l) => l.variant));
      core.setEligibility(
        orderId,
        o.items
          .filter((i: any) => [...deliveredSet].some((v) => c.variants[v] === i.variant_id))
          .map((i: any) => ({ channelOrderItemId: i.id, deliveredUnits: num(i.quantity), lastDeliveredAt: yesterday() })),
      );
      return { orderId, itemOf };
    };

    const requestReturn = async (orderId: string, itemId: string, quantity: number) =>
      (
        await requestOrderReturn(getContainer(), {
          requestId: rid('ret'),
          orderId,
          items: [{ itemId, quantity }],
          reasonValue: 'change_of_mind',
          requestedBy: 'operator',
        })
      ).returnId;

    /** A×2 배송완료 + A 2개 변심 반품 요청 */
    const requestedReturn = async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }]);
      const returnId = await requestReturn(orderId, itemOf('A'), 2);
      return { orderId, returnId, itemOf };
    };

    const prepay = (orderId: string, returnId: string, body: Record<string, unknown>) =>
      api.post(`/admin/orders/${orderId}/returns/${returnId}/prepay`, body, c.adminHeaders).catch((e: any) => e.response);
    const settle = (orderId: string, returnId: string, body: Record<string, unknown>) =>
      api.post(`/admin/orders/${orderId}/returns/${returnId}/settle`, body, c.adminHeaders).catch((e: any) => e.response);
    const preview = (orderId: string, returnId: string) =>
      api.get(`/admin/orders/${orderId}/returns/${returnId}/settlement-preview`, c.adminHeaders).catch((e: any) => e.response);

    const returnRow = async (returnId: string) => {
      const [r] = await getContainer().resolve(Modules.ORDER).listReturns({ id: returnId }, { select: ['id', 'status', 'metadata'] });
      return r as any;
    };
    const ledgerRefunds = async (orderId: string) => {
      const o = await loadOrder(getContainer(), orderId);
      const paymentId = o.payment_collections[0].payments[0].id as string;
      const p = await getContainer().resolve(Modules.PAYMENT).retrievePayment(paymentId, { relations: ['refunds'] });
      return (p.refunds ?? []).map((r: any) => ({ amount: num(r.amount), note: r.note }));
    };
    const pending = async (orderId: string) => (await loadOrderView(getContainer(), orderId))!.pendingDifference;
    const creditLines = async (orderId: string) => ((await loadOrder(getContainer(), orderId)).credit_lines ?? []).length as number;
    const notPaidCollections = async (orderId: string) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY);
      const { data: [order] } = await query.graph({ entity: 'order', fields: ['id', 'payment_collections.status'], filters: { id: orderId } });
      return (order as any).payment_collections.filter((pc: any) => pc.status === 'not_paid').length as number;
    };

    it('금액 없이 선환불 → V − F 환불, 메모 return-prepay:<id>, kind RETURN, 반품 requested 그대로, 크레딧 라인 0, 차액 +P, NOT_PAID 0', async () => {
      const { orderId, returnId } = await requestedReturn();
      const requestId = rid('prepay');

      const res = await prepay(orderId, returnId, { requestId, memo: '고객 요청 — 먼저 환불' });

      expect(res.status).toBe(200);
      expect(res.data).toEqual({ returnId, requestId, amount: 54000, refund: { mode: 'auto', amount: 54000 }, stage: 'refunded' });
      expect(await ledgerRefunds(orderId)).toEqual([{ amount: 54000, note: `return-prepay:${requestId}` }]);
      expect(wallet.refundCalls().map((x) => x.body.kind)).toEqual(['RETURN']);
      const row = await returnRow(returnId);
      expect(row.status).toBe('requested');
      expect(readReturnPrepayRecord(row.metadata)).toEqual(
        expect.objectContaining({
          requestId,
          stage: 'refunded',
          amount: 54000,
          itemValue: 60000,
          feeEstimate: { returnShipping: 3000, freeShippingBreak: 0, roundTrip: 3000 },
          memo: '고객 요청 — 먼저 환불',
          refundMode: 'auto',
        }),
      );
      // 요청 기록(almondReturn)이 그대로 남는다
      expect(row.metadata.almondReturn).toEqual(expect.objectContaining({ feeBearer: 'customer' }));
      // Task 1 실측: 반품 요청이 열린 동안의 환불엔 크레딧 라인이 없고 차액이 +P 다 — 수령(−60,000)이 상계한다
      expect(await creditLines(orderId)).toBe(0);
      expect(await pending(orderId)).toBe(54000);
      expect(await notPaidCollections(orderId)).toBe(0);
    });

    it('금액 지정 10,000 → 10,000', async () => {
      const { orderId, returnId } = await requestedReturn();

      const res = await prepay(orderId, returnId, { requestId: rid('prepay'), amount: 10000, memo: '일부 먼저' });

      expect(res.status).toBe(200);
      expect(res.data).toEqual(expect.objectContaining({ amount: 10000, refund: { mode: 'auto', amount: 10000 } }));
      expect(wallet.refunds.map((r) => r.amount)).toEqual([10000]);
    });

    it('품목 값 전액(60,000)은 받고, 품목 값보다 큰 금액 → 400 prepay_exceeds_item_value, 환불 0', async () => {
      const { orderId, returnId } = await requestedReturn();

      const res = await prepay(orderId, returnId, { requestId: rid('prepay'), amount: 60001, memo: '많이' });

      expect(res.status).toBe(400);
      expect(res.data).toEqual(
        expect.objectContaining({ type: 'not_allowed', code: 'return_prepay_rejected', reason: 'prepay_exceeds_item_value' }),
      );
      expect(wallet.refundCalls()).toHaveLength(0);
      expect(readReturnPrepayRecord((await returnRow(returnId)).metadata)).toBeNull();

      const full = await prepay(orderId, returnId, { requestId: rid('prepay'), amount: 60000, memo: '전액' });
      expect(full.status).toBe(200);
      expect(wallet.refunds.map((r) => r.amount)).toEqual([60000]);
    });

    it('같은 requestId 두 번 → 환불 1, 두 번째 결과 같음 — 다른 금액이면 400 request_id_conflict', async () => {
      const { orderId, returnId } = await requestedReturn();
      const body = { requestId: rid('prepay'), memo: '먼저' };

      const first = await prepay(orderId, returnId, body);
      const second = await prepay(orderId, returnId, body);
      const conflict = await prepay(orderId, returnId, { ...body, amount: 10000 });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.data).toEqual(first.data);
      expect(conflict.status).toBe(400);
      expect(conflict.data).toEqual(expect.objectContaining({ code: 'return_prepay_rejected', reason: 'request_id_conflict' }));
      expect(wallet.refundCalls()).toHaveLength(1);
    });

    it('환불 응답을 잃어 502 뒤 같은 requestId → 장부 맞추기로 이 메모에 넣고 남은 몫만(0) — wallet 호출 1', async () => {
      const { orderId, returnId } = await requestedReturn();
      const requestId = rid('prepay');
      const body = { requestId, memo: '먼저' };
      wallet.loseNextRefundResponse = true;

      const lost = await prepay(orderId, returnId, body);
      expect(lost.status).toBe(502);
      expect(lost.data).toEqual(expect.objectContaining({ type: 'refund_pending', requestId }));
      expect(readReturnPrepayRecord((await returnRow(returnId)).metadata)?.stage).toBe('requested');
      expect(wallet.refunds).toHaveLength(1);

      const done = await prepay(orderId, returnId, body);
      expect(done.status).toBe(200);
      expect(done.data.refund).toEqual({ mode: 'auto', amount: 54000 });
      expect(wallet.refundCalls()).toHaveLength(1);
      expect(await ledgerRefunds(orderId)).toEqual([{ amount: 54000, note: `return-prepay:${requestId}` }]);
      expect(readReturnPrepayRecord((await returnRow(returnId)).metadata)?.stage).toBe('refunded');
    });

    it('환불 502(돈 안 나감) 뒤 같은 requestId → 기록의 금액을 그대로 낸다', async () => {
      const { orderId, returnId } = await requestedReturn();
      const body = { requestId: rid('prepay'), memo: '먼저' };
      wallet.failNextRefund = true;

      expect((await prepay(orderId, returnId, body)).status).toBe(502);
      expect(wallet.refunds).toHaveLength(0);

      const done = await prepay(orderId, returnId, body);
      expect(done.status).toBe(200);
      expect(wallet.refunds.map((r) => r.amount)).toEqual([54000]);
    });

    it('wallet 영구 거절 → 400 wallet_refund_refused:<code>, 기록 requested — 같은 요청을 수동으로 다시 보내면 끝난다', async () => {
      const { orderId, returnId } = await requestedReturn();
      const requestId = rid('prepay');
      wallet.rejectNextRefundWith = { status: 400, error: 'REFUND_NOT_AUTOMATABLE', message: 'wallet 원문', retryable: false };

      const res = await prepay(orderId, returnId, { requestId, memo: '먼저' });

      expect(res.status).toBe(400);
      expect(res.data).toEqual({
        type: 'not_allowed',
        code: 'wallet_refund_refused:REFUND_NOT_AUTOMATABLE',
        requestId,
        message: 'wallet 원문',
      });
      expect(readReturnPrepayRecord((await returnRow(returnId)).metadata)?.stage).toBe('requested');
      expect(await ledgerRefunds(orderId)).toEqual([]);

      const manual = await prepay(orderId, returnId, { requestId, memo: '먼저', refundMode: 'manual' });
      expect(manual.status).toBe(200);
      expect(manual.data.refund).toEqual({ mode: 'manual', amount: 54000 });
    });

    it('교환 반품 선환불 → 400 return_prepay_rejected(reason exchange_unsupported), 환불 0, 기록 없음', async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }]);
      const { returnId } = await requestOrderReturn(getContainer(), {
        requestId: rid('exr'),
        orderId,
        items: [{ itemId: itemOf('A'), quantity: 1 }],
        reasonValue: 'defective',
        requestedBy: 'operator',
        kind: 'exchange',
      });

      const res = await prepay(orderId, returnId, { requestId: rid('prepay'), memo: '교환 선환불 시도' });

      expect(res.status).toBe(400);
      expect(res.data).toEqual(expect.objectContaining({ code: 'return_prepay_rejected', reason: 'exchange_unsupported' }));
      expect(wallet.refundCalls()).toHaveLength(0);
      const row = await returnRow(returnId);
      expect(row.status).toBe('requested');
      expect(readReturnPrepayRecord(row.metadata)).toBeNull();
    });

    it('정산 끝난 반품에 선환불 → 400 return_already_settled, 환불은 정산 1번뿐', async () => {
      const { orderId, returnId, itemOf } = await requestedReturn();
      expect((await settle(orderId, returnId, { requestId: rid('settle'), items: [{ item_id: itemOf('A'), received: 2, dismissed: 0 }] })).status).toBe(200);

      const res = await prepay(orderId, returnId, { requestId: rid('prepay'), memo: '늦은 선환불' });

      expect(res.status).toBe(400);
      expect(res.data).toEqual(expect.objectContaining({ code: 'return_prepay_rejected', reason: 'return_already_settled' }));
      expect(wallet.refunds.map((r) => r.amount)).toEqual([54000]);
      expect((await ledgerRefunds(orderId)).map((r) => r.note)).toEqual([expect.stringMatching(/^return-settle:/)]);
    });

    it('선환불 응답을 잃고 정산이 돈 뒤 같은 requestId 로 다시 → 200, 금액 = 장부의 선환불 합, 환불 1', async () => {
      // A×2 + B×2 = 120,000 — 정산이 선환불을 아직 빼지 않아도(Task 5 전) 캡처가 모자라지 않게 넉넉히 둔다
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }, { variant: 'B', quantity: 2 }]);
      const returnId = await requestReturn(orderId, itemOf('A'), 2);
      const requestId = rid('prepay');
      const body = { requestId, memo: '먼저' };
      wallet.loseNextRefundResponse = true;

      expect((await prepay(orderId, returnId, body)).status).toBe(502);
      const lost = readReturnPrepayRecord((await returnRow(returnId)).metadata);
      expect(lost?.stage).toBe('requested');
      expect(await settle(orderId, returnId, { requestId: rid('settle'), items: [{ item_id: itemOf('A'), received: 2, dismissed: 0 }] })).toEqual(
        expect.objectContaining({ status: 200 }),
      );
      const callsBefore = wallet.refundCalls().length;

      const retry = await prepay(orderId, returnId, body);

      expect(retry.status).toBe(200);
      expect(retry.data).toEqual({ returnId, requestId, amount: lost!.amount, refund: { mode: 'auto', amount: lost!.amount }, stage: 'refunded' });
      expect(wallet.refundCalls()).toHaveLength(callsBefore);
      expect((await ledgerRefunds(orderId)).filter((r) => r.note === `return-prepay:${requestId}`)).toEqual([
        { amount: lost!.amount, note: `return-prepay:${requestId}` },
      ]);
      expect(readReturnPrepayRecord((await returnRow(returnId)).metadata)).toEqual(
        expect.objectContaining({ stage: 'refunded', amount: lost!.amount }),
      );
    });

    it('환불이 밀린 부분취소가 있어 차액이 음수인 주문 → 400 pending_refund_outstanding, 환불 0', async () => {
      // A×2 배송완료, E 미출고 — E 부분취소의 환불이 502 로 밀려 차액 −10,000 이 남았다
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }, { variant: 'E', quantity: 1 }], ['A']);
      wallet.failNextRefund = true;
      await expect(
        partialCancelOrder(getContainer(), { orderId, requestId: rid('pc'), items: [{ itemId: itemOf('E'), quantity: 1 }] }),
      ).rejects.toThrow();
      expect(await pending(orderId)).toBe(-10000);
      const returnId = await requestReturn(orderId, itemOf('A'), 2);

      const res = await prepay(orderId, returnId, { requestId: rid('prepay'), memo: '먼저' });

      expect(res.status).toBe(400);
      expect(res.data).toEqual(
        expect.objectContaining({
          code: 'return_prepay_rejected',
          reason: 'pending_refund_outstanding',
          // 원 단위로 반올림해 적는다(차액에 할인 안분의 원 미만이 섞일 수 있다)
          message: expect.stringContaining('차액 10000원'),
        }),
      );
      expect(wallet.refunds).toHaveLength(0);
      expect(readReturnPrepayRecord((await returnRow(returnId)).metadata)).toBeNull();
    });

    it('wallet 직접 환불이 있는 주문 → 400 external_refund_unresolved, 환불 0', async () => {
      const { orderId: id, intentId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 2 }] });
      const o = await loadOrder(getContainer(), id);
      core.setEligibility(id, o.items.map((i: any) => ({ channelOrderItemId: i.id, deliveredUnits: num(i.quantity), lastDeliveredAt: yesterday() })));
      const returnId = await requestReturn(id, o.items[0].id, 2);
      wallet.addExternalRefund(intentId, 10000);

      const res = await prepay(id, returnId, { requestId: rid('prepay'), memo: '먼저' });

      expect(res.status).toBe(400);
      expect(res.data).toEqual(expect.objectContaining({ code: 'return_prepay_rejected', reason: 'external_refund_unresolved' }));
      expect(wallet.refundCalls()).toHaveLength(0);
    });

    it('미리보기가 선환불 기본값과 같은 숫자를 준다, 선환불 뒤 prepaidAmount', async () => {
      const { orderId, returnId } = await requestedReturn();

      const before = await preview(orderId, returnId);
      expect(before.status).toBe(200);
      expect(before.data).toEqual({
        itemValue: 60000,
        feeEstimate: { returnShipping: 3000, freeShippingBreak: 0, roundTrip: 3000 },
        defaultPrepayAmount: 54000,
        prepaidAmount: 0,
      });

      const res = await prepay(orderId, returnId, { requestId: rid('prepay'), memo: '먼저' });
      expect(res.data.amount).toBe(before.data.defaultPrepayAmount);

      const after = await preview(orderId, returnId);
      expect(after.status).toBe(200);
      expect(after.data).toEqual({ ...before.data, prepaidAmount: 54000 });
    });

    it('미리보기 — 다른 주문의 반품 id 는 404, 정산 끝난 반품은 400 return_already_settled', async () => {
      const { orderId, returnId, itemOf } = await requestedReturn();
      const other = await deliveredOrder([{ variant: 'A', quantity: 1 }]);
      expect((await preview(other.orderId, returnId)).status).toBe(404);

      expect((await settle(orderId, returnId, { requestId: rid('settle'), items: [{ item_id: itemOf('A'), received: 2, dismissed: 0 }] })).status).toBe(200);
      const res = await preview(orderId, returnId);
      expect(res.status).toBe(400);
      expect(res.data).toEqual(expect.objectContaining({ code: 'return_prepay_rejected', reason: 'return_already_settled' }));
    });

    it('본문이 틀리면 400 invalid_data — memo 공백, amount 0', async () => {
      const { orderId, returnId } = await requestedReturn();
      for (const body of [{ requestId: rid('prepay'), memo: '  ' }, { requestId: rid('prepay'), memo: '먼저', amount: 0 }]) {
        const res = await prepay(orderId, returnId, body);
        expect(res.status).toBe(400);
        expect(res.data.type).toBe('invalid_data');
      }
      expect(wallet.refundCalls()).toHaveLength(0);
    });
  },
});
