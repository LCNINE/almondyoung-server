// apps/medusa/integration-tests/http/return-observation-fields.spec.ts
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { ensureReturnShippingOption } from '../../src/modules/almond-fulfillment/return-shipping-option';
import { ensureReturnReasons } from '../../src/workflows/orders/returns/return-reasons';
import { requestOrderReturn } from '../../src/workflows/orders/returns/request-order-return';
import { cancelOrderReturn } from '../../src/workflows/orders/returns/cancel-order-return';
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

/**
 * K8 PR5 전제 — channel-adapter 폴러는 Medusa 관리자 주문 조회를 `updated_at[$gt]` 로 훑으며 반품을 읽는다.
 * 그 길이 실제로 반품 칸을 싣고, 반품 확정·취소가 주문 updated_at 을 미는지 못 박는다.
 */
/** 주의: `returns.items.quantity` 는 명시해도 응답에 안 온다(bigNumber 라 raw_quantity 에서 계산되는 값) — `returns.items.*` 일 때만 quantity 가 실린다. */
const FIELDS = [
  'id',
  'updated_at',
  'returns.id',
  'returns.status',
  'returns.requested_at',
  'returns.canceled_at',
  'returns.metadata',
  'returns.items.*',
].join(',');

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

    const ownedOrder = async (quantity = 2) => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity }] });
      const o = await loadOrder(getContainer(), orderId);
      core.setEligibility(
        orderId,
        o.items.map((i: any) => ({ channelOrderItemId: i.id, deliveredUnits: num(i.quantity), lastDeliveredAt: yesterday() })),
      );
      const me = await customerHeaders(getContainer(), c);
      await assignOrderToCustomer(getContainer(), orderId, me.customerId);
      return { orderId, itemId: o.items[0].id as string, me };
    };

    const updatedAtOf = async (orderId: string) =>
      (await api.get(`/admin/orders/${orderId}?fields=id,updated_at`, c.adminHeaders)).data.order.updated_at as string;

    /** 폴러와 같은 조회 — `$gt` 여야 먹는다(`gt` 는 조용히 무시된다). */
    const polled = async (orderId: string, since: string) => {
      const res = await api.get(
        `/admin/orders?fields=${encodeURIComponent(FIELDS)}&updated_at[$gt]=${encodeURIComponent(since)}&limit=100`,
        c.adminHeaders,
      );
      return (res.data.orders as any[]).find((o) => o.id === orderId);
    };

    it('반품 확정·취소가 관리자 주문 조회에 보이고 updated_at 을 민다', async () => {
      const o = await ownedOrder(2);
      const t0 = await updatedAtOf(o.orderId);
      await new Promise((r) => setTimeout(r, 20));

      const requestId = `req-${Math.random().toString(36).slice(2)}`;
      const req = await requestOrderReturn(getContainer(), {
        orderId: o.orderId,
        requestId,
        items: [{ itemId: o.itemId, quantity: 1 }],
        reasonValue: 'change_of_mind',
        requestedBy: 'customer',
        customerId: o.me.customerId,
      });

      const afterRequest = await polled(o.orderId, t0);
      expect(afterRequest).toBeDefined();
      expect(afterRequest.returns).toHaveLength(1);
      const ret = afterRequest.returns[0];
      expect(ret.id).toBe(req.returnId);
      expect(ret.requested_at).toBeTruthy();
      expect(ret.metadata.almondReturn.requestId).toBe(requestId);
      expect(ret.items).toHaveLength(1);
      expect(ret.items[0]).toMatchObject({ item_id: o.itemId, quantity: 1 });
      const t1 = afterRequest.updated_at as string;
      expect(new Date(t1).getTime()).toBeGreaterThan(new Date(t0).getTime());
      await new Promise((r) => setTimeout(r, 20));

      await cancelOrderReturn(getContainer(), {
        orderId: o.orderId,
        returnId: req.returnId,
        requestedBy: 'customer',
        customerId: o.me.customerId,
      });

      const afterCancel = await polled(o.orderId, t1);
      expect(afterCancel).toBeDefined();
      expect(afterCancel.returns[0].status).toBe('canceled');
      expect(afterCancel.returns[0].canceled_at).toBeTruthy();
    });
  },
});
