// apps/medusa/integration-tests/http/channel-cancel-settlement.spec.ts
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { Modules } from '@medusajs/framework/utils';
import { beginOrderEditOrderWorkflow, cancelOrderWorkflow, refundPaymentWorkflow } from '@medusajs/medusa/core-flows';
import { readManualRefund, readRefundAttempt } from '../../src/modules/almond-payment/refund-data';
import { FakeWallet, WALLET_BASE_URL, setupCommerce, placeOrder, loadOrder, Commerce } from './fixtures/partial-cancel-fixture';

jest.setTimeout(300 * 1000);
process.env.WALLET_BASE_URL = WALLET_BASE_URL;
process.env.WALLET_API_KEY = 'test-wallet-key';
const wallet = new FakeWallet();
const num = (v: any) => Number(v?.numeric_ ?? v?.value ?? v);

/**
 * 채널 전체취소 정산(#1016 36번 재설계 스펙 §6.1~§6.4, §10 Medusa). 주문은 A 1개(30,000) + 조건부 배송비 3,000 — 캡처액은 ledger() 로 읽는다.
 * 순서는 «주문 잠금 → 검증 → ① 장부 맞추기 → ② 남은 몫 환불 → ③ 기본 취소». 기본 /cancel 은 특성 테스트로 고정한다(업그레이드 경보).
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: { WALLET_BASE_URL, WALLET_API_KEY: 'test-wallet-key' },
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let c: Commerce;
    const ctx = { api, getContainer };
    beforeAll(async () => {
      await wallet.start();
      c = await setupCommerce(ctx);
    });
    afterAll(async () => wallet.stop());
    beforeEach(() => wallet.reset());

    const place = () => placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 1 }] });
    const order = (orderId: string) => loadOrder(getContainer(), orderId);
    const channelCancel = (orderId: string, body: Record<string, unknown> = {}) =>
      api.post(`/admin/orders/${orderId}/channel-cancel`, body, c.adminHeaders).catch((e: any) => e.response);
    /** 결제의 장부(메모 포함) — loadOrder 의 graph 는 note 를 읽지 않는다 */
    const ledger = async (orderId: string) => {
      const paymentId = (await order(orderId)).payment_collections[0].payments[0].id as string;
      const p = await getContainer().resolve(Modules.PAYMENT).retrievePayment(paymentId, { select: ['id', 'data'], relations: ['captures', 'refunds'] });
      return {
        paymentId,
        data: p.data as Record<string, unknown>,
        captured: (p.captures ?? []).reduce((s: number, x: any) => s + num(x.amount), 0),
        refunds: (p.refunds ?? []).map((r: any) => ({ amount: num(r.amount), note: r.note })),
      };
    };

    describe('결과', () => {
      it('정상: 환불 한 번 뒤 취소하고 장부 차액은 0 — 크레딧 라인이 두 번 붙지 않는다', async () => {
        const { orderId } = await place();
        const { captured } = await ledger(orderId);
        const res = await channelCancel(orderId);
        expect(res.status).toBe(200);
        expect(res.data).toEqual({ orderId, status: 'canceled', refund: { mode: 'auto', amount: captured } });
        const o = await order(orderId);
        expect(o.status).toBe('canceled');
        expect(wallet.refunds.map((r) => r.amount)).toEqual([captured]);
        expect(num(o.summary.pending_difference)).toBe(0);
        expect(o.credit_lines.reduce((s: number, l: any) => s + num(l.amount), 0)).toBe(captured);
        const after = await ledger(orderId);
        expect(after.refunds).toEqual([{ amount: captured, note: `channel-cancel:${orderId}` }]);
        expect(readRefundAttempt(after.data)).toBeNull();
      });

      it.each([
        [400, 'REFUND_NOT_AUTOMATABLE'],
        [400, 'MEMBERSHIP_REFUND_NOT_ALLOWED'],
        [404, 'REFUNDABLE_CHARGE_NOT_FOUND'],
      ])('영구 거절: wallet %s %s(retryable false) → 400 표지, 주문은 취소되지 않고 장부에 환불이 없다', async (status, error) => {
        const { orderId } = await place();
        wallet.rejectNextRefundWith = { status, error, message: 'wallet 원문', retryable: false };
        const res = await channelCancel(orderId);
        expect(res.status).toBe(400);
        expect(res.data).toEqual(expect.objectContaining({ type: 'not_allowed', code: `wallet_refund_refused:${error}`, message: 'wallet 원문' }));
        expect((await order(orderId)).status).not.toBe('canceled');
        expect((await ledger(orderId)).refunds).toEqual([]);
        expect(wallet.refunds).toHaveLength(0);
      });

      it('영구 거절: 200 의 FAILED 행(retryable false)은 그 failureCode 와 토스 문장으로', async () => {
        const { orderId } = await place();
        wallet.failNextRefundAs200Failed = { failureCode: 'NOT_CANCELABLE_AMOUNT', retryable: false, message: '취소 할 수 없는 금액 입니다.' };
        const res = await channelCancel(orderId);
        expect(res.status).toBe(400);
        expect(res.data).toEqual(
          expect.objectContaining({ type: 'not_allowed', code: 'wallet_refund_refused:NOT_CANCELABLE_AMOUNT', message: '취소 할 수 없는 금액 입니다.' }),
        );
        expect((await order(orderId)).status).not.toBe('canceled');
      });

      it.each<[string, () => void]>([
        ['wallet 502', () => { wallet.failNextRefund = true; }],
        ['맞춘 뒤의 금액 초과(retryable true) — 경합', () => { wallet.rejectNextRefundWith = { status: 400, error: 'REFUND_AMOUNT_EXCEEDS_TOTAL', retryable: true }; }],
        ['retryable 없는 400(ValidationPipe)', () => { wallet.rejectNextRefundWith = { status: 400, error: 'Bad Request' }; }],
        ['분류 전 FAILED 행(retryable null)', () => { wallet.failNextRefundAs200Failed = true; }],
      ])('일시: %s → 500, 주문은 취소되지 않고, 다시 부르면 끝낸다', async (_, inject) => {
        const { orderId } = await place();
        inject();
        expect((await channelCancel(orderId)).status).toBe(500);
        expect((await order(orderId)).status).not.toBe('canceled');
        expect((await ledger(orderId)).refunds).toEqual([]);
        expect((await channelCancel(orderId)).status).toBe(200);
        expect((await order(orderId)).status).toBe('canceled');
        expect(wallet.refunds).toHaveLength(1);
      });

      it('이미 취소된 주문은 코어와 같은 문장의 400 — channel-adapter 가 «이미 취소됨 = 성공»으로 읽는다, 다시 환불하지 않는다', async () => {
        const { orderId } = await place();
        expect((await channelCancel(orderId)).status).toBe(200);
        const again = await channelCancel(orderId);
        expect(again.status).toBe(400);
        expect(again.data.message).toBe(`Order with id ${orderId} has been canceled.`);
        expect(wallet.refunds).toHaveLength(1);
      });

      it('진행 중인 주문 변경이 있으면 환불 전에 400 — 환불의 크레딧 라인 단계가 돈이 나간 뒤 실패하지 않게', async () => {
        const { orderId } = await place();
        await beginOrderEditOrderWorkflow(getContainer()).run({ input: { order_id: orderId } });
        const res = await channelCancel(orderId);
        expect(res.status).toBe(400);
        expect(res.data.type).toBe('not_allowed');
        expect(wallet.refundCalls()).toHaveLength(0);
        expect((await order(orderId)).status).not.toBe('canceled');
      });

      it('이 경로로 돈이 이미 나간 뒤의 재시도는 사전검사 거절도 500 — 요청이 «취소 불가»로 닫히지 않게', async () => {
        const { orderId } = await place();
        const { paymentId, captured } = await ledger(orderId);
        // 첫 시도가 환불까지 하고 취소 전에 끊긴 상태 — 그 사이 주문 변경이 열렸다
        await refundPaymentWorkflow(getContainer()).run({ input: { payment_id: paymentId, amount: captured, note: `channel-cancel:${orderId}` } });
        await beginOrderEditOrderWorkflow(getContainer()).run({ input: { order_id: orderId } });
        const res = await channelCancel(orderId);
        expect(res.status).toBe(500);
        expect((await order(orderId)).status).not.toBe('canceled');
        expect(wallet.refunds).toHaveLength(1);
      });

      it('응답을 잃은 환불 뒤의 재시도도 사전검사 거절이면 500 — 장부엔 없어도 wallet 에선 나갔다', async () => {
        const { orderId } = await place();
        wallet.loseNextRefundResponse = true;
        expect((await channelCancel(orderId)).status).toBe(500);
        expect((await ledger(orderId)).refunds).toEqual([]); // Medusa 는 자기 환불 행을 지웠다 — 흔적은 wallet 과 시도 표식뿐
        await beginOrderEditOrderWorkflow(getContainer()).run({ input: { order_id: orderId } });
        const res = await channelCancel(orderId);
        expect(res.status).toBe(500);
        expect((await order(orderId)).status).not.toBe('canceled');
        expect(wallet.refundCalls()).toHaveLength(1);
        expect(wallet.refunds).toHaveLength(1);
      });

      it('PG 결과가 안 난 자동 PENDING 뒤의 재시도도 사전검사 거절이면 500 — 돈이 나갔을 수 있다(D8)', async () => {
        const { orderId } = await place();
        wallet.loseNextRefundResponseInFlight = true;
        expect((await channelCancel(orderId)).status).toBe(500);
        await beginOrderEditOrderWorkflow(getContainer()).run({ input: { order_id: orderId } });
        const res = await channelCancel(orderId);
        expect(res.status).toBe(500);
        expect((await order(orderId)).status).not.toBe('canceled');
        expect(wallet.refundCalls()).toHaveLength(1);
      });

      it('영구 거절 뒤(시도 표식만 남고 돈은 안 나감) 주문 변경이 열리면 재시도는 그대로 400 — 표식만으로 500 루프에 빠지지 않는다', async () => {
        const { orderId } = await place();
        wallet.rejectNextRefundWith = { status: 400, error: 'REFUND_NOT_AUTOMATABLE', retryable: false };
        expect((await channelCancel(orderId)).status).toBe(400);
        expect(readRefundAttempt((await ledger(orderId)).data)).not.toBeNull();
        await beginOrderEditOrderWorkflow(getContainer()).run({ input: { order_id: orderId } });
        const res = await channelCancel(orderId);
        expect(res.status).toBe(400);
        expect(res.data.type).toBe('not_allowed');
        expect(wallet.refundCalls()).toHaveLength(1);
        expect(wallet.refunds).toHaveLength(0);
      });

      it('취소 안 된 출고가 있으면 환불 전에 400', async () => {
        const { orderId } = await place();
        const item = (await order(orderId)).items[0];
        await api.post(`/admin/orders/${orderId}/fulfillments`, { items: [{ id: item.id, quantity: 1 }] }, c.adminHeaders);
        const res = await channelCancel(orderId);
        expect(res.status).toBe(400);
        expect(res.data.type).toBe('not_allowed');
        expect(wallet.refundCalls()).toHaveLength(0);
      });

      it('없는 주문은 404 not_found, 잘못된 refundMode 는 400 invalid_data', async () => {
        const missing = await channelCancel('order_missing_1016_36');
        expect(missing.status).toBe(404);
        expect(missing.data.type).toBe('not_found');
        const { orderId } = await place();
        const bad = await channelCancel(orderId, { refundMode: 'MANUAL' });
        expect(bad.status).toBe(400);
        expect(bad.data.type).toBe('invalid_data');
        expect(wallet.refundCalls()).toHaveLength(0);
      });
    });

    describe('장부 맞추기 (§6.2)', () => {
      it('투영 안 된 외부 환불은 장부에 넣고 남은 몫만 환불한다', async () => {
        const { orderId, intentId } = await place();
        const { captured } = await ledger(orderId);
        const ext = wallet.addExternalRefund(intentId, 10000);
        const res = await channelCancel(orderId);
        expect(res.status).toBe(200);
        expect(res.data.refund).toEqual({ mode: 'auto', amount: captured - 10000 });
        expect(wallet.refundCalls().map((x) => x.body.amount)).toEqual([captured - 10000]);
        const after = await ledger(orderId);
        expect(after.refunds).toHaveLength(2);
        expect(after.refunds).toEqual(
          expect.arrayContaining([
            { amount: 10000, note: `wallet:${ext.id}` },
            { amount: captured - 10000, note: `channel-cancel:${orderId}` },
          ]),
        );
        const o = await order(orderId);
        expect(o.status).toBe('canceled');
        expect(num(o.summary.pending_difference)).toBe(0);
      });

      it('응답을 잃은 MEDUSA_REFUND 는 다시 나가지 않는다 — 시도 표식의 메모로 장부에 들어간다', async () => {
        const { orderId } = await place();
        const { captured } = await ledger(orderId);
        wallet.loseNextRefundResponse = true;
        expect((await channelCancel(orderId)).status).toBe(500);
        expect(wallet.refunds).toHaveLength(1); // 돈은 나갔다
        const mid = await ledger(orderId);
        expect(mid.refunds).toEqual([]); // Medusa 는 실패로 보고 자기 환불 행을 지웠다
        expect(readRefundAttempt(mid.data)).toEqual({ note: `channel-cancel:${orderId}`, amount: captured });
        expect((await order(orderId)).status).not.toBe('canceled');

        const res = await channelCancel(orderId);
        expect(res.status).toBe(200);
        expect(res.data.refund).toEqual({ mode: 'auto', amount: captured });
        expect(wallet.refundCalls()).toHaveLength(1); // 재시도는 wallet 에 환불을 다시 요청하지 않았다
        const after = await ledger(orderId);
        expect(after.refunds).toEqual([{ amount: captured, note: `channel-cancel:${orderId}` }]);
        expect(readRefundAttempt(after.data)).toBeNull();
        expect((await order(orderId)).status).toBe('canceled');
      });
    });

    describe('진행 중인 자동 환불 (D8 — 멈춘 자동 PENDING 을 «환불 완료»로 넣지 않는다)', () => {
      it('PG 결과가 안 난 자동 PENDING 은 장부에 넣지 않고 500 으로 기다린다 — 끝나면(SUCCEEDED) 이 메모로 넣고 취소한다', async () => {
        const { orderId } = await place();
        const { captured } = await ledger(orderId);
        wallet.loseNextRefundResponseInFlight = true;
        expect((await channelCancel(orderId)).status).toBe(500);
        expect(wallet.refunds).toEqual([
          expect.objectContaining({ amount: captured, status: 'PENDING', execution: 'AUTO', reasonCode: 'MEDUSA_REFUND' }),
        ]);

        // 재시도: 맞추기가 진행 중인 행을 보고 멈춘다 — 넣으면 «캡처 − 환불» = 0 이라 PG 가 실패해도 «환불 완료»로 취소된다
        expect((await channelCancel(orderId)).status).toBe(500);
        const mid = await ledger(orderId);
        expect(mid.refunds).toEqual([]);
        expect(readRefundAttempt(mid.data)).toEqual({ note: `channel-cancel:${orderId}`, amount: captured });
        expect((await order(orderId)).status).not.toBe('canceled');
        expect(wallet.refundCalls()).toHaveLength(1);

        // wallet 이 PG 결과로 행을 끝낸다
        wallet.refunds[0].status = 'SUCCEEDED';
        const res = await channelCancel(orderId);
        expect(res.status).toBe(200);
        expect(res.data.refund).toEqual({ mode: 'auto', amount: captured });
        const after = await ledger(orderId);
        expect(after.refunds).toEqual([{ amount: captured, note: `channel-cancel:${orderId}` }]);
        expect(readRefundAttempt(after.data)).toBeNull();
        expect((await order(orderId)).status).toBe('canceled');
        expect(wallet.refundCalls()).toHaveLength(1);
      });
    });

    describe('남은 표식 정규화 — 앞 시도가 죽으며 남긴 표식이 이번 환불을 바꾸지 않는다', () => {
      const leaveMarker = async (orderId: string, data: Record<string, unknown>) => {
        const { paymentId } = await ledger(orderId);
        await getContainer().resolve(Modules.PAYMENT).updatePayment({ id: paymentId, data } as any);
      };

      it('같은 금액의 수동 표식이 남아 있어도 자동 시도는 MANUAL 로 새지 않는다', async () => {
        const { orderId } = await place();
        const { captured } = await ledger(orderId);
        await leaveMarker(orderId, { manualRefund: { requestId: `channel-cancel:${orderId}`, amount: captured } });
        expect((await channelCancel(orderId)).status).toBe(200);
        expect(wallet.refundCalls().map((x) => x.body.execution)).toEqual([undefined]);
        expect(wallet.refunds).toEqual([expect.objectContaining({ amount: captured, status: 'SUCCEEDED', execution: 'AUTO' })]);
        expect(readManualRefund((await ledger(orderId)).data)).toBeNull();
      });

      it('같은 금액의 외부 환불 표식이 남아 있어도 wallet 을 부른다 — 나가지 않은 환불이 장부에 들어가지 않는다', async () => {
        const { orderId } = await place();
        const { captured } = await ledger(orderId);
        await leaveMarker(orderId, { externalRefund: { walletRefundId: 'wr_stale', amount: captured } });
        expect((await channelCancel(orderId)).status).toBe(200);
        expect(wallet.refundCalls()).toHaveLength(1);
        expect(wallet.refunds).toEqual([expect.objectContaining({ amount: captured, status: 'SUCCEEDED' })]);
      });
    });

    describe('수동 환불 (§6.3)', () => {
      it('refundMode manual → wallet 송금 대기(PENDING·MANUAL), 주문 취소, 차액 0, 수동 표식은 null', async () => {
        const { orderId } = await place();
        const { captured } = await ledger(orderId);
        const res = await channelCancel(orderId, { refundMode: 'manual' });
        expect(res.status).toBe(200);
        expect(res.data).toEqual({ orderId, status: 'canceled', refund: { mode: 'manual', amount: captured } });
        expect(wallet.refundCalls().map((x) => x.body.execution)).toEqual(['MANUAL']);
        expect(wallet.refunds).toEqual([expect.objectContaining({ amount: captured, status: 'PENDING', execution: 'MANUAL' })]);
        const o = await order(orderId);
        expect(o.status).toBe('canceled');
        expect(num(o.summary.pending_difference)).toBe(0);
        expect(readManualRefund((await ledger(orderId)).data)).toBeNull();
      });

      it('자동이 영구 거절된 주문을 수동으로 다시 부르면 끝난다(스모크 S1 → S2)', async () => {
        const { orderId } = await place();
        wallet.rejectNextRefundWith = { status: 400, error: 'REFUND_NOT_AUTOMATABLE', retryable: false };
        expect((await channelCancel(orderId)).status).toBe(400);
        const res = await channelCancel(orderId, { refundMode: 'manual' });
        expect(res.status).toBe(200);
        expect((await order(orderId)).status).toBe('canceled');
        expect(wallet.refunds).toEqual([expect.objectContaining({ status: 'PENDING', execution: 'MANUAL' })]);
      });

      it('수동 시도가 일시 실패하면 수동 표식을 지운다 — 다음 자동 시도가 MANUAL 로 새지 않는다', async () => {
        const { orderId } = await place();
        wallet.failNextRefund = true;
        expect((await channelCancel(orderId, { refundMode: 'manual' })).status).toBe(500);
        expect(readManualRefund((await ledger(orderId)).data)).toBeNull();
        expect((await channelCancel(orderId)).status).toBe(200);
        expect(wallet.refundCalls().map((x) => x.body.execution)).toEqual(['MANUAL', undefined]);
        expect(wallet.refunds).toEqual([expect.objectContaining({ status: 'SUCCEEDED', execution: 'AUTO' })]);
      });

      it('수동 응답을 잃어도 재시도에 송금 대기가 두 줄 생기지 않는다', async () => {
        const { orderId } = await place();
        wallet.loseNextRefundResponse = true;
        expect((await channelCancel(orderId, { refundMode: 'manual' })).status).toBe(500);
        expect((await channelCancel(orderId, { refundMode: 'manual' })).status).toBe(200);
        expect(wallet.refundCalls()).toHaveLength(1);
        expect(wallet.refunds).toEqual([expect.objectContaining({ status: 'PENDING', execution: 'MANUAL' })]);
        expect((await order(orderId)).status).toBe('canceled');
      });
    });

    describe('멱등 — 리컨실러 재발행의 전제', () => {
      it('같은 주문에 동시에 두 번 → 환불 한 번(하나는 200, 하나는 «이미 취소됨» 400)', async () => {
        const { orderId } = await place();
        const [a, b] = await Promise.all([channelCancel(orderId), channelCancel(orderId)]);
        expect([a.status, b.status].sort()).toEqual([200, 400]);
        expect(wallet.refunds).toHaveLength(1);
      });
    });

    describe('특성: 기본 취소 워크플로 (Medusa 2.13.4 — 업그레이드로 바뀌면 스펙 §6.1 순서·§6.6 미들웨어를 재검토)', () => {
      it('wallet 영구 거절에도 canceled + Refund 0 + 환불 거래 −X(유령) — 장부 차액은 +X 로 뒤집힌다', async () => {
        const { orderId } = await place();
        const { captured } = await ledger(orderId);
        wallet.rejectNextRefundWith = { status: 400, error: 'REFUND_NOT_AUTOMATABLE', retryable: false };
        await cancelOrderWorkflow(getContainer()).run({ input: { order_id: orderId } });
        const o = await order(orderId);
        expect(o.status).toBe('canceled');
        expect((await ledger(orderId)).refunds).toEqual([]);
        expect(wallet.refunds).toHaveLength(0);
        expect(wallet.refundCalls()).toHaveLength(1);
        const txs = await getContainer().resolve(Modules.ORDER).listOrderTransactions({ order_id: orderId });
        const refundTx = txs.filter((t: any) => t.reference === 'refund').reduce((s: number, t: any) => s + num(t.amount), 0);
        expect(refundTx).toBe(-captured);
        expect(num(o.summary.pending_difference)).toBe(captured);
      });
    });

    describe('미들웨어 §6.6 — 대시보드 함정', () => {
      it('결제가 있는 주문의 기본 /cancel 은 400 — 주문·wallet 그대로', async () => {
        const { orderId } = await place();
        const res = await api.post(`/admin/orders/${orderId}/cancel`, {}, c.adminHeaders).catch((e: any) => e.response);
        expect(res.status).toBe(400);
        expect(res.data.code).toBe('default_cancel_blocked');
        expect((await order(orderId)).status).not.toBe('canceled');
        expect(wallet.refundCalls()).toHaveLength(0);
      });

      it('정산 라우트(channel-cancel)는 지나간다', async () => {
        const { orderId } = await place();
        const res = await channelCancel(orderId);
        expect(res.status).toBe(200);
        expect((await order(orderId)).status).toBe('canceled');
      });

      it('취소된 주문의 기본 환불은 400 — wallet 을 부르지 않는다', async () => {
        const { orderId } = await place();
        await channelCancel(orderId);
        const { paymentId } = await ledger(orderId);
        const before = wallet.refundCalls().length;
        const res = await api.post(`/admin/payments/${paymentId}/refund`, { amount: 1000 }, c.adminHeaders).catch((e: any) => e.response);
        expect(res.status).toBe(400);
        expect(res.data.code).toBe('refund_on_canceled_order');
        expect(wallet.refundCalls()).toHaveLength(before);
      });

      it('살아 있는 주문의 기본 환불은 그대로 된다', async () => {
        const { orderId } = await place();
        const { paymentId } = await ledger(orderId);
        const res = await api.post(`/admin/payments/${paymentId}/refund`, { amount: 1000 }, c.adminHeaders).catch((e: any) => e.response);
        expect(res.status).toBe(200);
      });
    });
  },
});
