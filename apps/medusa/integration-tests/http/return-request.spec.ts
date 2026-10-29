// apps/medusa/integration-tests/http/return-request.spec.ts
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import {
  beginReceiveReturnWorkflow,
  beginReturnOrderWorkflow,
  confirmReturnReceiveWorkflow,
  getOrderDetailWorkflow,
  receiveItemReturnRequestWorkflow,
  requestItemReturnWorkflow,
} from '@medusajs/core-flows';
import { ALMOND_FULFILLMENT_PROVIDER_ID } from '../../src/modules/almond-fulfillment/provision-shipping-group';
import {
  RETURN_SHIPPING_PROFILE_TYPE,
  ensureReturnShippingOption,
  findReturnShippingOptionId,
} from '../../src/modules/almond-fulfillment/return-shipping-option';
import { ensureReturnReasons } from '../../src/workflows/orders/returns/return-reasons';
import { CoreEligibilityUnavailable } from '../../src/workflows/orders/returns/core-return-eligibility';
import { ReturnRequestRejected } from '../../src/workflows/orders/returns/plan-return-request';
import {
  ReturnOrderNotFound,
  requestOrderReturn,
  type RequestOrderReturnInput,
} from '../../src/workflows/orders/returns/request-order-return';
import { partialCancelOrder } from '../../src/workflows/orders/partial-cancel/partial-cancel-order';
import { PartialCancelRejected } from '../../src/workflows/orders/partial-cancel/plan-partial-cancel';
import { FakeWallet, WALLET_BASE_URL, setupCommerce, placeOrder, loadOrder, Commerce } from './fixtures/partial-cancel-fixture';
import { CORE_BASE_URL, CORE_INTERNAL_KEY, FakeCore, assignOrderToCustomer, customerHeaders } from './fixtures/return-fixture';

/**
 * 확정 단계 실패를 꽂을 자리. `@medusajs/medusa/core-flows` 는 `__exportStar` 의 configurable:false getter 로 다시 내보내
 * `jest.spyOn` 이 `Cannot redefine property` 로 죽는다(jest-mock 29 `spyOn` 이 getter 를 defineProperty 로 바꾼다).
 * 그래서 모듈을 통째로 실물로 두고 이 하나만 실물을 감싼 jest.fn 으로 바꾼다 — 기본은 실물 그대로 돈다.
 */
jest.mock('@medusajs/medusa/core-flows', () => {
  const actual = jest.requireActual('@medusajs/medusa/core-flows');
  return {
    __esModule: true,
    ...actual,
    confirmReturnRequestWorkflow: jest.fn((...args: unknown[]) => actual.confirmReturnRequestWorkflow(...args)),
  };
});

jest.setTimeout(300 * 1000);
process.env.WALLET_BASE_URL = WALLET_BASE_URL;
process.env.WALLET_API_KEY = 'test-wallet-key';
process.env.CORE_SERVICE_URL = CORE_BASE_URL;
process.env.CORE_INTERNAL_KEY = CORE_INTERNAL_KEY;
const wallet = new FakeWallet();
const core = new FakeCore();
const num = (v: any) => Number(v?.numeric_ ?? v?.value ?? v);

/**
 * 반품 요청 오케스트레이터(K8 PR3 Task 3). 배송완료는 core 가 정하고(FakeCore), Medusa 는 반품이 잡는 만큼만 출고 수량을 올린다(N1).
 * 픽스처 상품: A 30,000(조건부 무료), C 10,000(고정 3,000).
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

    /** 주문을 만들고 core 가 전 줄을 전량 배송완료로 답하게 한다. */
    const deliveredOrder = async (lines: Array<{ variant: 'A' | 'C'; quantity: number }>) => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines });
      const o = await loadOrder(getContainer(), orderId);
      core.setEligibility(
        orderId,
        o.items.map((i: any) => ({ channelOrderItemId: i.id, deliveredUnits: num(i.quantity), lastDeliveredAt: yesterday() })),
      );
      const itemOf = (variant: 'A' | 'C') => o.items.find((i: any) => i.variant_id === c.variants[variant]).id as string;
      return { orderId, itemOf };
    };

    const detailOf = async (orderId: string, itemId: string) => {
      const o = await loadOrder(getContainer(), orderId);
      const d = o.items.find((i: any) => i.id === itemId).detail;
      return {
        quantity: num(o.items.find((i: any) => i.id === itemId).quantity),
        fulfilled: num(d.fulfilled_quantity),
        returnRequested: num(d.return_requested_quantity),
      };
    };

    const returnsOf = async (orderId: string) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY);
      const { data } = await query.graph({
        entity: 'return',
        fields: ['id', 'status', 'location_id', 'metadata', 'items.item_id', 'items.quantity', 'items.reason_id', 'items.note', 'fulfillments.provider_id'],
        filters: { order_id: orderId },
      });
      return data as any[];
    };

    const openChanges = async (orderId: string) =>
      getContainer().resolve(Modules.ORDER).listOrderChanges({ order_id: orderId, status: ['pending', 'requested'] });

    const reasonId = async (value: string) => {
      const [row] = await getContainer().resolve(Modules.ORDER).listReturnReasons({ value });
      return row.id as string;
    };

    const request = (input: Partial<RequestOrderReturnInput> & Pick<RequestOrderReturnInput, 'orderId' | 'items'>) =>
      requestOrderReturn(getContainer(), {
        requestId: `req-${Math.random().toString(36).slice(2)}`,
        reasonValue: 'change_of_mind',
        requestedBy: 'operator',
        ...input,
      });

    const rejection = async (p: Promise<unknown>) => {
      const e = await p.then(
        () => null,
        (err) => err,
      );
      expect(e).toBeInstanceOf(ReturnRequestRejected);
      return (e as ReturnRequestRejected).reason;
    };

    it('배송완료 2 중 1개 단순 변심 → 반품 requested, 품목 1·사유 change_of_mind, metadata.almondReturn.feeBearer customer, fulfilled 1, NOT_PAID 결제 컬렉션 0', async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }]);
      const { customerId } = await customerHeaders(getContainer(), c);
      await assignOrderToCustomer(getContainer(), orderId, customerId);

      const res = await request({
        orderId, requestId: 'r-basic', items: [{ itemId: itemOf('A'), quantity: 1 }],
        requestedBy: 'customer', customerId, note: '사이즈가 안 맞아요',
      });

      expect(res).toMatchObject({ requestId: 'r-basic', status: 'requested', feeBearer: 'customer', windowOverridden: false });
      expect(res.items).toEqual([{ itemId: itemOf('A'), quantity: 1 }]);
      expect(core.calls).toEqual([{ externalOrderId: orderId, authorization: `Bearer ${CORE_INTERNAL_KEY}` }]);

      const [ret] = await returnsOf(orderId);
      expect(ret.id).toBe(res.returnId);
      expect(ret.status).toBe('requested');
      expect(ret.items.map((i: any) => [i.item_id, num(i.quantity), i.reason_id])).toEqual([
        [itemOf('A'), 1, await reasonId('change_of_mind')],
      ]);
      expect(ret.items[0].note).toBe('사이즈가 안 맞아요');
      expect(ret.metadata.almondReturn).toMatchObject({
        requestId: 'r-basic', requestedBy: 'customer', reasonValue: 'change_of_mind', feeBearer: 'customer',
        windowOverride: null, fulfillmentTopUp: [{ itemId: itemOf('A'), quantity: 1 }],
      });
      expect(await detailOf(orderId, itemOf('A'))).toMatchObject({ fulfilled: 1, returnRequested: 1 });

      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY);
      const { data: [order] } = await query.graph({ entity: 'order', fields: ['id', 'payment_collections.status'], filters: { id: orderId } });
      expect(order.payment_collections.filter((pc: any) => pc.status === 'not_paid')).toHaveLength(0);
    });

    it('반품 fulfillment 가 almond 로 생기고 반품 location_id 가 반품 옵션 위치', async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 1 }]);
      await request({ orderId, items: [{ itemId: itemOf('A'), quantity: 1 }] });

      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY);
      const optionId = await findReturnShippingOptionId(getContainer());
      const { data: [option] } = await query.graph({
        entity: 'shipping_option', fields: ['id', 'service_zone.fulfillment_set.location.id'], filters: { id: optionId! },
      });
      const locationId = (option as any).service_zone.fulfillment_set.location.id;
      expect(locationId).toEqual(expect.any(String));

      const [ret] = await returnsOf(orderId);
      expect(ret.location_id).toBe(locationId);
      expect(ret.fulfillments.map((f: any) => f.provider_id)).toEqual([ALMOND_FULFILLMENT_PROVIDER_ID]);
    });

    it('수령 뒤(begin/receive/confirmReceive) 같은 줄 2개 → quantity_exceeds_returnable', async () => {
      const container = getContainer();
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }]);
      const first = await request({ orderId, items: [{ itemId: itemOf('A'), quantity: 1 }] });

      await beginReceiveReturnWorkflow(container).run({ input: { return_id: first.returnId } });
      await receiveItemReturnRequestWorkflow(container).run({
        input: { return_id: first.returnId, items: [{ id: itemOf('A'), quantity: 1 }] },
      });
      await confirmReturnReceiveWorkflow(container).run({ input: { return_id: first.returnId } });
      // 코어 검증(fulfilled − requested)은 이 요청을 통과시킨다 — 수령이 requested 를 received 로 옮기기 때문이다
      expect(await detailOf(orderId, itemOf('A'))).toMatchObject({ fulfilled: 1, returnRequested: 0 });

      expect(await rejection(request({ orderId, items: [{ itemId: itemOf('A'), quantity: 2 }] }))).toBe('quantity_exceeds_returnable');
      expect(await returnsOf(orderId)).toHaveLength(1);
      expect(await openChanges(orderId)).toHaveLength(0);
    });

    it('같은 requestId 두 번 → 반품 1개, fulfilled 1 / Promise.all 두 번도 같다 / 다른 본문 → request_id_conflict', async () => {
      const seq = await deliveredOrder([{ variant: 'A', quantity: 2 }]);
      const body = { orderId: seq.orderId, requestId: 'r-twice', items: [{ itemId: seq.itemOf('A'), quantity: 1 }] };
      const a = await request(body);
      const b = await request(body);
      expect(b).toEqual(a);
      expect(await returnsOf(seq.orderId)).toHaveLength(1);
      expect(await detailOf(seq.orderId, seq.itemOf('A'))).toMatchObject({ fulfilled: 1, returnRequested: 1 });

      const par = await deliveredOrder([{ variant: 'A', quantity: 2 }]);
      const parBody = { orderId: par.orderId, requestId: 'r-parallel', items: [{ itemId: par.itemOf('A'), quantity: 1 }] };
      const [p1, p2] = await Promise.all([request(parBody), request(parBody)]);
      expect(p2.returnId).toBe(p1.returnId);
      expect(await returnsOf(par.orderId)).toHaveLength(1);
      expect(await detailOf(par.orderId, par.itemOf('A'))).toMatchObject({ fulfilled: 1, returnRequested: 1 });

      expect(await rejection(request({ ...body, items: [{ itemId: seq.itemOf('A'), quantity: 2 }] }))).toBe('request_id_conflict');
      expect(await rejection(request({ ...body, reasonValue: 'defective' }))).toBe('request_id_conflict');
      expect(await returnsOf(seq.orderId)).toHaveLength(1);
    });

    it('남의 주문 → ReturnOrderNotFound, 반품 0', async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 1 }]);
      const owner = await customerHeaders(getContainer(), c);
      const stranger = await customerHeaders(getContainer(), c);
      await assignOrderToCustomer(getContainer(), orderId, owner.customerId);

      await expect(
        request({ orderId, items: [{ itemId: itemOf('A'), quantity: 1 }], requestedBy: 'customer', customerId: stranger.customerId }),
      ).rejects.toBeInstanceOf(ReturnOrderNotFound);
      await expect(request({ orderId: 'order_missing', items: [{ itemId: itemOf('A'), quantity: 1 }] })).rejects.toBeInstanceOf(
        ReturnOrderNotFound,
      );
      expect(await returnsOf(orderId)).toHaveLength(0);
    });

    it('반품 옵션을 지운 뒤 → return_option_missing, 열린 주문 변경 0, fulfilled 0', async () => {
      const container = getContainer();
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }]);
      const fulfillment = container.resolve(Modules.FULFILLMENT);
      const profiles = await fulfillment.listShippingProfiles({ type: RETURN_SHIPPING_PROFILE_TYPE });
      const options = await fulfillment.listShippingOptions({ shipping_profile_id: profiles.map((p: any) => p.id) });
      await fulfillment.deleteShippingOptions(options.map((o: any) => o.id));
      try {
        expect(await rejection(request({ orderId, items: [{ itemId: itemOf('A'), quantity: 1 }] }))).toBe('return_option_missing');
        expect(await openChanges(orderId)).toHaveLength(0);
        expect(await returnsOf(orderId)).toHaveLength(0);
        expect(await detailOf(orderId, itemOf('A'))).toMatchObject({ fulfilled: 0, returnRequested: 0 });
      } finally {
        await ensureReturnShippingOption(container);
      }
    });

    it('확정 단계에서 던지면 → 반품 canceled 또는 없음, 열린 주문 변경 0, fulfilled 0, 이어서 partialCancelOrder 성공', async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }, { variant: 'C', quantity: 1 }]);
      const flows = jest.requireMock('@medusajs/medusa/core-flows') as { confirmReturnRequestWorkflow: jest.Mock };
      flows.confirmReturnRequestWorkflow.mockImplementationOnce(() => ({ run: () => Promise.reject(new Error('boom')) }));

      await expect(request({ orderId, items: [{ itemId: itemOf('A'), quantity: 1 }] })).rejects.toThrow('boom');

      // cancelReturnRequestWorkflow 는 반품을 soft delete 한다 — 남은 반품이 없어야 같은 requestId 재시도가 «취소된 결과»에 갇히지 않는다
      expect(await returnsOf(orderId)).toEqual([]);
      expect(await openChanges(orderId)).toHaveLength(0);
      expect(await detailOf(orderId, itemOf('A'))).toMatchObject({ fulfilled: 0, returnRequested: 0 });

      // 출고 수량이 되돌아가지 않았으면 item-update 하한(또는 Step 5a 거절)에 막힌다
      const res = await partialCancelOrder(getContainer(), { orderId, requestId: 'pc-after-boom', items: [{ itemId: itemOf('A'), quantity: 2 }] });
      expect(res.stage).toBe('refunded');
    });

    it('확정 단계 실패 뒤 같은 requestId 로 다시 부르면 → 반품 정확히 1개(requested), fulfilled 1, 열린 주문 변경 0', async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }]);
      const body = { orderId, requestId: 'r-retry-after-boom', items: [{ itemId: itemOf('A'), quantity: 1 }] };
      const flows = jest.requireMock('@medusajs/medusa/core-flows') as { confirmReturnRequestWorkflow: jest.Mock };
      flows.confirmReturnRequestWorkflow.mockImplementationOnce(() => ({ run: () => Promise.reject(new Error('boom')) }));
      await expect(request(body)).rejects.toThrow('boom');

      // 클라이언트가 500 뒤에 가장 흔히 하는 일 — 되돌린 시도가 Ruling 2(«취소된 결과» 재생)와 부딪치면 여기서 canceled 가 온다
      const res = await request(body);
      expect(res.status).toBe('requested');
      const rets = await returnsOf(orderId);
      expect(rets.map((r) => [r.id, r.status])).toEqual([[res.returnId, 'requested']]);
      expect(await detailOf(orderId, itemOf('A'))).toMatchObject({ fulfilled: 1, returnRequested: 1 });
      expect(await openChanges(orderId)).toHaveLength(0);
    });

    it('요청 전후 주문 fulfillment_status 같다', async () => {
      const container = getContainer();
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }]);
      const status = async () => {
        const { result } = await getOrderDetailWorkflow(container).run({ input: { order_id: orderId, fields: ['id', 'fulfillment_status'] } });
        return (result as any).fulfillment_status as string;
      };
      const before = await status();
      await request({ orderId, items: [{ itemId: itemOf('A'), quantity: 1 }] });
      expect(await status()).toBe(before);
    });

    it('core 500 → CoreEligibilityUnavailable, 반품 0', async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 1 }]);
      core.failWith(500);
      await expect(request({ orderId, items: [{ itemId: itemOf('A'), quantity: 1 }] })).rejects.toBeInstanceOf(CoreEligibilityUnavailable);
      expect(await returnsOf(orderId)).toHaveLength(0);
      expect(await detailOf(orderId, itemOf('A'))).toMatchObject({ fulfilled: 0 });
    });

    it('core found false → not_delivered', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 1 }] });
      const itemId = (await loadOrder(getContainer(), orderId)).items[0].id;
      expect(await rejection(request({ orderId, items: [{ itemId, quantity: 1 }] }))).toBe('not_delivered');
      expect(await returnsOf(orderId)).toHaveLength(0);
    });

    // ── 중간에 끊긴 요청(같은 requestId 재시도가 먼저 치운다) ─────────────────────────────────────────────
    const orderModule = () => getContainer().resolve(Modules.ORDER);
    /** 앞선 시도가 registerFulfillment 까지만 하고 죽은 모양 — 오케스트레이터와 같은 표지를 단다. */
    const deadTopUp = (orderId: string, requestId: string, itemId: string, quantity: number) =>
      orderModule().registerFulfillment({ order_id: orderId, items: [{ id: itemId, quantity }], internal_note: `return-request:${requestId}` });
    const confirmedChanges = async (orderId: string, tag: string) =>
      ((await orderModule().listOrderChanges({ order_id: orderId, status: 'confirmed' }, { select: ['id', 'internal_note'] })) as any[]).filter(
        (ch) => ch.internal_note === tag,
      );

    it('top-up 만 남고 죽은 요청(registerFulfillment 직접 호출로 재현)을 같은 requestId 로 다시 부르면 → 반품 1개, fulfilled 는 반품 수량과 같다(이중으로 안 오름)', async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }]);
      await deadTopUp(orderId, 'r-dead-topup', itemOf('A'), 1);
      expect(await detailOf(orderId, itemOf('A'))).toMatchObject({ fulfilled: 1, returnRequested: 0 });

      const res = await request({ orderId, requestId: 'r-dead-topup', items: [{ itemId: itemOf('A'), quantity: 1 }] });

      expect(res.status).toBe('requested');
      expect(await returnsOf(orderId)).toHaveLength(1);
      expect(await detailOf(orderId, itemOf('A'))).toMatchObject({ fulfilled: 1, returnRequested: 1 });
      expect(await confirmedChanges(orderId, 'return-request-revert:r-dead-topup')).toHaveLength(1);
    });

    it('되돌림을 두 번 하지 않는다', async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }]);
      const body = { orderId, requestId: 'r-dead-twice', items: [{ itemId: itemOf('A'), quantity: 1 }] };
      await deadTopUp(orderId, 'r-dead-twice', itemOf('A'), 1);

      // 치운 뒤 새 시도가 확정 단계에서 또 죽는다 — 그 되돌림도 같은 표지로 이력에 남는다
      const flows = jest.requireMock('@medusajs/medusa/core-flows') as { confirmReturnRequestWorkflow: jest.Mock };
      flows.confirmReturnRequestWorkflow.mockImplementationOnce(() => ({ run: () => Promise.reject(new Error('boom')) }));
      await expect(request(body)).rejects.toThrow('boom');
      expect(await detailOf(orderId, itemOf('A'))).toMatchObject({ fulfilled: 0, returnRequested: 0 });
      expect(await confirmedChanges(orderId, 'return-request-revert:r-dead-twice')).toHaveLength(2);

      // 이력 합: +1(죽은 시도) −1(치움) +1(새 시도) −1(되돌리기) = 0 → 더 내리지 않는다(내리면 fulfilled 0 아래라 Medusa 가 거절한다)
      const a = await request(body);
      const b = await request(body);
      expect(b).toEqual(a);
      expect(await returnsOf(orderId)).toHaveLength(1);
      expect(await detailOf(orderId, itemOf('A'))).toMatchObject({ fulfilled: 1, returnRequested: 1 });
      expect(await confirmedChanges(orderId, 'return-request-revert:r-dead-twice')).toHaveLength(2);
    });

    it('open 반품으로 죽은 요청(begin+requestItemReturn 까지 직접 호출, metadata 에 기록)을 다시 부르면 → 열린 주문 변경 0, 확정된 반품 1개, fulfilled 정확', async () => {
      const container = getContainer();
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }, { variant: 'C', quantity: 1 }]);
      await deadTopUp(orderId, 'r-dead-open', itemOf('A'), 1);
      const record = {
        requestId: 'r-dead-open', requestHash: 'stale', requestedBy: 'operator', reasonValue: 'change_of_mind', feeBearer: 'customer',
        windowOverride: null, fulfillmentTopUp: [{ itemId: itemOf('A'), quantity: 1 }],
      };
      const { result: change } = await beginReturnOrderWorkflow(container).run({ input: { order_id: orderId, metadata: { almondReturn: record } } });
      await requestItemReturnWorkflow(container).run({
        input: { return_id: (change as any).return_id, items: [{ id: itemOf('A'), quantity: 1 }] },
      });
      expect(await openChanges(orderId)).toHaveLength(1);

      const res = await request({ orderId, requestId: 'r-dead-open', items: [{ itemId: itemOf('A'), quantity: 1 }] });

      expect(res.status).toBe('requested');
      expect(res.returnId).not.toBe((change as any).return_id);
      expect(await openChanges(orderId)).toHaveLength(0);
      const rets = await returnsOf(orderId);
      expect(rets.map((r) => r.status)).toEqual(['requested']);
      expect(await detailOf(orderId, itemOf('A'))).toMatchObject({ fulfilled: 1, returnRequested: 1 });

      // partialCancelOrder 가 반품 아닌 수량에서 성공
      const pc = await partialCancelOrder(container, { orderId, requestId: 'pc-after-dead-open', items: [{ itemId: itemOf('A'), quantity: 1 }] });
      expect(pc.stage).toBe('refunded');
      expect(await detailOf(orderId, itemOf('A'))).toMatchObject({ quantity: 1, fulfilled: 1 });
    });

    it('반품 1개 요청 뒤 그 줄 전량 partialCancelOrder → PartialCancelRejected, 주문 수정 0', async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }, { variant: 'C', quantity: 1 }]);
      await request({ orderId, items: [{ itemId: itemOf('A'), quantity: 1 }] });

      await expect(
        partialCancelOrder(getContainer(), { orderId, requestId: 'pc-under-return', items: [{ itemId: itemOf('A'), quantity: 2 }] }),
      ).rejects.toBeInstanceOf(PartialCancelRejected);

      const edits = await getContainer().resolve(Modules.ORDER).listOrderChanges({ order_id: orderId, change_type: 'edit' });
      expect(edits).toHaveLength(0);
      expect(await detailOf(orderId, itemOf('A'))).toMatchObject({ quantity: 2, fulfilled: 1 });
      expect(wallet.refundCalls()).toHaveLength(0);
    });
    it('kind exchange 로 접수 → 반품 metadata.almondReturn.kind exchange, 결과 kind exchange / 같은 requestId·같은 본문 재전송 → 같은 반품 / kind 만 바꾸면 request_id_conflict', async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }]);
      const body = { orderId, requestId: 'r-exch', reasonValue: 'defective', kind: 'exchange' as const, items: [{ itemId: itemOf('A'), quantity: 1 }] };
      const a = await request(body);
      expect(a).toMatchObject({ kind: 'exchange', status: 'requested', feeBearer: 'seller' });
      const [ret] = await returnsOf(orderId);
      expect(ret.metadata.almondReturn).toMatchObject({ requestId: 'r-exch', kind: 'exchange', feeBearer: 'seller' });

      expect(await request(body)).toEqual(a);
      expect(await returnsOf(orderId)).toHaveLength(1);

      expect(await rejection(request({ ...body, kind: 'return' }))).toBe('request_id_conflict');
      expect(await rejection(request({ ...body, kind: undefined }))).toBe('request_id_conflict');
      expect(await returnsOf(orderId)).toHaveLength(1);
    });

    it('교환 + change_of_mind → exchange_requires_seller_fault, 반품 0·열린 주문 변경 0', async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }]);
      const reason = await rejection(request({ orderId, kind: 'exchange', items: [{ itemId: itemOf('A'), quantity: 1 }] }));
      expect(reason).toBe('exchange_requires_seller_fault');
      expect(await returnsOf(orderId)).toHaveLength(0);
      expect(await openChanges(orderId)).toHaveLength(0);
    });

    it('kind 없는 반품: 기록에 kind 칸이 없고 결과 kind return, requestHash 가 PR 11 이전 값과 같다', async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }]);
      const res = await request({ orderId, requestId: 'r-plain', items: [{ itemId: itemOf('A'), quantity: 1 }] });
      expect(res.kind).toBe('return');
      const [ret] = await returnsOf(orderId);
      expect(ret.metadata.almondReturn).not.toHaveProperty('kind');
      // PR 11 이전 구현으로 계산한 값 — items=[{itemId: 'item_01', quantity: 2}] 의 고정 해시는 단위 스펙이 핀한다. 여기서는 같은 함수 정의를 직접 다시 계산해 대조한다
      const { createHash } = require('crypto');
      const legacy = createHash('sha256')
        .update(JSON.stringify({ items: [{ itemId: itemOf('A'), quantity: 1 }], reasonValue: 'change_of_mind', operatorFeeBearer: null }))
        .digest('hex');
      expect(ret.metadata.almondReturn.requestHash).toBe(legacy);
    });
  },
});
