// apps/medusa/integration-tests/http/exchange-premises.spec.ts
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import {
  beginOrderEditOrderWorkflow,
  beginReceiveReturnWorkflow,
  confirmOrderEditRequestWorkflow,
  confirmReturnReceiveWorkflow,
  dismissItemReturnRequestWorkflow,
  orderEditAddNewItemWorkflow,
  receiveItemReturnRequestWorkflow,
  requestOrderEditRequestWorkflow,
} from '@medusajs/medusa/core-flows';
import { ensureReturnShippingOption } from '../../src/modules/almond-fulfillment/return-shipping-option';
import { ensureReturnReasons } from '../../src/workflows/orders/returns/return-reasons';
import { requestOrderReturn } from '../../src/workflows/orders/returns/request-order-return';
import { loadOrderView } from '../../src/workflows/orders/settlement/load-order-view';
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
 * K8 PR11 Task 1 — 전제 실측. 교환 = 「교환 표시한 반품」 + 수령 뒤 주문 수정으로 variant 없는 대체 줄을 더한다.
 * 이 스펙이 빨가면 PR11 설계의 N4·N5 가 바뀐다 — 단언을 구부리지 말고 관측값과 함께 보고할 것.
 * 픽스처: A 30,000, 할인 코드 PP5000(5,000).
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

    const notPaidCollections = async (orderId: string) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY);
      const {
        data: [order],
      } = await query.graph({ entity: 'order', fields: ['id', 'payment_collections.status'], filters: { id: orderId } });
      return (order as any).payment_collections.filter((pc: any) => pc.status === 'not_paid').length as number;
    };

    const reservationCount = async (orderId: string) => {
      const o = await loadOrder(getContainer(), orderId);
      const rows = await getContainer()
        .resolve(Modules.INVENTORY)
        .listReservationItems({ line_item_id: o.items.map((i: any) => i.id) });
      return rows.length;
    };

    /** 주문 → 결함 반품 요청(확정). */
    const returnRequested = async (quantity: number, returnQty: number, promoCode?: string) => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity }], promoCode });
      const o = await loadOrder(getContainer(), orderId);
      core.setEligibility(
        orderId,
        o.items.map((i: any) => ({ channelOrderItemId: i.id, deliveredUnits: num(i.quantity), lastDeliveredAt: yesterday() })),
      );
      const item = o.items[0];
      const res = await requestOrderReturn(getContainer(), {
        requestId: `req-${Math.random().toString(36).slice(2)}`,
        orderId,
        items: [{ itemId: item.id as string, quantity: returnQty }],
        reasonValue: 'defective',
        requestedBy: 'operator',
      });
      return { orderId, itemId: item.id as string, item, returnId: res.returnId };
    };

    const receive = async (p: { returnId: string; itemId: string }, received: number, dismissed: number) => {
      const container = getContainer();
      await beginReceiveReturnWorkflow(container).run({ input: { return_id: p.returnId, internal_note: 'return-receive:t1' } });
      if (received > 0)
        await receiveItemReturnRequestWorkflow(container).run({ input: { return_id: p.returnId, items: [{ id: p.itemId, quantity: received }] } });
      if (dismissed > 0)
        await dismissItemReturnRequestWorkflow(container).run({ input: { return_id: p.returnId, items: [{ id: p.itemId, quantity: dismissed }] } });
      await confirmReturnReceiveWorkflow(container).run({ input: { return_id: p.returnId } });
    };

    /** 수령 뒤 주문 수정으로 variant 없는 줄을 더하고 확정한다. */
    const addReplacementLine = async (
      orderId: string,
      line: { title: string; quantity: number; unit_price: number; metadata: Record<string, unknown> },
    ) => {
      const container = getContainer();
      await beginOrderEditOrderWorkflow(container).run({
        input: { order_id: orderId, created_by: 'test', internal_note: 'return-exchange:t1' },
      });
      await orderEditAddNewItemWorkflow(container).run({ input: { order_id: orderId, items: [line] } as any });
      await requestOrderEditRequestWorkflow(container).run({ input: { order_id: orderId, requested_by: 'test' } });
      await confirmOrderEditRequestWorkflow(container).run({ input: { order_id: orderId, confirmed_by: 'test' } });
    };

    it('할인 없는 주문 1개 수령 → 대체 줄 30,000 → 차액 0, NOT_PAID 0, 예약 수 그대로', async () => {
      const r = await returnRequested(1, 1);
      await receive(r, 1, 0);
      expect(await pending(r.orderId)).toBe(-30000);
      const reservationsBefore = await reservationCount(r.orderId);
      await addReplacementLine(r.orderId, {
        title: r.item.title,
        quantity: 1,
        unit_price: 30000,
        metadata: { almondExchange: { requestId: 't1', sourceItemId: r.itemId, variantId: r.item.variant_id } },
      });
      expect(Math.abs(await pending(r.orderId))).toBeLessThan(0.01);
      expect(await notPaidCollections(r.orderId)).toBe(0);
      expect(await reservationCount(r.orderId)).toBe(reservationsBefore);
    });

    it('5,000 할인 3개 중 1개 폐기(dismiss) → 대체 줄 단가 28,333.333… → 차액 |x| < 0.01, NOT_PAID 0', async () => {
      const r = await returnRequested(3, 1, 'PP5000');
      await receive(r, 0, 1);
      const unitPrice = 30000 - 5000 / 3;
      await addReplacementLine(r.orderId, {
        title: r.item.title,
        quantity: 1,
        unit_price: unitPrice,
        metadata: { almondExchange: { requestId: 't1', sourceItemId: r.itemId, variantId: r.item.variant_id } },
      });
      const diff = await pending(r.orderId);
      expect(Math.abs(diff)).toBeLessThan(0.01);
      expect(await notPaidCollections(r.orderId)).toBe(0);
    });

    it('대체 줄의 metadata·title 이 주문 품목에 남고 variant_id 는 null', async () => {
      const r = await returnRequested(1, 1);
      await receive(r, 1, 0);
      const metadata = { almondExchange: { requestId: 't1', sourceItemId: r.itemId, variantId: r.item.variant_id } };
      await addReplacementLine(r.orderId, { title: r.item.title, quantity: 1, unit_price: 30000, metadata });
      const o = await loadOrder(getContainer(), r.orderId);
      const added = o.items.find((i: any) => i.id !== r.itemId);
      expect(added).toBeDefined();
      expect(added.title).toBe(r.item.title);
      expect(added.variant_id ?? null).toBeNull();
      expect(added.metadata?.almondExchange).toEqual(metadata.almondExchange);
    });
  },
});
