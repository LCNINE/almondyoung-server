import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { readExternalRefund, readWalletRefundIds } from '../../src/modules/almond-payment/refund-data';
import { handleRefundProjection } from '../../src/api/hooks/payment-events/route';
import { FakeWallet, WALLET_BASE_URL, setupCommerce, placeOrder, loadOrder, Commerce } from './fixtures/partial-cancel-fixture';

jest.setTimeout(300 * 1000);
process.env.WALLET_BASE_URL = WALLET_BASE_URL;
process.env.WALLET_API_KEY = 'test-wallet-key';
const wallet = new FakeWallet();
const num = (v: any) => Number(v?.numeric_ ?? v?.value ?? v);
const logger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

medusaIntegrationTestRunner({
  inApp: true,
  env: { WALLET_BASE_URL, WALLET_API_KEY: 'test-wallet-key' },
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let c: Commerce;
    const ctx = { api, getContainer };
    beforeAll(async () => { await wallet.start(); c = await setupCommerce(ctx); });
    afterAll(async () => wallet.stop());
    beforeEach(() => wallet.reset());

    const refundsOf = async (orderId: string) =>
      (await loadOrder(getContainer(), orderId)).payment_collections[0].payments[0].refunds.map((r: any) => num(r.amount));

    it('외부 wallet 환불은 Medusa 환불 레코드가 되고 wallet 은 다시 불리지 않는다', async () => {
      const { orderId, intentId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'C', quantity: 1 }] });
      await handleRefundProjection(getContainer(), intentId, 13000, 'msg-ext-1', orderId, logger, { refundId: 'wr-ext-1', reasonCode: 'ADMIN_REFUND' });

      expect(await refundsOf(orderId)).toEqual([13000]);
      expect(wallet.callsTo('/refund')).toBe(0);

      // 표식이 남으면 같은 금액의 다음 Medusa 환불이 wallet 을 건너뛴다 — 병합 갱신이라 null 로 지워야 한다
      const data = (await loadOrder(getContainer(), orderId)).payment_collections[0].payments[0].data;
      expect(readExternalRefund(data)).toBeNull();
      expect(readWalletRefundIds(data)).toContain('wr-ext-1');
    });

    it('같은 사실이 두 번 와도 한 번만 기록한다', async () => {
      const { orderId, intentId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'C', quantity: 1 }] });
      for (const m of ['msg-dup-1', 'msg-dup-2']) {
        await handleRefundProjection(getContainer(), intentId, 13000, m, orderId, logger, { refundId: 'wr-dup', reasonCode: 'ADMIN_REFUND' });
      }
      expect(await refundsOf(orderId)).toEqual([13000]);
    });

    it('Medusa 가 낸 환불의 사실은 기록하지 않는다 (reasonCode)', async () => {
      const { orderId, intentId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'C', quantity: 1 }] });
      await handleRefundProjection(getContainer(), intentId, 13000, 'msg-own', orderId, logger, { refundId: 'wr-own', reasonCode: 'MEDUSA_REFUND' });
      expect(await refundsOf(orderId)).toEqual([]);
    });

    it('외부 환불을 기록한 뒤 코어 취소는 wallet 환불을 다시 부르지 않는다 (35번의 이중 시도 제거)', async () => {
      const { orderId, intentId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'C', quantity: 1 }] });
      await handleRefundProjection(getContainer(), intentId, 13000, 'msg-pre', orderId, logger, { refundId: 'wr-pre', reasonCode: 'ADMIN_REFUND' });

      await api.post(`/admin/orders/${orderId}/cancel`, {}, c.adminHeaders);

      expect(wallet.callsTo('/refund')).toBe(0);
      expect((await loadOrder(getContainer(), orderId)).status).toBe('canceled');
    });

    it('wallet 이 실제로 내보내는 gateway.refund.succeeded 가 HTTP 훅을 거쳐 환불 레코드가 된다', async () => {
      const { orderId, intentId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'C', quantity: 1 }] });
      // buildRefundEventPayload 의 출력 모양: eventType·orderId·channelOrderId 가 없다
      const res = await api.post('/hooks/payment-events', {
        messageId: 'msg-http-1',
        messageType: 'gateway.refund.succeeded',
        source: 'wallet',
        payload: {
          refundId: 'wr-http-1',
          chargeId: 'ch-1',
          intentId,
          userId: 'u1',
          status: 'SUCCEEDED',
          amount: 13000,
          currency: 'KRW',
          reasonCode: 'ADMIN_REFUND',
          occurredAt: new Date().toISOString(),
        },
      });
      expect(res.status).toBe(200);
      expect(await refundsOf(orderId)).toEqual([13000]);
      expect(wallet.callsTo('/refund')).toBe(0);
    });

    it('워크플로가 영구 실패하면 던지고 표식을 남기지 않는다', async () => {
      const { orderId, intentId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'C', quantity: 1 }] });
      // 워크플로는 Error 인스턴스가 아닌 객체를 던지므로 toThrow() 대신 직접 잡는다
      let thrown: unknown;
      await handleRefundProjection(getContainer(), intentId, 999999, 'msg-fail', orderId, logger, { refundId: 'wr-fail', reasonCode: 'ADMIN_REFUND' }).catch((e) => { thrown = e; });
      expect(thrown).toBeDefined();

      const data = (await loadOrder(getContainer(), orderId)).payment_collections[0].payments[0].data;
      expect(readExternalRefund(data)).toBeNull();
      expect(await refundsOf(orderId)).toEqual([]);
      expect(wallet.callsTo('/refund')).toBe(0);
    });
  },
});
