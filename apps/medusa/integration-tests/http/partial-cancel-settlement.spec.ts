// apps/medusa/integration-tests/http/partial-cancel-settlement.spec.ts
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { Modules } from '@medusajs/framework/utils';
import { FakeWallet, WALLET_BASE_URL, setupCommerce, placeOrder, loadOrder, Commerce } from './fixtures/partial-cancel-fixture';

jest.setTimeout(300 * 1000);
process.env.WALLET_BASE_URL = WALLET_BASE_URL;
process.env.WALLET_API_KEY = 'test-wallet-key';
const wallet = new FakeWallet();
const num = (v: any) => Number(v?.numeric_ ?? v?.value ?? v);

/**
 * 부분취소 정산(#1016 36번 재설계 스펙 §6.1~§6.3, §10). 주문은 A 3개 = 90,000(조건부 무료), 1개 취소 = 30,000 환불.
 * 순서는 «수정 확정 → 환불» 그대로 — 수정 뒤 «돌려줄 돈»은 음수 차액으로 장부에 남아 의무가 사라지지 않는다.
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

    const place = () => placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
    const order = (orderId: string) => loadOrder(getContainer(), orderId);
    const balance = (o: any) => num(o.summary.pending_difference);
    const cancelOne = async (orderId: string, requestId: string, extra: Record<string, unknown> = {}) => {
      const item = (await order(orderId)).items[0].id;
      return api
        .post(`/admin/orders/${orderId}/partial-cancel`, { requestId, items: [{ item_id: item, quantity: 1 }], ...extra }, c.adminHeaders)
        .catch((e: any) => e.response);
    };
    const ledger = async (orderId: string) => {
      const paymentId = (await order(orderId)).payment_collections[0].payments[0].id as string;
      const p = await getContainer().resolve(Modules.PAYMENT).retrievePayment(paymentId, { relations: ['captures', 'refunds'] });
      return {
        captured: (p.captures ?? []).reduce((s: number, x: any) => s + num(x.amount), 0),
        refunds: (p.refunds ?? []).map((r: any) => ({ amount: num(r.amount), note: r.note })),
      };
    };

    it('영구 거절: 수정은 확정된 채 400 표지(stage edited) — 음수 차액이 의무를 들고 있고, 원인이 풀리면 같은 호출이 끝낸다', async () => {
      const { orderId } = await place();
      wallet.rejectNextRefundWith = { status: 400, error: 'REFUND_NOT_AUTOMATABLE', message: 'wallet 원문', retryable: false };
      const refused = await cancelOne(orderId, 'ps-1');
      expect(refused.status).toBe(400);
      expect(refused.data).toEqual({
        type: 'not_allowed',
        code: 'wallet_refund_refused:REFUND_NOT_AUTOMATABLE',
        stage: 'edited',
        requestId: 'ps-1',
        message: 'wallet 원문',
      });
      const mid = await order(orderId);
      expect(mid.metadata.partialCancels['ps-1'].stage).toBe('edited');
      expect(balance(mid)).toBe(-30000);
      expect((await ledger(orderId)).refunds).toEqual([]);

      const done = await cancelOne(orderId, 'ps-1');
      expect(done.status).toBe(200);
      expect(done.data).toEqual(
        expect.objectContaining({ requestId: 'ps-1', stage: 'refunded', refundAmount: 30000, refund: { mode: 'auto', amount: 30000 } }),
      );
      const after = await order(orderId);
      expect(after.version).toBe(mid.version);
      expect(balance(after)).toBe(0);
      expect(wallet.refunds.map((r) => r.amount)).toEqual([30000]);
    });

    it('영구 거절: 200 의 FAILED 행(retryable false)은 토스 문장을 그대로', async () => {
      const { orderId } = await place();
      wallet.failNextRefundAs200Failed = { failureCode: 'NOT_CANCELABLE_AMOUNT', retryable: false, message: '취소 할 수 없는 금액 입니다.' };
      const res = await cancelOne(orderId, 'ps-2');
      expect(res.status).toBe(400);
      expect(res.data).toEqual(
        expect.objectContaining({ code: 'wallet_refund_refused:NOT_CANCELABLE_AMOUNT', stage: 'edited', message: '취소 할 수 없는 금액 입니다.' }),
      );
    });

    it('일시 실패는 옛 모양 그대로 502 refund_pending — 옛 channel-adapter 가 읽는다', async () => {
      const { orderId } = await place();
      wallet.rejectNextRefundWith = { status: 400, error: 'REFUND_AMOUNT_EXCEEDS_TOTAL', retryable: true };
      const res = await cancelOne(orderId, 'ps-3');
      expect(res.status).toBe(502);
      expect(res.data).toEqual(expect.objectContaining({ type: 'refund_pending', stage: 'edited', requestId: 'ps-3' }));
    });

    it('응답을 잃은 환불은 다시 나가지 않는다 — 장부 맞추기가 이 요청의 메모로 넣는다', async () => {
      const { orderId } = await place();
      wallet.loseNextRefundResponse = true;
      expect((await cancelOne(orderId, 'ps-4')).status).toBe(502);
      expect(wallet.refunds).toHaveLength(1);
      expect((await ledger(orderId)).refunds).toEqual([]);

      const res = await cancelOne(orderId, 'ps-4');
      expect(res.status).toBe(200);
      expect(res.data.refund).toEqual({ mode: 'auto', amount: 30000 });
      expect(wallet.refundCalls()).toHaveLength(1);
      expect((await ledger(orderId)).refunds).toEqual([{ amount: 30000, note: 'partial-cancel:ps-4' }]);
      expect(balance(await order(orderId))).toBe(0);
    });

    it('자동 거절 뒤 같은 requestId 를 수동으로 → 다른 요청으로 막지 않고 송금 대기로 끝낸다, 다시 불러도 한 줄', async () => {
      const { orderId } = await place();
      wallet.rejectNextRefundWith = { status: 400, error: 'REFUND_NOT_AUTOMATABLE', retryable: false };
      expect((await cancelOne(orderId, 'ps-5')).status).toBe(400);

      const res = await cancelOne(orderId, 'ps-5', { refundMode: 'manual' });
      expect(res.status).toBe(200);
      expect(res.data.refund).toEqual({ mode: 'manual', amount: 30000 });
      expect(wallet.refunds).toEqual([expect.objectContaining({ amount: 30000, status: 'PENDING', execution: 'MANUAL' })]);
      expect(balance(await order(orderId))).toBe(0);

      const again = await cancelOne(orderId, 'ps-5', { refundMode: 'manual' });
      expect(again.status).toBe(200);
      expect(again.data).toEqual(res.data);
      expect(wallet.refunds).toHaveLength(1);
    });

    it('투영 안 된 외부 환불이 있으면 새 부분취소는 수정 «전»에 «이미 환불한 금액»을 묻는다(37번) — 장부엔 그 환불이 들어간다', async () => {
      const { orderId, intentId } = await place();
      const ext = wallet.addExternalRefund(intentId, 10000);
      const res = await cancelOne(orderId, 'ps-6');
      expect(res.status).toBe(400);
      expect(res.data.code).toBe('partial_cancel_rejected');
      expect(res.data.reason).toMatch(/^external_refund_/);
      const o = await order(orderId);
      expect(o.metadata?.partialCancels?.['ps-6']).toBeUndefined();
      expect(num(o.items[0].quantity)).toBe(3);
      expect((await ledger(orderId)).refunds).toEqual([{ amount: 10000, note: `wallet:${ext.id}` }]);
      expect(wallet.refundCalls()).toHaveLength(0);
    });

    it('부분취소가 막힌 채 전체취소가 오면 남은 몫을 전부 돌려주고 취소한다(스펙 §7.3 superseded 의 Medusa 쪽)', async () => {
      const { orderId } = await place();
      wallet.rejectNextRefundWith = { status: 400, error: 'REFUND_NOT_AUTOMATABLE', retryable: false };
      expect((await cancelOne(orderId, 'ps-7')).status).toBe(400);
      const { captured } = await ledger(orderId);
      const full = await api.post(`/admin/orders/${orderId}/channel-cancel`, {}, c.adminHeaders).catch((e: any) => e.response);
      expect(full.status).toBe(200);
      expect(full.data.refund).toEqual({ mode: 'auto', amount: captured });
      expect(wallet.refunds.map((r) => r.amount)).toEqual([captured]);
      const o = await order(orderId);
      expect(o.status).toBe('canceled');
      // 0 이 아니면 멈추고 보고한다 — 스펙 §3-2(돌려줄 돈은 장부에서 사라지지 않는다)의 반례일 수 있다
      expect(balance(o)).toBe(0);
    });
  },
});
