// apps/medusa/integration-tests/http/cancel-refund-refusal.spec.ts
import { beginOrderEditOrderWorkflow } from '@medusajs/medusa/core-flows';
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { FakeWallet, WALLET_BASE_URL, setupCommerce, placeOrder, loadOrder, Commerce } from './fixtures/partial-cancel-fixture';

jest.setTimeout(300 * 1000);
process.env.WALLET_BASE_URL = WALLET_BASE_URL;
process.env.WALLET_API_KEY = 'test-wallet-key';
const wallet = new FakeWallet();

/**
 * wallet 영구 환불 거절의 갈 길(#1016 36번 스펙 §1.3·§4.3·§4.6).
 * 기본 /cancel 은 환불 오류를 삼킨다 — 특성 테스트로 고정해 Medusa 를 올릴 때 바뀌면 알게 한다.
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

    it('특성: 기본 /cancel 은 wallet 거절을 삼켜 200 + canceled + 환불 0건 — Medusa 업그레이드로 바뀌면 이 테스트가 알린다', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 1 }] });
      wallet.rejectNextRefundWith = { status: 400, error: 'REFUND_NOT_AUTOMATABLE' };
      const res = await api.post(`/admin/orders/${orderId}/cancel`, {}, c.adminHeaders).catch((e: any) => e.response);
      expect(res.status).toBe(200);
      expect((await loadOrder(getContainer(), orderId)).status).toBe('canceled');
      expect(wallet.refunds).toHaveLength(0);
      expect(wallet.callsTo('/refund')).toBe(1);
    });

    it('부분취소 라우트: 영구 거절이면 502 refund_pending 에 refundFailure, 일시 실패면 없다', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
      const item = (await loadOrder(getContainer(), orderId)).items[0].id;
      const post = (requestId: string) =>
        api
          .post(`/admin/orders/${orderId}/partial-cancel`, { requestId, items: [{ item_id: item, quantity: 1 }] }, c.adminHeaders)
          .catch((e: any) => e.response);

      wallet.rejectNextRefundWith = { status: 400, error: 'REFUND_AMOUNT_EXCEEDS_TOTAL' };
      const refused = await post('r-refusal-1');
      expect(refused.status).toBe(502);
      expect(refused.data).toEqual(
        expect.objectContaining({
          type: 'refund_pending',
          stage: 'edited',
          refundFailure: { kind: 'ledger_mismatch', walletCode: 'REFUND_AMOUNT_EXCEEDS_TOTAL' },
        }),
      );

      wallet.failNextRefund = true;
      const transient = await post('r-refusal-1');
      expect(transient.status).toBe(502);
      expect(transient.data.type).toBe('refund_pending');
      expect(transient.data.refundFailure).toBeUndefined();
    });

    const num = (v: any) => Number(v?.numeric_ ?? v?.value ?? v);
    const channelCancel = (orderId: string) =>
      api.post(`/admin/orders/${orderId}/channel-cancel`, {}, c.adminHeaders).catch((e: any) => e.response);

    it.each([
      [400, 'REFUND_NOT_AUTOMATABLE', 'refused'],
      [400, 'REFUND_AMOUNT_EXCEEDS_TOTAL', 'ledger_mismatch'],
      [404, 'REFUNDABLE_CHARGE_NOT_FOUND', 'ledger_mismatch'],
    ])('채널 취소: wallet %s %s → 400 not_allowed + code wallet_refund_%s, 주문은 취소되지 않는다', async (status, walletCode, kind) => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 1 }] });
      wallet.rejectNextRefundWith = { status, error: walletCode };
      const res = await channelCancel(orderId);
      expect(res.status).toBe(400);
      expect(res.data).toEqual(expect.objectContaining({ type: 'not_allowed', code: `wallet_refund_${kind}:${walletCode}` }));
      expect(res.data.message).toContain(walletCode);
      expect((await loadOrder(getContainer(), orderId)).status).not.toBe('canceled');
      expect(wallet.refunds).toHaveLength(0);
    });

    it('채널 취소: wallet 502 는 500 이고 주문은 취소되지 않는다 — 기본 /cancel 과 반대', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 1 }] });
      wallet.failNextRefund = true;
      const res = await channelCancel(orderId);
      expect(res.status).toBe(500);
      expect((await loadOrder(getContainer(), orderId)).status).not.toBe('canceled');
      expect(wallet.refunds).toHaveLength(0);
    });

    it('채널 취소: 정상이면 환불 한 번 뒤 취소하고 장부 차액은 0 — 크레딧 라인이 두 번 붙지 않는다', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 1 }] });
      const res = await channelCancel(orderId);
      expect(res.status).toBe(200);
      expect(res.data).toEqual({ orderId, status: 'canceled' });
      const o = await loadOrder(getContainer(), orderId);
      expect(o.status).toBe('canceled');
      expect(wallet.refunds).toHaveLength(1);
      expect(num(o.summary.pending_difference)).toBe(0);
    });

    it('채널 취소: 거절 뒤 원인이 풀리면 같은 호출이 끝난다 — 다시 보내기의 출구', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 1 }] });
      wallet.rejectNextRefundWith = { status: 400, error: 'REFUND_NOT_AUTOMATABLE' };
      expect((await channelCancel(orderId)).status).toBe(400);
      expect((await channelCancel(orderId)).status).toBe(200);
      expect((await loadOrder(getContainer(), orderId)).status).toBe('canceled');
      expect(wallet.refunds).toHaveLength(1);
    });

    it('채널 취소: 이미 취소된 주문은 코어와 같은 문장의 400 — channel-adapter 가 «이미 취소됨 = 성공»으로 읽는다, 다시 환불하지 않는다', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 1 }] });
      expect((await channelCancel(orderId)).status).toBe(200);
      const again = await channelCancel(orderId);
      expect(again.status).toBe(400);
      expect(again.data.message).toBe(`Order with id ${orderId} has been canceled.`);
      expect(wallet.refunds).toHaveLength(1);
    });

    it('채널 취소: 진행 중인 주문 변경이 있으면 환불 전에 400 — 환불의 크레딧 라인 단계가 돈이 나간 뒤 실패하지 않게', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 1 }] });
      await beginOrderEditOrderWorkflow(getContainer()).run({ input: { order_id: orderId } });
      const res = await channelCancel(orderId);
      expect(res.status).toBe(400);
      expect(res.data.type).toBe('not_allowed');
      expect(wallet.callsTo('/refund')).toBe(0);
      expect((await loadOrder(getContainer(), orderId)).status).not.toBe('canceled');
    });

    it('채널 취소: 취소 안 된 출고가 있으면 환불 전에 400', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 1 }] });
      const item = (await loadOrder(getContainer(), orderId)).items[0];
      await api.post(`/admin/orders/${orderId}/fulfillments`, { items: [{ id: item.id, quantity: 1 }] }, c.adminHeaders);
      const res = await channelCancel(orderId);
      expect(res.status).toBe(400);
      expect(res.data.type).toBe('not_allowed');
      expect(wallet.callsTo('/refund')).toBe(0);
      expect((await loadOrder(getContainer(), orderId)).status).not.toBe('canceled');
    });

    it('채널 취소: 없는 주문은 404 not_found', async () => {
      const res = await channelCancel('order_missing_1016_36');
      expect(res.status).toBe(404);
      expect(res.data.type).toBe('not_found');
    });
  },
});
