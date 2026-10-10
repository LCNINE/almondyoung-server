// apps/medusa/integration-tests/http/cancel-refund-refusal.spec.ts
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
      expect(transient.data.refundFailure).toBeUndefined();
    });
  },
});
