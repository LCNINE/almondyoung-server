// apps/medusa/integration-tests/http/default-return-routes-blocked.spec.ts
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { Modules } from '@medusajs/framework/utils';
import { createOrderFulfillmentWorkflow } from '@medusajs/core-flows';
import {
  FakeWallet, WALLET_BASE_URL, setupCommerce, createReturnShippingOption, placeOrder, loadOrder, Commerce,
} from './fixtures/partial-cancel-fixture';

jest.setTimeout(300 * 1000);
process.env.WALLET_BASE_URL = WALLET_BASE_URL;
process.env.WALLET_API_KEY = 'test-wallet-key';
const wallet = new FakeWallet();

/**
 * Medusa 기본 반품·교환·클레임·사유 쓰기 라우트 차단(K8 PR2, 설계 §4.2). 반품 옵션은 manual provider 픽스처라
 * 미들웨어가 없으면 첫 케이스의 요청이 실제로 반품을 만든다 — 그게 이 스펙이 막는 구멍이다.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: { WALLET_BASE_URL, WALLET_API_KEY: 'test-wallet-key' },
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let c: Commerce;
    let orderId: string;
    let itemId: string;
    let returnOptionId: string;
    const ctx = { api, getContainer };
    beforeAll(async () => {
      await wallet.start();
      c = await setupCommerce(ctx);
      ({ orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 1 }] }));
      itemId = (await loadOrder(getContainer(), orderId)).items[0].id;
      // 기본 라우트는 출고된 수량까지만 반품을 받는다 — 출고해 둬야 «미들웨어가 없으면 반품이 생긴다»가 참이 된다
      await createOrderFulfillmentWorkflow(getContainer()).run({ input: { order_id: orderId, items: [{ id: itemId, quantity: 1 }] } });
      returnOptionId = await createReturnShippingOption(getContainer(), c.groups.cond.shippingProfileId);
    });
    afterAll(async () => wallet.stop());

    it('POST /store/returns — 인증 없이 실제 주문·실제 반품 옵션으로 와도 막고, 반품 행이 생기지 않는다', async () => {
      const res = await api
        .post('/store/returns', {
          order_id: orderId, items: [{ id: itemId, quantity: 1 }], return_shipping: { option_id: returnOptionId },
        }, c.storeHeaders)
        .catch((e: any) => e.response);
      expect(res.status).toBe(400);
      expect(res.data.code).toBe('default_return_route_blocked');
      const returns = await getContainer().resolve(Modules.ORDER).listReturns({ order_id: orderId });
      expect(returns).toHaveLength(0);
    });

    it.each([
      ['post', '/admin/returns'],
      ['post', '/admin/returns/ret_x/request-items'],
      ['post', '/admin/returns/ret_x/receive/confirm'],
      ['delete', '/admin/returns/ret_x/request-items/act_x'],
      ['post', '/admin/exchanges'],
      ['post', '/admin/exchanges/exc_x/outbound/items'],
      ['post', '/admin/claims'],
      ['delete', '/admin/claims/clm_x/request'],
      ['post', '/admin/return-reasons'],
      ['delete', '/admin/return-reasons/rr_x'],
    ])('%s %s — 관리자 토큰이 있어도 막는다', async (method, path) => {
      const res = await (method === 'post' ? api.post(path, {}, c.adminHeaders) : api.delete(path, c.adminHeaders))
        .catch((e: any) => e.response);
      expect(res.status).toBe(400);
      expect(res.data.code).toBe('default_return_route_blocked');
    });

    it.each(['/admin/returns', '/admin/exchanges', '/admin/claims', '/admin/return-reasons'])('GET %s — 읽기는 지난다', async (path) => {
      const res = await api.get(path, c.adminHeaders);
      expect(res.status).toBe(200);
    });

    it('이름이 비슷한 다른 경로는 막지 않는다 — /admin/orders/:id 읽기', async () => {
      expect((await api.get(`/admin/orders/${orderId}`, c.adminHeaders)).status).toBe(200);
    });
  },
});
