// apps/medusa/integration-tests/http/order-edit-characterization.spec.ts
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { Modules } from '@medusajs/framework/utils';
import {
  beginOrderEditOrderWorkflow,
  orderEditUpdateItemQuantityWorkflow,
  requestOrderEditRequestWorkflow,
  confirmOrderEditRequestWorkflow,
  refundPaymentWorkflow,
} from '@medusajs/medusa/core-flows';
import {
  FakeWallet, WALLET_BASE_URL, setupCommerce, placeOrder, createOrderFixedPromo, loadOrder, Commerce,
} from './fixtures/partial-cancel-fixture';

jest.setTimeout(300 * 1000);
process.env.WALLET_BASE_URL = WALLET_BASE_URL;
process.env.WALLET_API_KEY = 'test-wallet-key';

const wallet = new FakeWallet();
const num = (v: any) => Number(v?.numeric_ ?? v?.value ?? v);

/**
 * Medusa 2.13.4 의 주문 수정·환불 동작 특성 테스트. 채널 주문 부분취소(스펙 §6.2)가 이 동작에 기댄다.
 * Medusa 를 올리면 이 파일을 먼저 돌려 동작이 그대로인지 본다.
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
      await createOrderFixedPromo(ctx, c, 'PC5000', 5000);
    });
    afterAll(async () => wallet.stop());
    beforeEach(() => wallet.reset());

    it('픽스처: 할인·배송 방법·캡처가 있는 주문이 만들어진다', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 2 }, { variant: 'C', quantity: 1 }], promoCode: 'PC5000' });
      const o = await loadOrder(getContainer(), orderId);
      expect(o.items).toHaveLength(2);
      expect(o.items.flatMap((i: any) => i.adjustments).length).toBeGreaterThan(0);
      expect(o.shipping_methods).toHaveLength(2);
      const payment = o.payment_collections[0].payments[0];
      expect(payment.captures.length).toBe(1);
    });

    it('배송 정책 스냅샷이 주문의 배송 방법 data 까지 복사된다', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 1 }] });
      const o = await loadOrder(getContainer(), orderId);
      expect(o.shipping_methods[0].data.policySnapshot).toEqual(
        expect.objectContaining({ shippingGroupCode: 'pc-cond', shippingProfileId: c.groups.cond.shippingProfileId }),
      );
    });

    const editQuantity = async (orderId: string, itemId: string, quantity: number) => {
      const container = getContainer();
      await beginOrderEditOrderWorkflow(container).run({ input: { order_id: orderId } });
      await orderEditUpdateItemQuantityWorkflow(container).run({ input: { order_id: orderId, items: [{ id: itemId, quantity }] } });
      await requestOrderEditRequestWorkflow(container).run({ input: { order_id: orderId } });
      await confirmOrderEditRequestWorkflow(container).run({ input: { order_id: orderId } });
    };

    it('§10-1: carry_over_promotions 를 켜지 않고 수량만 줄이면 그 줄의 할인 금액은 그대로 남는다', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 2 }, { variant: 'C', quantity: 1 }], promoCode: 'PC5000' });
      const before = await loadOrder(getContainer(), orderId);
      const lineA = before.items.find((i: any) => num(i.unit_price) === 30000);
      const adjBefore = lineA.adjustments.reduce((s: number, a: any) => s + num(a.amount), 0);

      await editQuantity(orderId, lineA.id, 1);

      const after = await loadOrder(getContainer(), orderId);
      const lineAfter = after.items.find((i: any) => i.id === lineA.id);
      expect(num(lineAfter.quantity)).toBe(1);
      expect(lineAfter.adjustments.reduce((s: number, a: any) => s + num(a.amount), 0)).toBe(adjBefore);
    });

    it('§10-3: 수량 감소 확정 뒤 돌려줄 차액은 음수 pending_difference 로 나오고, 결제 컬렉션이 새로 생기지 않는다', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 2 }] });
      const before = await loadOrder(getContainer(), orderId);
      const collectionsBefore = before.payment_collections.length;

      await editQuantity(orderId, before.items[0].id, 1);

      const after = await loadOrder(getContainer(), orderId);
      expect(num(after.summary.pending_difference)).toBe(-30000);
      expect(after.payment_collections.length).toBe(collectionsBefore);
    });

    it('§10-2: 돌려줄 차액보다 많이 환불하면 refundPaymentWorkflow 가 초과분만큼 크레딧 라인을 붙여 차액이 0 이 된다', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 2 }] });
      const before = await loadOrder(getContainer(), orderId);
      await editQuantity(orderId, before.items[0].id, 1);

      const mid = await loadOrder(getContainer(), orderId);
      const payment = mid.payment_collections[0].payments[0];
      await refundPaymentWorkflow(getContainer()).run({ input: { payment_id: payment.id, amount: 30000 + 3000 } });

      const after = await loadOrder(getContainer(), orderId);
      expect(num(after.summary.pending_difference)).toBe(0);
      expect(after.credit_lines.reduce((s: number, l: any) => s + num(l.amount), 0)).toBe(3000);
      expect(wallet.refunds.map((r) => r.amount)).toEqual([33000]);
    });
  },
});
