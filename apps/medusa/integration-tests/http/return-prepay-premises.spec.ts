// apps/medusa/integration-tests/http/return-prepay-premises.spec.ts
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import {
  beginOrderEditOrderWorkflow,
  beginReceiveReturnWorkflow,
  confirmOrderEditRequestWorkflow,
  confirmReturnReceiveWorkflow,
  createOrderCreditLinesWorkflow,
  createOrderEditShippingMethodWorkflow,
  receiveItemReturnRequestWorkflow,
  requestOrderEditRequestWorkflow,
} from '@medusajs/medusa/core-flows';
import { ensureReturnShippingOption } from '../../src/modules/almond-fulfillment/return-shipping-option';
import { ensureReturnReasons } from '../../src/workflows/orders/returns/return-reasons';
import { requestOrderReturn } from '../../src/workflows/orders/returns/request-order-return';
import { cancelledAdjustmentShare } from '../../src/workflows/orders/partial-cancel/prorate-adjustments';
import { loadOrderView } from '../../src/workflows/orders/settlement/load-order-view';
import { refundOrderPayments } from '../../src/workflows/orders/settlement/refund-order-payments';
import {
  FakeWallet,
  WALLET_BASE_URL,
  setupCommerce,
  placeOrder,
  loadOrder,
  createOrderFixedPromo,
  Commerce,
} from './fixtures/partial-cancel-fixture';
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
 * K8 PR6b Task 1 — 전제 실측. CS 의 반품 문(선환불·상계·품목 값 추정·부분 수령)이 기대는 Medusa 2.13.4 의 돈 사실을 못 박는다.
 * 이 스펙이 빨가면 PR6b 설계의 N5·N6·N8 이 바뀐다 — 단언을 구부리지 말고 관측값과 함께 보고할 것.
 * 픽스처: A 30,000 × 2, 반품 2개(단순 변심) 요청·확정.
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
      await createOrderFixedPromo(ctx, c, 'PP5000', 5000);
    });
    afterAll(async () => {
      await wallet.stop();
      await core.stop();
    });
    beforeEach(() => {
      wallet.reset();
      core.reset();
    });

    const yesterday = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const pending = async (orderId: string) => (await loadOrderView(getContainer(), orderId))!.pendingDifference;

    /** 이미 있는 주문에 반품 2개를 요청·확정한다. 요청 전후 차액을 같이 돌려준다. */
    const requestReturnOn = async (orderId: string) => {
      const o = await loadOrder(getContainer(), orderId);
      core.setEligibility(
        orderId,
        o.items.map((i: any) => ({ channelOrderItemId: i.id, deliveredUnits: num(i.quantity), lastDeliveredAt: yesterday() })),
      );
      const itemId = o.items[0].id as string;
      const before = await pending(orderId);
      const res = await requestOrderReturn(getContainer(), {
        requestId: `req-${Math.random().toString(36).slice(2)}`,
        orderId,
        items: [{ itemId, quantity: 2 }],
        reasonValue: 'change_of_mind',
        requestedBy: 'operator',
      });
      return { orderId, itemId, returnId: res.returnId, before, afterRequest: await pending(orderId) };
    };
    const requestedReturn = async (opts: { promoCode?: string } = {}) => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 2 }], promoCode: opts.promoCode });
      return requestReturnOn(orderId);
    };

    const receive = async (p: { returnId: string; itemId: string }, quantity: number) => {
      const container = getContainer();
      await beginReceiveReturnWorkflow(container).run({ input: { return_id: p.returnId, internal_note: 'return-receive:t1' } });
      await receiveItemReturnRequestWorkflow(container).run({ input: { return_id: p.returnId, items: [{ id: p.itemId, quantity }] } });
      await confirmReturnReceiveWorkflow(container).run({ input: { return_id: p.returnId } });
    };

    const notPaidCollections = async (orderId: string) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY);
      const { data: [order] } = await query.graph({ entity: 'order', fields: ['id', 'payment_collections.status'], filters: { id: orderId } });
      return (order as any).payment_collections.filter((pc: any) => pc.status === 'not_paid').length as number;
    };

    const creditLines = async (orderId: string) => {
      const o = await loadOrder(getContainer(), orderId);
      return (o.credit_lines ?? []).map((l: any) => ({ amount: num(l.amount), reference: l.reference as string | null }));
    };
    const creditSum = (lines: Array<{ amount: number }>) => lines.reduce((s, l) => s + l.amount, 0);

    const returnOf = async (returnId: string) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY);
      const { data } = await query.graph({ entity: 'return', fields: ['id', 'status'], filters: { id: returnId } });
      return data[0] as any;
    };

    const itemDetail = async (orderId: string, itemId: string) => {
      const orderModule = getContainer().resolve(Modules.ORDER);
      const [o] = await orderModule.listOrders({ id: orderId }, { select: ['id', 'version'], relations: ['items', 'items.detail'] });
      const item: any = (o.items ?? []).find((i: any) => i.id === itemId);
      return {
        returnRequested: num(item.detail.return_requested_quantity ?? 0),
        returned: num(item.detail.return_received_quantity ?? 0),
      };
    };

    const refund = (orderId: string, amount: number, note: string) =>
      refundOrderPayments(getContainer(), { orderId, amount, note, mode: 'auto', kind: 'RETURN' });

    // Medusa 의 refundPaymentWorkflow 는 반품 요청이 열린 주문의 summary 를 pending_difference -60,000 으로 읽어
    // «60,000 을 줘야 한다» 고 보고 24,000 환불을 그 안에서 흡수한다 → 크레딧 라인이 안 생긴다.
    it('반품 요청이 열린 주문의 RETURN 환불 24,000 → 크레딧 라인 0, 차액 +24,000, NOT_PAID 0', async () => {
      const r = await requestedReturn();
      expect(r.afterRequest).toBe(0);
      await refund(r.orderId, 24000, 'return-prepay:t1');
      expect(await creditLines(r.orderId)).toEqual([]);
      expect(await pending(r.orderId)).toBe(24000);
      expect(await notPaidCollections(r.orderId)).toBe(0);
    });

    it('그 뒤 수령 2 확정 → 차액 −36,000, 남은 36,000 환불 → 차액 0, 크레딧 0, NOT_PAID 0', async () => {
      const r = await requestedReturn();
      await refund(r.orderId, 24000, 'return-prepay:t1');
      await receive(r, 2);
      expect(await pending(r.orderId)).toBe(-36000);
      await refund(r.orderId, 36000, 'return-settle:t1');
      expect(await pending(r.orderId)).toBe(0);
      expect(await creditLines(r.orderId)).toEqual([]);
      expect(await notPaidCollections(r.orderId)).toBe(0);
    });

    it('반품 요청 «전» 환불 24,000 → 크레딧 +24,000·차액 0, 그 뒤 반품 요청·수령 2 → −60,000, −24,000 상계 크레딧 + 36,000 환불 → 차액 0', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 2 }] });
      await refund(orderId, 24000, 'return-prepay:t1');
      expect(creditSum(await creditLines(orderId))).toBe(24000);
      expect(await pending(orderId)).toBe(0);

      const r = await requestReturnOn(orderId);
      expect(r.afterRequest).toBe(0);
      await receive(r, 2);
      expect(await pending(orderId)).toBe(-60000);

      await createOrderCreditLinesWorkflow(getContainer()).run({
        input: { id: orderId, credit_lines: [{ amount: -24000, reference: 'return-offset', reference_id: 'req-t1' }] },
      });
      expect(creditSum(await creditLines(orderId))).toBe(0);
      expect(await pending(orderId)).toBe(-36000);
      await refund(orderId, 36000, 'return-settle:t1');
      expect(await pending(orderId)).toBe(0);
      expect(await notPaidCollections(orderId)).toBe(0);
    });

    it('5,000 할인이 붙은 줄의 품목 값 추정이 수령 차액과 같다', async () => {
      const r = await requestedReturn({ promoCode: 'PP5000' });
      const view = await loadOrderView(getContainer(), r.orderId);
      const line = view!.lines.find((l) => l.id === r.itemId)!;
      const rawEstimate = line.unitPrice * 2 - cancelledAdjustmentShare(line.adjustments, 2, 0);
      const estimate = Math.floor(rawEstimate);
      const beforeReceive = await pending(r.orderId);
      await receive(r, 2);
      const afterReceive = await pending(r.orderId);
      const delta = afterReceive - beforeReceive;
      expect(line.adjustments.reduce((s, a) => s + a.amount, 0)).toBe(5000);
      // 실측(2026-10-27): rawEstimate 55000 == floored 55000 == 수령 차액 -55000 (할인 5000 이 qty 2 에서 반올림 잔여 없음)
      expect(-estimate).toBe(delta);
    });

    it('수령 2 확정(−60,000) 뒤 같은 order edit 에 배송 방법 둘(3,000·2,000) → 차액 −55,000, NOT_PAID 0', async () => {
      const container = getContainer();
      const r = await requestedReturn();
      await receive(r, 2);
      const before = await pending(r.orderId);
      await beginOrderEditOrderWorkflow(container).run({ input: { order_id: r.orderId, created_by: 'test', internal_note: 'two-ship:t1' } });
      for (const amount of [3000, 2000]) {
        await createOrderEditShippingMethodWorkflow(container).run({
          input: { order_id: r.orderId, shipping_option_id: c.groups.cond.shippingOptionId, custom_amount: amount },
        });
      }
      await requestOrderEditRequestWorkflow(container).run({ input: { order_id: r.orderId, requested_by: 'test' } });
      await confirmOrderEditRequestWorkflow(container).run({ input: { order_id: r.orderId, confirmed_by: 'test' } });
      const after = await pending(r.orderId);
      expect(before).toBe(-60000);
      expect(after).toBe(-55000);
      expect(await notPaidCollections(r.orderId)).toBe(0);
    });

    it('2개 요청 중 1개만 수령 확정 → status partially_received, return_requested_quantity 1, 차액 −30,000', async () => {
      const r = await requestedReturn();
      await receive(r, 1);
      const status = (await returnOf(r.returnId)).status;
      const detail = await itemDetail(r.orderId, r.itemId);
      const diff = await pending(r.orderId);
      expect(status).toBe('partially_received');
      expect(detail.returnRequested).toBe(1);
      expect(diff - r.afterRequest).toBe(-30000);
    });
  },
});
