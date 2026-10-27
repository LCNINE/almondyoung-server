// apps/medusa/integration-tests/http/return-settlement-premises.spec.ts
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import {
  beginOrderEditOrderWorkflow,
  beginReceiveReturnWorkflow,
  confirmOrderEditRequestWorkflow,
  confirmReturnReceiveWorkflow,
  createOrderEditShippingMethodWorkflow,
  dismissItemReturnRequestWorkflow,
  receiveItemReturnRequestWorkflow,
  requestOrderEditRequestWorkflow,
} from '@medusajs/medusa/core-flows';
import { ensureReturnShippingOption } from '../../src/modules/almond-fulfillment/return-shipping-option';
import { ensureReturnReasons } from '../../src/workflows/orders/returns/return-reasons';
import { requestOrderReturn } from '../../src/workflows/orders/returns/request-order-return';
import { loadOrderView } from '../../src/workflows/orders/settlement/load-order-view';
import { FakeWallet, WALLET_BASE_URL, setupCommerce, placeOrder, loadOrder, Commerce } from './fixtures/partial-cancel-fixture';
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
 * K8 PR6 Task 1 — 전제 실측. «돌려줄 돈» 계산(Task 3·4)이 기대는 Medusa 2.13.4 의 사실을 못 박는다:
 * 반품 요청 확정은 pending_difference 를 안 움직이고, 수령/폐기 확정이 움직이며, 그 뒤 택배비 order edit 은
 * 차액을 양수로 돌리지 않아 NOT_PAID 결제 컬렉션이 없다. 이 스펙이 빨가면 계산 전제가 틀린 것이다.
 * 픽스처: A 30,000 × 2, 반품 2개(단순 변심) 요청.
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

    /** 배송완료 2개 줄 → 반품 2개 요청. 요청 전후 차액을 같이 돌려준다. */
    const requestedReturn = async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 2 }] });
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
      const afterRequest = await pending(orderId);
      return { orderId, itemId, returnId: res.returnId, before, afterRequest };
    };

    /** 수령 1·폐기 1 확정. 확정 직전 updated_at 을 돌려준다. */
    const receiveOneDismissOne = async (p: { orderId: string; itemId: string; returnId: string }) => {
      const container = getContainer();
      await beginReceiveReturnWorkflow(container).run({ input: { return_id: p.returnId, internal_note: 'return-receive:t1' } });
      await receiveItemReturnRequestWorkflow(container).run({ input: { return_id: p.returnId, items: [{ id: p.itemId, quantity: 1 }] } });
      await dismissItemReturnRequestWorkflow(container).run({ input: { return_id: p.returnId, items: [{ id: p.itemId, quantity: 1 }] } });
      const updatedBefore = await updatedAt(p.orderId);
      await confirmReturnReceiveWorkflow(container).run({ input: { return_id: p.returnId } });
      return { updatedBefore, updatedAfter: await updatedAt(p.orderId) };
    };

    const updatedAt = async (orderId: string) => {
      const res = await api.get(`/admin/orders/${orderId}?fields=id,updated_at`, c.adminHeaders);
      return new Date(res.data.order.updated_at).getTime();
    };

    const notPaidCollections = async (orderId: string) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY);
      const { data: [order] } = await query.graph({ entity: 'order', fields: ['id', 'payment_collections.status'], filters: { id: orderId } });
      return (order as any).payment_collections.filter((pc: any) => pc.status === 'not_paid').length as number;
    };

    const returnOf = async (returnId: string) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY);
      const { data } = await query.graph({ entity: 'return', fields: ['id', 'status', 'location_id'], filters: { id: returnId } });
      return data[0] as any;
    };

    const stockedAt = async (itemId: string, locationId: string) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY);
      const { data: [line] } = await query.graph({ entity: 'order_line_item', fields: ['id', 'variant_id'], filters: { id: itemId } });
      const { data: links } = await query.graph({
        entity: 'product_variant_inventory_item', fields: ['inventory_item_id'], filters: { variant_id: (line as any).variant_id },
      });
      const levels = await getContainer().resolve(Modules.INVENTORY).listInventoryLevels({
        inventory_item_id: (links[0] as any).inventory_item_id, location_id: locationId,
      });
      return num(levels[0].stocked_quantity);
    };

    it('반품 요청 확정은 pending_difference 를 바꾸지 않는다', async () => {
      const r = await requestedReturn();
      console.log(`[premise] pending before request=${r.before} after request confirm=${r.afterRequest}`);
      expect(r.afterRequest).toBe(r.before);
    });

    it('수령 1·폐기 1 확정 뒤 pending_difference 가 -60,000 만큼 움직이고 NOT_PAID 결제 컬렉션이 없다', async () => {
      const r = await requestedReturn();
      const { locationId } = { locationId: (await returnOf(r.returnId)).location_id as string };
      const stockBefore = await stockedAt(r.itemId, locationId);

      await receiveOneDismissOne(r);

      const afterReceive = await pending(r.orderId);
      const stockAfter = await stockedAt(r.itemId, locationId);
      console.log(
        `[premise] pending before=${r.before} afterRequest=${r.afterRequest} afterReceive=${afterReceive} delta=${afterReceive - r.afterRequest} ` +
          `notPaid=${await notPaidCollections(r.orderId)} stock ${stockBefore}->${stockAfter}`,
      );
      expect((await returnOf(r.returnId)).status).toBe('received');
      expect(afterReceive - r.afterRequest).toBe(-60000);
      expect(await notPaidCollections(r.orderId)).toBe(0);
      expect(stockAfter - stockBefore).toBe(1);
    });

    it('수령 뒤 order edit 으로 3,000 배송 방법을 더하면 차액이 -57,000 이고 NOT_PAID 결제 컬렉션이 없다', async () => {
      const container = getContainer();
      const r = await requestedReturn();
      await receiveOneDismissOne(r);
      const afterReceive = await pending(r.orderId);

      await beginOrderEditOrderWorkflow(container).run({ input: { order_id: r.orderId, created_by: 'test', internal_note: 'return-charge:t1' } });
      await createOrderEditShippingMethodWorkflow(container).run({
        input: { order_id: r.orderId, shipping_option_id: c.groups.cond.shippingOptionId, custom_amount: 3000 },
      });
      await requestOrderEditRequestWorkflow(container).run({ input: { order_id: r.orderId, requested_by: 'test' } });
      await confirmOrderEditRequestWorkflow(container).run({ input: { order_id: r.orderId, confirmed_by: 'test' } });

      const afterEdit = await pending(r.orderId);
      console.log(`[premise] afterReceive=${afterReceive} afterEdit=${afterEdit} (delta from before=${afterEdit - r.before}) notPaid=${await notPaidCollections(r.orderId)}`);
      expect(afterEdit - r.before).toBe(-57000);
      expect(await notPaidCollections(r.orderId)).toBe(0);
    });

    it('수령 확정이 주문 updated_at 을 민다', async () => {
      const r = await requestedReturn();
      const { updatedBefore, updatedAfter } = await receiveOneDismissOne(r);
      console.log(`[premise] updated_at ${updatedBefore} -> ${updatedAfter}`);
      expect(updatedAfter).toBeGreaterThan(updatedBefore);
    });
  },
});
