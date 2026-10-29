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
      expect(before.data.items).toEqual([
        { item_id: itemId, returnable_quantity: 2, window_ends_at: expect.any(String), exchangeable: true },
      ]);
      expect(Date.parse(before.data.items[0].window_ends_at)).toBeGreaterThan(Date.now());

      await api.post(`/store/orders/${orderId}/returns`, body(itemId), me.headers);

      const after = await api.get(`/admin/orders/${orderId}/returnable`, c.adminHeaders);
      expect(after.data.items[0]).toMatchObject({ item_id: itemId, returnable_quantity: 1 });
    });

    it('취소된 주문 GET returnable → 전 줄 0 — POST 가 order_canceled 로 거절하는 것과 같은 규칙', async () => {
      const { orderId, itemId, me } = await ownedOrder(2);
      expect((await api.post(`/admin/orders/${orderId}/channel-cancel`, {}, c.adminHeaders)).status).toBe(200);

      const res = await api.get(`/store/orders/${orderId}/returnable`, me.headers);
      expect(res.status).toBe(200);
      expect(res.data.items).toEqual([{ item_id: itemId, returnable_quantity: 0, window_ends_at: null, exchangeable: false }]);
      const admin = await api.get(`/admin/orders/${orderId}/returnable`, c.adminHeaders);
      expect(admin.data.items).toEqual([{ item_id: itemId, returnable_quantity: 0, window_ends_at: null, exchangeable: false }]);

      const post = await fail(api.post(`/store/orders/${orderId}/returns`, body(itemId), me.headers));
      expect(post.status).toBe(400);
      expect(post.data).toMatchObject({ reason: 'order_canceled' });
    });

    it('고객 토큰으로 admin 반품 라우트 셋 → 401, 반품 그대로', async () => {
      const { orderId, itemId, me } = await ownedOrder(2);
      const mine = await api.post(`/store/orders/${orderId}/returns`, body(itemId), me.headers);
      expect(mine.status).toBe(200);

      expect((await fail(api.post(`/admin/orders/${orderId}/returns`, body(itemId), me.headers))).status).toBe(401);
      expect((await fail(api.get(`/admin/orders/${orderId}/returnable`, me.headers))).status).toBe(401);
      expect(
        (await fail(api.post(`/admin/orders/${orderId}/returns/${mine.data.return_id}/cancel`, {}, me.headers))).status,
      ).toBe(401);
      expect((await returnsOf(orderId)).map((r) => r.status)).toEqual(['requested']);
    });

    it('GET /store/orders/:id/returns — 본인 반품 하나 → stage requested·can_cancel true·품목 수량 1, 반품 취소 뒤 → canceled·can_cancel false', async () => {
      const { orderId, itemId, me } = await ownedOrder(2);
      const mine = await api.post(`/store/orders/${orderId}/returns`, body(itemId), me.headers);
      expect(mine.status).toBe(200);

      const before = await api.get(`/store/orders/${orderId}/returns`, me.headers);
      expect(before.status).toBe(200);
      expect(before.data.returns).toEqual([
        {
          return_id: mine.data.return_id,
          stage: 'requested',
          requested_at: expect.any(String),
          reason: 'change_of_mind',
          fee_bearer: 'customer',
          items: [{ item_id: itemId, quantity: 1 }],
          can_cancel: true,
          kind: 'return',
          refund: null,
        },
      ]);

      const cancel = await api.post(`/store/orders/${orderId}/returns/${mine.data.return_id}/cancel`, {}, me.headers);
      expect(cancel.status).toBe(200);
      const after = await api.get(`/store/orders/${orderId}/returns`, me.headers);
      expect(after.data.returns).toMatchObject([{ return_id: mine.data.return_id, stage: 'canceled', can_cancel: false }]);
    });

    it('GET returns — 남의 주문 404, 로그인 없음 401', async () => {
      const { orderId, itemId, me } = await ownedOrder(1);
      await api.post(`/store/orders/${orderId}/returns`, body(itemId), me.headers);
      const stranger = await customerHeaders(getContainer(), c);
      expect((await fail(api.get(`/store/orders/${orderId}/returns`, stranger.headers))).status).toBe(404);
      expect((await fail(api.get(`/store/orders/${orderId}/returns`, { headers: c.storeHeaders.headers }))).status).toBe(401);
    });

    it('GET returns — admin 이 other + fee_bearer seller 로 접수한 반품도 고객 목록에 reason other·fee_bearer seller', async () => {
      const { orderId, itemId, me } = await ownedOrder(1);
      const made = await api.post(`/admin/orders/${orderId}/returns`, body(itemId, { reason: 'other', fee_bearer: 'seller' }), c.adminHeaders);
      expect(made.status).toBe(200);
      const res = await api.get(`/store/orders/${orderId}/returns`, me.headers);
      expect(res.data.returns).toMatchObject([{ return_id: made.data.return_id, reason: 'other', fee_bearer: 'seller', can_cancel: true }]);
    });

    it('PR 2 차단과 안 겹친다: POST /store/returns 는 여전히 400 default_return_route_blocked', async () => {
      const res = await fail(api.post('/store/returns', {}, { headers: c.storeHeaders.headers }));
      expect(res.status).toBe(400);
      expect(res.data.code).toBe('default_return_route_blocked');
    });
    it('kind exchange (admin, defective) → 200 kind exchange / store 에서 change_of_mind 교환 → 400 exchange_requires_seller_fault / kind swap → 400', async () => {
      const { orderId, itemId, me } = await ownedOrder(2);
      const adminRes = await api.post(`/admin/orders/${orderId}/returns`, body(itemId, { kind: 'exchange', reason: 'defective' }), c.adminHeaders);
      expect(adminRes.status).toBe(200);
      expect(adminRes.data).toMatchObject({ kind: 'exchange', fee_bearer: 'seller' });

      const rejected = await fail(api.post(`/store/orders/${orderId}/returns`, body(itemId, { kind: 'exchange' }), me.headers));
      expect(rejected.status).toBe(400);
      expect(rejected.data).toMatchObject({ reason: 'exchange_requires_seller_fault' });

      const swap = await fail(api.post(`/store/orders/${orderId}/returns`, body(itemId, { kind: 'swap' }), me.headers));
      expect(swap.status).toBe(400);
      expect(await returnsOf(orderId)).toHaveLength(1);
    });

    it('GET returnable — 품목에 exchangeable: core 줄 false 면 false, store·admin 같다 (K8 PR11b N3)', async () => {
      const { orderId, itemId, me } = await ownedOrder(2);
      core.setEligibility(orderId, [{ channelOrderItemId: itemId, deliveredUnits: 2, lastDeliveredAt: daysAgo(1), exchangeable: false }]);
      const store = await api.get(`/store/orders/${orderId}/returnable`, me.headers);
      expect(store.data.items).toEqual([
        { item_id: itemId, returnable_quantity: 2, window_ends_at: expect.any(String), exchangeable: false },
      ]);
      const admin = await api.get(`/admin/orders/${orderId}/returnable`, c.adminHeaders);
      expect(admin.data.items[0]).toMatchObject({ item_id: itemId, exchangeable: false });

      const rejected = await fail(
        api.post(`/admin/orders/${orderId}/returns`, body(itemId, { kind: 'exchange', reason: 'defective' }), c.adminHeaders),
      );
      expect(rejected.status).toBe(400);
      expect(rejected.data).toMatchObject({ code: 'return_rejected', reason: 'exchange_item_unsupported' });
      expect(await returnsOf(orderId)).toHaveLength(0);
    });

    it('교환 정산 뒤 고객 목록 → kind exchange·stage exchanged·can_cancel false (K8 PR11b N5)', async () => {
      const { orderId, itemId, me } = await ownedOrder(1);
      const made = await api.post(`/admin/orders/${orderId}/returns`, body(itemId, { kind: 'exchange', reason: 'defective' }), c.adminHeaders);
      expect(made.status).toBe(200);

      const requested = await api.get(`/store/orders/${orderId}/returns`, me.headers);
      expect(requested.data.returns).toMatchObject([{ return_id: made.data.return_id, kind: 'exchange', stage: 'requested', can_cancel: true }]);

      const settled = await fail(
        api.post(
          `/admin/orders/${orderId}/returns/${made.data.return_id}/settle`,
          { requestId: `exs-${Math.random().toString(36).slice(2)}`, items: [{ item_id: itemId, received: 1, dismissed: 0 }] },
          c.adminHeaders,
        ),
      );
      expect(settled.status).toBe(200);
      expect(settled.data.stage).toBe('exchanged');

      const after = await api.get(`/store/orders/${orderId}/returns`, me.headers);
      expect(after.data.returns).toEqual([
        expect.objectContaining({ return_id: made.data.return_id, kind: 'exchange', stage: 'exchanged', can_cancel: false }),
      ]);
    });
  },
});
