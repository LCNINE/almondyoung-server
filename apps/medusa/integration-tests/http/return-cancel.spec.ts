// apps/medusa/integration-tests/http/return-cancel.spec.ts
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import {
  beginReceiveReturnWorkflow,
  cancelReturnWorkflow,
  confirmReturnReceiveWorkflow,
  receiveItemReturnRequestWorkflow,
} from '@medusajs/core-flows';
import { ensureReturnShippingOption } from '../../src/modules/almond-fulfillment/return-shipping-option';
import { ensureReturnReasons } from '../../src/workflows/orders/returns/return-reasons';
import { requestOrderReturn } from '../../src/workflows/orders/returns/request-order-return';
import { partialCancelOrder } from '../../src/workflows/orders/partial-cancel/partial-cancel-order';
import {
  FakeWallet,
  WALLET_BASE_URL,
  setupCommerce,
  placeOrder,
  loadOrder,
  Commerce,
} from './fixtures/partial-cancel-fixture';
import {
  CORE_BASE_URL,
  CORE_INTERNAL_KEY,
  FakeCore,
  assignOrderToCustomer,
  customerHeaders,
} from './fixtures/return-fixture';

jest.setTimeout(300 * 1000);
process.env.WALLET_BASE_URL = WALLET_BASE_URL;
process.env.WALLET_API_KEY = 'test-wallet-key';
process.env.CORE_SERVICE_URL = CORE_BASE_URL;
process.env.CORE_INTERNAL_KEY = CORE_INTERNAL_KEY;
const wallet = new FakeWallet();
const core = new FakeCore();
const num = (v: any) => Number(v?.numeric_ ?? v?.value ?? v);

/** 반품 취소 오케스트레이터와 라우트(K8 PR3 Task 5). 반품 fulfillment → 반품 → 올린 출고 수량 순으로 되돌린다. */
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

    const yesterday = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const fail = (p: Promise<any>) => p.catch((e: any) => e.response);

    const ownedOrder = async (quantity = 2, extraLine = false) => {
      const { orderId } = await placeOrder(ctx, c, wallet, {
        lines: [{ variant: 'A', quantity }, ...(extraLine ? [{ variant: 'C' as const, quantity: 1 }] : [])],
      });
      const o = await loadOrder(getContainer(), orderId);
      core.setEligibility(
        orderId,
        o.items.map((i: any) => ({
          channelOrderItemId: i.id,
          deliveredUnits: num(i.quantity),
          lastDeliveredAt: yesterday(),
        })),
      );
      const me = await customerHeaders(getContainer(), c);
      await assignOrderToCustomer(getContainer(), orderId, me.customerId);
      return { orderId, itemId: o.items.find((i: any) => i.variant_id === c.variants.A).id as string, me };
    };

    const requestAsCustomer = async (o: { orderId: string; itemId: string; customerId: string }, quantity = 1) =>
      requestOrderReturn(getContainer(), {
        orderId: o.orderId,
        requestId: `req-${Math.random().toString(36).slice(2)}`,
        items: [{ itemId: o.itemId, quantity }],
        reasonValue: 'change_of_mind',
        requestedBy: 'customer',
        customerId: o.customerId,
      });

    const detailOf = async (orderId: string, itemId: string) => {
      const o = await loadOrder(getContainer(), orderId);
      const d = o.items.find((i: any) => i.id === itemId).detail;
      return { fulfilled: num(d.fulfilled_quantity), returnRequested: num(d.return_requested_quantity) };
    };

    const returnOf = async (returnId: string) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY);
      const { data } = await query.graph({
        entity: 'return',
        fields: ['id', 'status', 'canceled_at', 'metadata', 'fulfillments.id', 'fulfillments.canceled_at'],
        filters: { id: returnId },
      });
      return (data as any[])[0];
    };

    const revertChanges = async (orderId: string) => {
      const changes = (await getContainer()
        .resolve(Modules.ORDER)
        .listOrderChanges({ order_id: orderId }, { select: ['id', 'internal_note'] })) as Array<{
        internal_note?: string | null;
      }>;
      return changes.filter((ch) => ch.internal_note?.startsWith('return-request-revert:'));
    };

    const cancelUrl = (orderId: string, returnId: string, scope: 'store' | 'admin' = 'store') =>
      `/${scope}/orders/${orderId}/returns/${returnId}/cancel`;

    it('요청 → 고객 취소 → 반품 canceled, 반품 fulfillment canceled_at 있음, fulfilled 0, return_requested 0', async () => {
      const o = await ownedOrder(2);
      const req = await requestAsCustomer({ ...o, customerId: o.me.customerId });
      expect(await detailOf(o.orderId, o.itemId)).toMatchObject({ fulfilled: 1, returnRequested: 1 });

      const res = await api.post(cancelUrl(o.orderId, req.returnId), {}, o.me.headers);
      expect(res.status).toBe(200);
      expect(res.data).toEqual({ return_id: req.returnId, status: 'canceled' });

      const ret = await returnOf(req.returnId);
      expect(ret.status).toBe('canceled');
      expect(ret.fulfillments.length).toBeGreaterThan(0);
      expect(ret.fulfillments.every((f: any) => f.canceled_at)).toBe(true);
      expect(ret.metadata.almondReturn.fulfillmentTopUpReverted).toBe(true);
      expect(await detailOf(o.orderId, o.itemId)).toMatchObject({ fulfilled: 0, returnRequested: 0 });
    });

    it('취소 뒤 같은 줄 전량 partialCancelOrder 성공', async () => {
      const o = await ownedOrder(2, true);
      const req = await requestAsCustomer({ ...o, customerId: o.me.customerId });
      await api.post(cancelUrl(o.orderId, req.returnId), {}, o.me.headers);
      const res = await partialCancelOrder(getContainer(), {
        orderId: o.orderId,
        requestId: 'pc-after-return-cancel',
        items: [{ itemId: o.itemId, quantity: 2 }],
      });
      expect(res.stage).toBe('refunded');
    });

    it('두 번 취소 → 둘 다 200, cancelFulfillment 한 번', async () => {
      const o = await ownedOrder(2);
      const req = await requestAsCustomer({ ...o, customerId: o.me.customerId });
      const a = await api.post(cancelUrl(o.orderId, req.returnId), {}, o.me.headers);
      const b = await api.post(cancelUrl(o.orderId, req.returnId), {}, o.me.headers);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(b.data).toEqual(a.data);
      expect(await revertChanges(o.orderId)).toHaveLength(1);
      expect(await detailOf(o.orderId, o.itemId)).toMatchObject({ fulfilled: 0, returnRequested: 0 });
    });

    it('③ 직전에 끊긴 취소(반품 canceled + fulfillmentTopUpReverted 없음)를 다시 부르면 fulfilled 만 되돌린다', async () => {
      const o = await ownedOrder(2);
      const req = await requestAsCustomer({ ...o, customerId: o.me.customerId });
      // 오케스트레이터가 ①②까지 하고 죽은 상태를 직접 만든다
      const before = await returnOf(req.returnId);
      const { cancelFulfillmentWorkflow } = await import('@medusajs/medusa/core-flows');
      for (const f of before.fulfillments) await cancelFulfillmentWorkflow(getContainer()).run({ input: { id: f.id } });
      await cancelReturnWorkflow(getContainer()).run({ input: { return_id: req.returnId } });
      expect(await detailOf(o.orderId, o.itemId)).toMatchObject({ fulfilled: 1 });
      expect((await returnOf(req.returnId)).metadata.almondReturn.fulfillmentTopUpReverted).toBeUndefined();

      const res = await api.post(cancelUrl(o.orderId, req.returnId), {}, o.me.headers);
      expect(res.status).toBe(200);
      expect(await detailOf(o.orderId, o.itemId)).toMatchObject({ fulfilled: 0, returnRequested: 0 });
      expect((await returnOf(req.returnId)).metadata.almondReturn.fulfillmentTopUpReverted).toBe(true);
      expect(await revertChanges(o.orderId)).toHaveLength(1);
    });

    it('③ 에서 cancelFulfillment 뒤·표지 전에 끊긴 취소를 다시 부르면 되돌리지 않는다 — fulfilled 정확, revert 주문 변경 정확히 1개', async () => {
      const o = await ownedOrder(2);
      const req = await requestAsCustomer({ ...o, customerId: o.me.customerId });
      const container = getContainer();
      const before = await returnOf(req.returnId);
      const { cancelFulfillmentWorkflow } = await import('@medusajs/medusa/core-flows');
      for (const f of before.fulfillments) await cancelFulfillmentWorkflow(container).run({ input: { id: f.id } });
      await cancelReturnWorkflow(container).run({ input: { return_id: req.returnId } });
      // ③ 의 cancelFulfillment 까지만 하고 표지를 못 쓴 채 죽은 상태
      await container.resolve(Modules.ORDER).cancelFulfillment({
        order_id: o.orderId,
        items: [{ id: o.itemId, quantity: 1 }],
        internal_note: `return-request-revert:${req.requestId}`,
      });
      expect((await returnOf(req.returnId)).metadata.almondReturn.fulfillmentTopUpReverted).toBeUndefined();

      const res = await api.post(cancelUrl(o.orderId, req.returnId), {}, o.me.headers);
      expect(res.status).toBe(200);
      expect(await detailOf(o.orderId, o.itemId)).toMatchObject({ fulfilled: 0, returnRequested: 0 });
      expect(await revertChanges(o.orderId)).toHaveLength(1);
      expect((await returnOf(req.returnId)).metadata.almondReturn.fulfillmentTopUpReverted).toBe(true);
    });

    it('수령 뒤 취소 → 400 return_already_received, 반품·출고 수량 그대로', async () => {
      const o = await ownedOrder(2);
      const req = await requestAsCustomer({ ...o, customerId: o.me.customerId });
      const container = getContainer();
      await beginReceiveReturnWorkflow(container).run({ input: { return_id: req.returnId } });
      await receiveItemReturnRequestWorkflow(container).run({
        input: { return_id: req.returnId, items: [{ id: o.itemId, quantity: 1 }] },
      });
      await confirmReturnReceiveWorkflow(container).run({ input: { return_id: req.returnId } });

      const res = await fail(api.post(cancelUrl(o.orderId, req.returnId), {}, o.me.headers));
      expect(res.status).toBe(400);
      expect(res.data).toMatchObject({ code: 'return_rejected', reason: 'return_already_received' });
      expect((await returnOf(req.returnId)).status).not.toBe('canceled');
      expect(await revertChanges(o.orderId)).toHaveLength(0);
    });

    it('남의 주문의 반품 / 다른 주문 id 로 / 로그인 없이 → 404 / 404 / 401', async () => {
      const o = await ownedOrder(2);
      const other = await ownedOrder(1);
      const req = await requestAsCustomer({ ...o, customerId: o.me.customerId });

      const stranger = await customerHeaders(getContainer(), c);
      expect((await fail(api.post(cancelUrl(o.orderId, req.returnId), {}, stranger.headers))).status).toBe(404);
      expect((await fail(api.post(cancelUrl(other.orderId, req.returnId), {}, other.me.headers))).status).toBe(404);
      expect(
        (await fail(api.post(cancelUrl(o.orderId, req.returnId), {}, { headers: c.storeHeaders.headers }))).status,
      ).toBe(401);
      expect((await returnOf(req.returnId)).status).toBe('requested');
    });

    it('admin 취소 → 200', async () => {
      const o = await ownedOrder(2);
      const req = await requestAsCustomer({ ...o, customerId: o.me.customerId });
      const res = await api.post(cancelUrl(o.orderId, req.returnId, 'admin'), {}, c.adminHeaders);
      expect(res.status).toBe(200);
      expect(res.data).toEqual({ return_id: req.returnId, status: 'canceled' });
    });
  },
});
