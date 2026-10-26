// apps/medusa/integration-tests/http/return-routes.spec.ts
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { ensureReturnShippingOption } from '../../src/modules/almond-fulfillment/return-shipping-option';
import { ensureReturnReasons } from '../../src/workflows/orders/returns/return-reasons';
import { FakeWallet, WALLET_BASE_URL, setupCommerce, placeOrder, loadOrder, Commerce } from './fixtures/partial-cancel-fixture';
import { CORE_BASE_URL, CORE_INTERNAL_KEY, FakeCore, assignOrderToCustomer, customerHeaders } from './fixtures/return-fixture';

jest.setTimeout(300 * 1000);
process.env.WALLET_BASE_URL = WALLET_BASE_URL;
process.env.WALLET_API_KEY = 'test-wallet-key';
process.env.CORE_SERVICE_URL = CORE_BASE_URL;
process.env.CORE_INTERNAL_KEY = CORE_INTERNAL_KEY;
const wallet = new FakeWallet();
const core = new FakeCore();
const num = (v: any) => Number(v?.numeric_ ?? v?.value ?? v);

/** 반품 요청·조회 라우트(K8 PR3 Task 4). 판정은 Task 3 오케스트레이터가 하고, 여기서는 인증·소유·본문·오류 매핑을 본다. */
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

    const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();

    const deliveredOrder = async (quantity: number, deliveredDaysAgo = 1) => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity }] });
      const o = await loadOrder(getContainer(), orderId);
      core.setEligibility(
        orderId,
        o.items.map((i: any) => ({ channelOrderItemId: i.id, deliveredUnits: num(i.quantity), lastDeliveredAt: daysAgo(deliveredDaysAgo) })),
      );
      return { orderId, itemId: o.items[0].id as string };
    };

    const ownedOrder = async (quantity = 2, deliveredDaysAgo = 1) => {
      const order = await deliveredOrder(quantity, deliveredDaysAgo);
      const me = await customerHeaders(getContainer(), c);
      await assignOrderToCustomer(getContainer(), order.orderId, me.customerId);
      return { ...order, me };
    };

    const returnsOf = async (orderId: string) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY);
      const { data } = await query.graph({ entity: 'return', fields: ['id', 'status', 'metadata'], filters: { order_id: orderId } });
      return data as any[];
    };

    const fail = (p: Promise<any>) => p.catch((e: any) => e.response);
    const body = (itemId: string, extra: Record<string, unknown> = {}) => ({
      request_id: `req-${Math.random().toString(36).slice(2)}`,
      items: [{ item_id: itemId, quantity: 1 }],
      reason: 'change_of_mind',
      ...extra,
    });

    it('로그인 없이 POST /store/orders/:id/returns → 401, 반품 0', async () => {
      const { orderId, itemId } = await deliveredOrder(1);
      const res = await fail(api.post(`/store/orders/${orderId}/returns`, body(itemId), { headers: c.storeHeaders.headers }));
      expect(res.status).toBe(401);
      expect(await returnsOf(orderId)).toHaveLength(0);
    });

    it('남의 주문 → 404, 반품 0', async () => {
      const { orderId, itemId } = await ownedOrder(1);
      const stranger = await customerHeaders(getContainer(), c);
      const res = await fail(api.post(`/store/orders/${orderId}/returns`, body(itemId), stranger.headers));
      expect(res.status).toBe(404);
      expect(await returnsOf(orderId)).toHaveLength(0);
    });

    it('남의 주문 GET returnable → 404', async () => {
      const { orderId } = await ownedOrder(1);
      const stranger = await customerHeaders(getContainer(), c);
      expect((await fail(api.get(`/store/orders/${orderId}/returnable`, stranger.headers))).status).toBe(404);
      expect((await fail(api.get(`/store/orders/${orderId}/returnable`, { headers: c.storeHeaders.headers }))).status).toBe(401);
    });

    it('본인 주문 → 200, fee_bearer customer', async () => {
      const { orderId, itemId, me } = await ownedOrder(2);
      const req = body(itemId);
      const res = await api.post(`/store/orders/${orderId}/returns`, req, me.headers);
      expect(res.status).toBe(200);
      expect(res.data).toMatchObject({
        request_id: req.request_id,
        status: 'requested',
        items: [{ item_id: itemId, quantity: 1 }],
        fee_bearer: 'customer',
        window_overridden: false,
      });
      expect(res.data.return_id).toEqual(expect.any(String));
      expect(await returnsOf(orderId)).toHaveLength(1);
    });

    it('고객 본문에 fee_bearer → 400', async () => {
      const { orderId, itemId, me } = await ownedOrder(1);
      const res = await fail(api.post(`/store/orders/${orderId}/returns`, body(itemId, { fee_bearer: 'seller' }), me.headers));
      expect(res.status).toBe(400);
      expect(await returnsOf(orderId)).toHaveLength(0);
    });

    it('기한 지난 주문: 고객 400 reason window_closed / admin 사유 없이 400 window_override_reason_required / admin 사유 있으면 200 window_overridden true', async () => {
      const { orderId, itemId, me } = await ownedOrder(1, 30);

      const customer = await fail(api.post(`/store/orders/${orderId}/returns`, body(itemId), me.headers));
      expect(customer.status).toBe(400);
      expect(customer.data).toMatchObject({ code: 'return_rejected', reason: 'window_closed' });

      const noReason = await fail(api.post(`/admin/orders/${orderId}/returns`, body(itemId), c.adminHeaders));
      expect(noReason.status).toBe(400);
      expect(noReason.data).toMatchObject({ reason: 'window_override_reason_required' });
      expect(await returnsOf(orderId)).toHaveLength(0);

      const ok = await api.post(`/admin/orders/${orderId}/returns`, body(itemId, { window_override_reason: '고객센터 합의' }), c.adminHeaders);
      expect(ok.status).toBe(200);
      expect(ok.data).toMatchObject({ window_overridden: true, fee_bearer: 'customer' });
    });

    it('admin 기타 + fee_bearer seller → 200, metadata feeBearer seller', async () => {
      const { orderId, itemId } = await deliveredOrder(1);
      const res = await api.post(`/admin/orders/${orderId}/returns`, body(itemId, { reason: 'other', fee_bearer: 'seller' }), c.adminHeaders);
      expect(res.status).toBe(200);
      expect(res.data.fee_bearer).toBe('seller');
      const [ret] = await returnsOf(orderId);
      expect(ret.metadata.almondReturn).toMatchObject({ feeBearer: 'seller', requestedBy: 'operator', reasonValue: 'other' });
    });

    it('core 500 → 502 core_unavailable', async () => {
      const { orderId, itemId, me } = await ownedOrder(1);
      core.failWith(500);
      const res = await fail(api.post(`/store/orders/${orderId}/returns`, body(itemId), me.headers));
      expect(res.status).toBe(502);
      expect(res.data).toMatchObject({ type: 'core_unavailable' });
      expect(await returnsOf(orderId)).toHaveLength(0);
    });

    it('GET returnable — 수령 뒤 수치가 준다', async () => {
      const { orderId, itemId, me } = await ownedOrder(2);
      const before = await api.get(`/store/orders/${orderId}/returnable`, me.headers);
      expect(before.status).toBe(200);
      expect(before.data.items).toEqual([{ item_id: itemId, returnable_quantity: 2, window_ends_at: expect.any(String) }]);
      expect(Date.parse(before.data.items[0].window_ends_at)).toBeGreaterThan(Date.now());

      await api.post(`/store/orders/${orderId}/returns`, body(itemId), me.headers);

      const after = await api.get(`/admin/orders/${orderId}/returnable`, c.adminHeaders);
      expect(after.data.items[0]).toMatchObject({ item_id: itemId, returnable_quantity: 1 });
    });

    it('PR 2 차단과 안 겹친다: POST /store/returns 는 여전히 400 default_return_route_blocked', async () => {
      const res = await fail(api.post('/store/returns', {}, { headers: c.storeHeaders.headers }));
      expect(res.status).toBe(400);
      expect(res.data.code).toBe('default_return_route_blocked');
    });
  },
});
