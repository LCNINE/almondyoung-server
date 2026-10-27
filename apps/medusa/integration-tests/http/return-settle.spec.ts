// apps/medusa/integration-tests/http/return-settle.spec.ts
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import {
  beginReceiveReturnWorkflow,
  confirmOrderEditRequestWorkflow,
  confirmReturnReceiveWorkflow,
  receiveItemReturnRequestWorkflow,
} from '@medusajs/medusa/core-flows';
import { ensureReturnShippingOption } from '../../src/modules/almond-fulfillment/return-shipping-option';
import { cancelOrderReturn } from '../../src/workflows/orders/returns/cancel-order-return';
import { ensureReturnReasons } from '../../src/workflows/orders/returns/return-reasons';
import {
  hashReturnSettlement,
  readReturnSettlementRecord,
  type ReturnSettlementRecord,
} from '../../src/workflows/orders/returns/return-settlement-record';
import { requestOrderReturn } from '../../src/workflows/orders/returns/request-order-return';
import { partialCancelOrder } from '../../src/workflows/orders/partial-cancel/partial-cancel-order';
import { loadOrderView } from '../../src/workflows/orders/settlement/load-order-view';
import { reconcileOrderWalletRefunds } from '../../src/workflows/orders/settlement/wallet-refund-ledger';
import { FakeWallet, WALLET_BASE_URL, setupCommerce, placeOrder, loadOrder, Commerce } from './fixtures/partial-cancel-fixture';
import { CORE_BASE_URL, CORE_INTERNAL_KEY, FakeCore } from './fixtures/return-fixture';

/**
 * 보류 정산을 택배비·차감 주문 수정 확정에서 끊을 자리(K8 PR6b). core-flows 는 configurable:false getter 로 다시 내보내
 * jest.spyOn 이 죽는다(return-request.spec 과 같은 이유) — 모듈을 실물로 두고 이 하나만 실물을 감싼 jest.fn 으로 바꾼다.
 */
jest.mock('@medusajs/medusa/core-flows', () => {
  const actual = jest.requireActual('@medusajs/medusa/core-flows');
  return {
    __esModule: true,
    ...actual,
    confirmOrderEditRequestWorkflow: jest.fn((...args: unknown[]) => actual.confirmOrderEditRequestWorkflow(...args)),
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
 * K8 PR6 Task 4 — 반품 정산(수령 확정 → 택배비 주문 수정 → RETURN 환불). 조건부 무료 그룹(50,000 이상 무료 / 3,000),
 * A·B 30,000 · E 10,000. 단계는 반품 metadata 의 정산 기록에 남고 같은 requestId 는 기록의 단계부터 잇는다.
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

    let seq = 0;
    const rid = (p: string) => `${p}-${++seq}-${Math.random().toString(36).slice(2, 8)}`;
    const yesterday = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    /** 주문을 만들고 core 가 전 줄 배송완료로 답하게 한다. 반환: 주문 id·intent·변형별 줄 id */
    const deliveredOrder = async (lines: Array<{ variant: 'A' | 'B' | 'E'; quantity: number }>, delivered?: Array<'A' | 'B' | 'E'>) => {
      const { orderId, intentId } = await placeOrder(ctx, c, wallet, { lines });
      const o = await loadOrder(getContainer(), orderId);
      const itemOf = (v: 'A' | 'B' | 'E') => o.items.find((i: any) => i.variant_id === c.variants[v]).id as string;
      const deliveredSet = new Set(delivered ?? lines.map((l) => l.variant));
      core.setEligibility(
        orderId,
        o.items
          .filter((i: any) => [...deliveredSet].some((v) => c.variants[v] === i.variant_id))
          .map((i: any) => ({ channelOrderItemId: i.id, deliveredUnits: num(i.quantity), lastDeliveredAt: yesterday() })),
      );
      return { orderId, intentId, itemOf };
    };

    const requestReturn = async (orderId: string, itemId: string, quantity: number, reasonValue = 'change_of_mind') => {
      const res = await requestOrderReturn(getContainer(), {
        requestId: rid('ret'),
        orderId,
        items: [{ itemId, quantity }],
        reasonValue,
        requestedBy: 'operator',
      });
      return res.returnId;
    };

    const settle = (orderId: string, returnId: string, body: Record<string, unknown>) =>
      api.post(`/admin/orders/${orderId}/returns/${returnId}/settle`, body, c.adminHeaders).catch((e: any) => e.response);

    const returnRow = async (returnId: string) => {
      const [r] = await getContainer().resolve(Modules.ORDER).listReturns({ id: returnId }, { select: ['id', 'status', 'metadata'] });
      return r as any;
    };
    const changesTagged = async (orderId: string, tag: string) => {
      const changes = (await getContainer()
        .resolve(Modules.ORDER)
        .listOrderChanges({ order_id: orderId }, { select: ['id', 'status', 'internal_note'] })) as any[];
      return changes.filter((ch) => ch.internal_note === tag);
    };
    const feeMethods = async (orderId: string) =>
      (await loadOrder(getContainer(), orderId)).shipping_methods.filter((m: any) => m.name === '반품 택배비');
    const notPaidCollections = async (orderId: string) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY);
      const { data: [order] } = await query.graph({ entity: 'order', fields: ['id', 'payment_collections.status'], filters: { id: orderId } });
      return (order as any).payment_collections.filter((pc: any) => pc.status === 'not_paid').length as number;
    };
    const ledgerRefunds = async (orderId: string) => {
      const o = await loadOrder(getContainer(), orderId);
      const paymentId = o.payment_collections[0].payments[0].id as string;
      const p = await getContainer().resolve(Modules.PAYMENT).retrievePayment(paymentId, { relations: ['refunds'] });
      return (p.refunds ?? []).map((r: any) => ({ amount: num(r.amount), note: r.note }));
    };
    const balance = async (orderId: string) => num((await loadOrder(getContainer(), orderId)).summary.pending_difference);
    /** 정산이 읽는 차액(loadOrderView) — 반품 요청이 열린 동안 저장된 summary 와 다르다(Task 1 실측) */
    const pending = async (orderId: string) => (await loadOrderView(getContainer(), orderId))!.pendingDifference;
    const creditLines = async (orderId: string) =>
      ((await loadOrder(getContainer(), orderId)).credit_lines ?? []).map((l: any) => ({
        amount: num(l.amount),
        reference: l.reference as string | null,
        referenceId: l.reference_id as string | null,
      }));
    const creditSum = async (orderId: string) => (await creditLines(orderId)).reduce((s, l) => s + l.amount, 0);
    const chargeMethods = async (orderId: string) =>
      (await loadOrder(getContainer(), orderId)).shipping_methods
        .filter((m: any) => m.name === '반품 택배비' || m.name === '반품 차감')
        .map((m: any) => ({ name: m.name as string, amount: num(m.amount) }))
        .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
    const prepay = (orderId: string, returnId: string, body: Record<string, unknown>) =>
      api.post(`/admin/orders/${orderId}/returns/${returnId}/prepay`, body, c.adminHeaders).catch((e: any) => e.response);
    /** 배송완료 주문에 반품 «전» wallet 직접 환불을 넣고 투영한다 — 반품 요청이 없어 크레딧 +amount 가 붙는다 */
    const creditBackedExternalRefund = async (lines: Array<{ variant: 'A' | 'B' | 'E'; quantity: number }>, amount: number) => {
      const order = await deliveredOrder(lines);
      wallet.addExternalRefund(order.intentId, amount);
      await reconcileOrderWalletRefunds(getContainer(), order.orderId);
      expect(await creditSum(order.orderId)).toBe(amount);
      return order;
    };

    it('변심 1개 수령 → 반품비·깨짐을 빼고 환불, 반품 received, 결과 200', async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 1 }, { variant: 'B', quantity: 1 }]);
      const returnId = await requestReturn(orderId, itemOf('A'), 1);
      const requestId = rid('settle');

      const res = await settle(orderId, returnId, { requestId, items: [{ item_id: itemOf('A'), received: 1, dismissed: 0 }] });

      expect(res.status).toBe(200);
      expect(res.data).toEqual({
        returnId,
        requestId,
        refundAmount: 24000,
        deduction: { returnShipping: 3000, freeShippingBreak: 3000, roundTrip: 0 },
        feeNotAdjusted: false,
        prepaidApplied: 0,
        externalRefundApplied: 0,
        refund: { mode: 'auto', amount: 24000 },
        stage: 'refunded',
      });
      const row = await returnRow(returnId);
      expect(row.status).toBe('received');
      const record = readReturnSettlementRecord(row.metadata);
      expect(record).not.toBeNull();
      expect(record).toEqual(
        expect.objectContaining({ stage: 'refunded', owed: 30000, refundAmount: 24000, refundMode: 'auto', items: [{ itemId: itemOf('A'), received: 1, dismissed: 0 }] }),
      );
      // PR 3 의 요청 기록이 그대로 남는다
      expect(row.metadata.almondReturn).toEqual(expect.objectContaining({ feeBearer: 'customer' }));

      expect(await ledgerRefunds(orderId)).toEqual([{ amount: 24000, note: `return-settle:${requestId}` }]);
      expect(wallet.refundCalls().map((x) => x.body.kind)).toEqual(['RETURN']);
      expect((await feeMethods(orderId)).map((m: any) => num(m.amount))).toEqual([6000]);
      expect(await notPaidCollections(orderId)).toBe(0);
      expect(await balance(orderId)).toBe(0);
    });

    it('하자 전량 폐기 → 차감 0, 환불 전액', async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }]);
      const returnId = await requestReturn(orderId, itemOf('A'), 2, 'defective');
      const requestId = rid('settle');

      const res = await settle(orderId, returnId, { requestId, items: [{ item_id: itemOf('A'), received: 0, dismissed: 2 }] });

      expect(res.status).toBe(200);
      expect(res.data).toEqual(
        expect.objectContaining({
          refundAmount: 60000,
          deduction: { returnShipping: 0, freeShippingBreak: 0, roundTrip: 0 },
          feeNotAdjusted: false,
          refund: { mode: 'auto', amount: 60000 },
        }),
      );
      // 차감 0 은 주문 수정 없이 charged 를 건너 refunded 까지 간다 — 그래야 부분취소 겹치기가 이 기록을 센다
      expect(readReturnSettlementRecord((await returnRow(returnId)).metadata)?.stage).toBe('refunded');
      expect(await changesTagged(orderId, `return-fee:${requestId}`)).toHaveLength(0);
      expect(await feeMethods(orderId)).toHaveLength(0);
      expect(wallet.refunds.map((r) => r.amount)).toEqual([60000]);
    });

    it('변심 전량 → 반품비 + 왕복', async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }]);
      const returnId = await requestReturn(orderId, itemOf('A'), 2);

      const res = await settle(orderId, returnId, { requestId: rid('settle'), items: [{ item_id: itemOf('A'), received: 2, dismissed: 0 }] });

      expect(res.status).toBe(200);
      expect(res.data.deduction).toEqual({ returnShipping: 3000, freeShippingBreak: 0, roundTrip: 3000 });
      expect(res.data.refundAmount).toBe(54000);
      expect(wallet.refunds.map((r) => r.amount)).toEqual([54000]);
      expect(await balance(orderId)).toBe(0);
    });

    it('같은 requestId 두 번 → 환불 1, 수령 주문 변경 1, 두 번째 결과 같음', async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 1 }, { variant: 'B', quantity: 1 }]);
      const returnId = await requestReturn(orderId, itemOf('A'), 1);
      const requestId = rid('settle');
      const body = { requestId, items: [{ item_id: itemOf('A'), received: 1, dismissed: 0 }] };

      const first = await settle(orderId, returnId, body);
      const second = await settle(orderId, returnId, body);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.data).toEqual(first.data);
      expect(wallet.refundCalls()).toHaveLength(1);
      expect(await changesTagged(orderId, `return-receive:${requestId}`)).toHaveLength(1);
      expect(await changesTagged(orderId, `return-fee:${requestId}`)).toHaveLength(1);
    });

    it('환불이 502 로 끊긴 뒤 같은 requestId → 수령·택배비를 다시 하지 않고 환불만', async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 1 }, { variant: 'B', quantity: 1 }]);
      const returnId = await requestReturn(orderId, itemOf('A'), 1);
      const requestId = rid('settle');
      const body = { requestId, items: [{ item_id: itemOf('A'), received: 1, dismissed: 0 }] };
      wallet.failNextRefund = true;

      const pending = await settle(orderId, returnId, body);
      expect(pending.status).toBe(502);
      expect(pending.data).toEqual(expect.objectContaining({ type: 'refund_pending', stage: 'received', requestId }));
      const mid = readReturnSettlementRecord((await returnRow(returnId)).metadata);
      expect(mid).not.toBeNull();
      expect(mid?.stage).toBe('charged');
      expect(await balance(orderId)).toBe(-24000);

      const done = await settle(orderId, returnId, body);
      expect(done.status).toBe(200);
      expect(done.data.refund).toEqual({ mode: 'auto', amount: 24000 });
      expect(await changesTagged(orderId, `return-receive:${requestId}`)).toHaveLength(1);
      expect(await feeMethods(orderId)).toHaveLength(1);
      expect(wallet.refunds.map((r) => r.amount)).toEqual([24000]);
      expect(await balance(orderId)).toBe(0);
    });

    it('wallet 영구 거절 → 400 wallet_refund_refused:<code>, stage received', async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }]);
      const returnId = await requestReturn(orderId, itemOf('A'), 2, 'defective');
      const requestId = rid('settle');
      wallet.rejectNextRefundWith = { status: 400, error: 'REFUND_NOT_AUTOMATABLE', message: 'wallet 원문', retryable: false };

      const res = await settle(orderId, returnId, { requestId, items: [{ item_id: itemOf('A'), received: 2, dismissed: 0 }] });

      expect(res.status).toBe(400);
      expect(res.data).toEqual({
        type: 'not_allowed',
        code: 'wallet_refund_refused:REFUND_NOT_AUTOMATABLE',
        stage: 'received',
        requestId,
        message: 'wallet 원문',
      });
      const row = await returnRow(returnId);
      expect(row.status).toBe('received');
      expect(readReturnSettlementRecord(row.metadata)?.stage).toBe('charged');
      expect(await ledgerRefunds(orderId)).toEqual([]);
    });

    it('품목이 반품과 다르거나 수량 합이 다르면 400 items_mismatch, 주문 그대로', async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }, { variant: 'B', quantity: 1 }]);
      const returnId = await requestReturn(orderId, itemOf('A'), 2);

      for (const items of [
        [{ item_id: itemOf('B'), received: 1, dismissed: 0 }],
        [{ item_id: itemOf('A'), received: 1, dismissed: 0 }],
        [{ item_id: itemOf('A'), received: 2, dismissed: 0 }, { item_id: itemOf('B'), received: 1, dismissed: 0 }],
      ]) {
        const res = await settle(orderId, returnId, { requestId: rid('settle'), items });
        expect(res.status).toBe(400);
        expect(res.data).toEqual(expect.objectContaining({ type: 'not_allowed', code: 'return_settle_rejected', reason: 'items_mismatch' }));
      }
      const row = await returnRow(returnId);
      expect(row.status).toBe('requested');
      expect(readReturnSettlementRecord(row.metadata)).toBeNull();
      expect(wallet.refundCalls()).toHaveLength(0);
    });

    it('취소된 반품 → 400 return_canceled', async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 1 }]);
      const returnId = await requestReturn(orderId, itemOf('A'), 1);
      await cancelOrderReturn(getContainer(), { orderId, returnId, requestedBy: 'operator' });

      const res = await settle(orderId, returnId, { requestId: rid('settle'), items: [{ item_id: itemOf('A'), received: 1, dismissed: 0 }] });

      expect(res.status).toBe(400);
      expect(res.data).toEqual(expect.objectContaining({ code: 'return_settle_rejected', reason: 'return_canceled' }));
    });

    it('다른 주문의 반품 id → 404', async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 1 }]);
      const returnId = await requestReturn(orderId, itemOf('A'), 1);
      const other = await deliveredOrder([{ variant: 'A', quantity: 1 }]);

      const res = await settle(other.orderId, returnId, { requestId: rid('settle'), items: [{ item_id: itemOf('A'), received: 1, dismissed: 0 }] });

      expect(res.status).toBe(404);
      expect(res.data.type).toBe('not_found');
    });

    it('같은 requestId 다른 품목 → 400 request_id_conflict', async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }]);
      const returnId = await requestReturn(orderId, itemOf('A'), 2, 'defective');
      const requestId = rid('settle');
      expect((await settle(orderId, returnId, { requestId, items: [{ item_id: itemOf('A'), received: 2, dismissed: 0 }] })).status).toBe(200);

      const res = await settle(orderId, returnId, { requestId, items: [{ item_id: itemOf('A'), received: 1, dismissed: 1 }] });

      expect(res.status).toBe(400);
      expect(res.data).toEqual(expect.objectContaining({ code: 'return_settle_rejected', reason: 'request_id_conflict' }));
      expect(wallet.refundCalls()).toHaveLength(1);
    });

    it('wallet 직접 환불이 있는 주문 → 400 external_refund_unresolved', async () => {
      const { orderId, intentId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }]);
      const returnId = await requestReturn(orderId, itemOf('A'), 2, 'defective');
      wallet.addExternalRefund(intentId, 10000);

      const res = await settle(orderId, returnId, { requestId: rid('settle'), items: [{ item_id: itemOf('A'), received: 2, dismissed: 0 }] });

      expect(res.status).toBe(400);
      expect(res.data).toEqual(expect.objectContaining({ code: 'return_settle_rejected', reason: 'external_refund_unresolved' }));
      const row = await returnRow(returnId);
      expect(row.status).toBe('requested');
      expect(readReturnSettlementRecord(row.metadata)).toBeNull();
      expect(wallet.refundCalls()).toHaveLength(0);
    });

    it('정산 끝난 반품이 있는 주문의 전체취소 → 400, 환불 0', async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 1 }, { variant: 'B', quantity: 1 }]);
      const returnId = await requestReturn(orderId, itemOf('A'), 1);
      expect((await settle(orderId, returnId, { requestId: rid('settle'), items: [{ item_id: itemOf('A'), received: 1, dismissed: 0 }] })).status).toBe(200);
      const callsBefore = wallet.refundCalls().length;

      const res = await api.post(`/admin/orders/${orderId}/channel-cancel`, {}, c.adminHeaders).catch((e: any) => e.response);

      expect(res.status).toBe(400);
      expect(wallet.refundCalls()).toHaveLength(callsBefore);
      expect((await loadOrder(getContainer(), orderId)).status).not.toBe('canceled');
    });

    it('반품 정산 뒤 다른 품목 부분취소가 배송비를 다시 빼지 않는다', async () => {
      // A·B 배송완료, E 미출고 — 70,000 무료. A 변심 반품은 반품비 3,000 + 깨짐 3,000(남는 B·E = 40,000)
      const { orderId, itemOf } = await deliveredOrder(
        [{ variant: 'A', quantity: 1 }, { variant: 'B', quantity: 1 }, { variant: 'E', quantity: 1 }],
        ['A', 'B'],
      );
      const returnId = await requestReturn(orderId, itemOf('A'), 1);
      const settled = await settle(orderId, returnId, { requestId: rid('settle'), items: [{ item_id: itemOf('A'), received: 1, dismissed: 0 }] });
      expect(settled.status).toBe(200);
      expect(settled.data.deduction).toEqual({ returnShipping: 3000, freeShippingBreak: 3000, roundTrip: 0 });

      const res = await api
        .post(
          `/admin/orders/${orderId}/partial-cancel`,
          { requestId: rid('pc'), items: [{ item_id: itemOf('E'), quantity: 1 }], reasonCode: 'CUSTOMER_REQUEST', requestedBy: 'operator' },
          c.adminHeaders,
        )
        .catch((e: any) => e.response);

      // 남는 B 30,000 → 3,000 은 반품이 이미 받았다: 더 받지도, 돌려주지도 않는다
      expect(res.status).toBe(200);
      expect(res.data).toEqual(expect.objectContaining({ refundAmount: 10000, shippingDelta: 0, shippingNotAdjusted: false }));
      expect(wallet.refunds.map((r) => r.amount)).toEqual([24000, 10000]);
      expect(await balance(orderId)).toBe(0);
    });

    it('A 만 배송·반품 정산 뒤 미출고 E 부분취소 — 줄이 다 비어도 A 의 출고 배송비를 돌려주지 않는다', async () => {
      // A 30,000 + E 10,000 = 40,000 → 배송비 3,000 을 냈다. A 만 배송완료, E 미출고. A 변심 반품은 반품비 3,000(깨짐 0)
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 1 }, { variant: 'E', quantity: 1 }], ['A']);
      const returnId = await requestReturn(orderId, itemOf('A'), 1);
      const settled = await settle(orderId, returnId, { requestId: rid('settle'), items: [{ item_id: itemOf('A'), received: 1, dismissed: 0 }] });
      expect(settled.status).toBe(200);
      expect(settled.data).toEqual(expect.objectContaining({ refundAmount: 27000, deduction: { returnShipping: 3000, freeShippingBreak: 0, roundTrip: 0 } }));

      const res = await api
        .post(
          `/admin/orders/${orderId}/partial-cancel`,
          { requestId: rid('pc'), items: [{ item_id: itemOf('E'), quantity: 1 }], reasonCode: 'CUSTOMER_REQUEST', requestedBy: 'operator' },
          c.adminHeaders,
        )
        .catch((e: any) => e.response);

      // 남는 줄이 없어도 A 는 나갔다 — 그 3,000 은 쓴 배송비라 E 의 상품값만 돌려준다
      expect(res.status).toBe(200);
      expect(res.data).toEqual(expect.objectContaining({ refundAmount: 10000, shippingDelta: 0, shippingNotAdjusted: false }));
      expect(wallet.refunds.map((r) => r.amount)).toEqual([27000, 10000]);
      expect(await balance(orderId)).toBe(0);
    });

    it('수령 뒤 청구 전에 멈춘 반품 정산이 있으면 부분취소는 500(재시도) — 주문을 바꾸지 않는다', async () => {
      const { orderId, itemOf } = await deliveredOrder(
        [{ variant: 'A', quantity: 1 }, { variant: 'B', quantity: 1 }, { variant: 'E', quantity: 1 }],
        ['A', 'B'],
      );
      const returnId = await requestReturn(orderId, itemOf('A'), 1);
      expect((await settle(orderId, returnId, { requestId: rid('settle'), items: [{ item_id: itemOf('A'), received: 1, dismissed: 0 }] })).status).toBe(200);
      // 끊긴 정산을 흉내낸다 — 기록을 received 로 되돌린다
      const row = await returnRow(returnId);
      await getContainer().resolve(Modules.ORDER).updateReturns([
        {
          selector: { id: returnId },
          data: { metadata: { ...row.metadata, almondReturnSettlement: { ...row.metadata.almondReturnSettlement, stage: 'received' } } },
        },
      ]);
      const versionBefore = (await loadOrder(getContainer(), orderId)).version;

      const res = await api
        .post(
          `/admin/orders/${orderId}/partial-cancel`,
          { requestId: rid('pc'), items: [{ item_id: itemOf('E'), quantity: 1 }], reasonCode: 'CUSTOMER_REQUEST', requestedBy: 'operator' },
          c.adminHeaders,
        )
        .catch((e: any) => e.response);

      expect(res.status).toBe(500);
      expect((await loadOrder(getContainer(), orderId)).version).toBe(versionBefore);
      expect(wallet.refunds.map((r) => r.amount)).toEqual([24000]);
    });

    it('응답을 잃은 환불은 다시 나가지 않는다 — 같은 requestId 재시도가 장부 맞추기로 이 메모에 넣고 끝낸다', async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 1 }, { variant: 'B', quantity: 1 }]);
      const returnId = await requestReturn(orderId, itemOf('A'), 1);
      const requestId = rid('settle');
      const body = { requestId, items: [{ item_id: itemOf('A'), received: 1, dismissed: 0 }] };
      wallet.loseNextRefundResponse = true;

      expect((await settle(orderId, returnId, body)).status).toBe(502);
      expect(wallet.refunds).toHaveLength(1);

      const done = await settle(orderId, returnId, body);
      expect(done.status).toBe(200);
      expect(done.data.refund).toEqual({ mode: 'auto', amount: 24000 });
      expect(wallet.refundCalls()).toHaveLength(1);
      expect(wallet.refunds.map((r) => r.amount)).toEqual([24000]);
      expect(await ledgerRefunds(orderId)).toEqual([{ amount: 24000, note: `return-settle:${requestId}` }]);
      expect(readReturnSettlementRecord((await returnRow(returnId)).metadata)?.stage).toBe('refunded');
      expect(await balance(orderId)).toBe(0);
    });

    it('정산 밖에서 이미 수령한 반품 → 400 return_already_received', async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 1 }]);
      const returnId = await requestReturn(orderId, itemOf('A'), 1);
      const container = getContainer();
      await beginReceiveReturnWorkflow(container).run({ input: { return_id: returnId } });
      await receiveItemReturnRequestWorkflow(container).run({ input: { return_id: returnId, items: [{ id: itemOf('A'), quantity: 1 }] } });
      await confirmReturnReceiveWorkflow(container).run({ input: { return_id: returnId } });

      const res = await settle(orderId, returnId, { requestId: rid('settle'), items: [{ item_id: itemOf('A'), received: 1, dismissed: 0 }] });

      expect(res.status).toBe(400);
      expect(res.data).toEqual(expect.objectContaining({ code: 'return_settle_rejected', reason: 'return_already_received' }));
      expect(wallet.refundCalls()).toHaveLength(0);
    });

    it('다른 반품이 수령 뒤 청구 전에 멈춰 있으면 새 반품 정산은 500 — 깨짐을 두 번 받지 않는다, 그 반품이 끝나면 정산된다', async () => {
      // A·B·E 70,000 무료, 셋 다 배송완료. 반품 1 = A(변심), 반품 2 = E(변심)
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 1 }, { variant: 'B', quantity: 1 }, { variant: 'E', quantity: 1 }]);
      const return1 = await requestReturn(orderId, itemOf('A'), 1);
      const return2 = await requestReturn(orderId, itemOf('E'), 1);
      const rid1 = rid('settle');
      const rid2 = rid('settle');

      // 반품 1 이 수령 확정 + 기록 received 를 쓰고 택배비 청구 전에 끊겼다(수령은 정산과 같은 태그로)
      const container = getContainer();
      await beginReceiveReturnWorkflow(container).run({ input: { return_id: return1, internal_note: `return-receive:${rid1}` } });
      await receiveItemReturnRequestWorkflow(container).run({ input: { return_id: return1, items: [{ id: itemOf('A'), quantity: 1 }] } });
      await confirmReturnReceiveWorkflow(container).run({ input: { return_id: return1 } });
      const items1 = [{ itemId: itemOf('A'), received: 1, dismissed: 0 }];
      const stuck: ReturnSettlementRecord = {
        requestId: rid1,
        requestHash: hashReturnSettlement(rid1, items1),
        stage: 'received',
        items: items1,
        owed: 30000,
        deduction: { returnShipping: 3000, freeShippingBreak: 3000, roundTrip: 0 },
        feeNotAdjusted: false,
        refundAmount: 24000,
        groupFees: { [c.groups.cond.shippingProfileId]: 3000 },
        orderVersion: (await loadOrder(container, orderId)).version,
        receivedAt: new Date().toISOString(),
        chargeShippingOptionId: c.groups.cond.shippingOptionId,
      };
      const row1 = await returnRow(return1);
      await container.resolve(Modules.ORDER).updateReturns([
        { selector: { id: return1 }, data: { metadata: { ...row1.metadata, almondReturnSettlement: stuck } } },
      ]);

      const blocked = await settle(orderId, return2, { requestId: rid2, items: [{ item_id: itemOf('E'), received: 1, dismissed: 0 }] });
      expect(blocked.status).toBe(500);
      expect(await changesTagged(orderId, `return-receive:${rid2}`)).toHaveLength(0);
      expect((await returnRow(return2)).status).toBe('requested');

      // 반품 1 을 이어 끝낸다 — 청구 6,000, 환불 24,000
      const first = await settle(orderId, return1, { requestId: rid1, items: [{ item_id: itemOf('A'), received: 1, dismissed: 0 }] });
      expect(first.status).toBe(200);
      expect(first.data.refundAmount).toBe(24000);

      // 반품 2: 남는 B 30,000 의 3,000 은 반품 1 이 이미 받았다 — 반품 택배비만
      const second = await settle(orderId, return2, { requestId: rid2, items: [{ item_id: itemOf('E'), received: 1, dismissed: 0 }] });
      expect(second.status).toBe(200);
      expect(second.data.deduction).toEqual({ returnShipping: 3000, freeShippingBreak: 0, roundTrip: 0 });
      expect(second.data.refundAmount).toBe(7000);
      expect((await feeMethods(orderId)).map((m: any) => num(m.amount)).sort()).toEqual([3000, 6000]);
      expect(wallet.refunds.map((r) => r.amount)).toEqual([24000, 7000]);
      expect(await balance(orderId)).toBe(0);
    });

    // ── K8 PR6b — 선환불·외부 상계·보류 차감·미도착 닫기 ─────────────────────────────

    it('선환불 기본값 뒤 정산 → 환불 합 60,000 − 택배비, 마지막 차액 0, 크레딧 합 0, NOT_PAID 0', async () => {
      // A×2 변심 전량: V 60,000, 택배비 = 반품비 3,000 + 왕복 3,000 → 선환불 기본 54,000
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }]);
      const returnId = await requestReturn(orderId, itemOf('A'), 2);
      const prepayId = rid('cr');
      expect((await prepay(orderId, returnId, { requestId: prepayId, memo: '먼저' })).data.amount).toBe(54000);

      const res = await settle(orderId, returnId, { requestId: prepayId, items: [{ item_id: itemOf('A'), received: 2, dismissed: 0 }] });

      expect(res.status).toBe(200);
      expect(res.data).toEqual(
        expect.objectContaining({
          refundAmount: 0,
          prepaidApplied: 54000,
          externalRefundApplied: 0,
          deduction: { returnShipping: 3000, freeShippingBreak: 0, roundTrip: 3000 },
        }),
      );
      expect(readReturnSettlementRecord((await returnRow(returnId)).metadata)).toEqual(
        expect.objectContaining({ stage: 'refunded', owed: 60000, prepaidApplied: 54000, refundAmount: 0 }),
      );
      expect(wallet.refunds.map((r) => r.amount)).toEqual([54000]);
      expect(await chargeMethods(orderId)).toEqual([{ name: '반품 택배비', amount: 6000 }]);
      expect(await creditLines(orderId)).toEqual([]);
      expect(await pending(orderId)).toBe(0);
      expect(await balance(orderId)).toBe(0);
      expect(await notPaidCollections(orderId)).toBe(0);
    });

    it('품목 값 전액 선환불 뒤 정산 → 택배비 0 으로 깎임, 정산 환불 0, 차액 0', async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }]);
      const returnId = await requestReturn(orderId, itemOf('A'), 2);
      const requestId = rid('cr');
      expect((await prepay(orderId, returnId, { requestId, amount: 60000, memo: '전액' })).status).toBe(200);

      const res = await settle(orderId, returnId, { requestId, items: [{ item_id: itemOf('A'), received: 2, dismissed: 0 }] });

      expect(res.status).toBe(200);
      expect(res.data).toEqual(
        expect.objectContaining({ refundAmount: 0, prepaidApplied: 60000, deduction: { returnShipping: 0, freeShippingBreak: 0, roundTrip: 0 } }),
      );
      expect(await chargeMethods(orderId)).toEqual([]);
      expect(await changesTagged(orderId, `return-fee:${requestId}`)).toHaveLength(0);
      expect(wallet.refunds.map((r) => r.amount)).toEqual([60000]);
      expect(await pending(orderId)).toBe(0);
      expect(await creditLines(orderId)).toEqual([]);
      expect(await notPaidCollections(orderId)).toBe(0);
    });

    it('선환불이 먼저 Medusa 에 닿고 정산 → 정산이 P 만큼 덜 낸다', async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }]);
      const returnId = await requestReturn(orderId, itemOf('A'), 2);
      const requestId = rid('cr');
      expect((await prepay(orderId, returnId, { requestId, amount: 10000, memo: '일부 먼저' })).status).toBe(200);

      const res = await settle(orderId, returnId, { requestId, items: [{ item_id: itemOf('A'), received: 2, dismissed: 0 }] });

      expect(res.status).toBe(200);
      expect(res.data).toEqual(expect.objectContaining({ refundAmount: 44000, prepaidApplied: 10000 }));
      expect(await ledgerRefunds(orderId)).toEqual([
        { amount: 10000, note: `return-prepay:${requestId}` },
        { amount: 44000, note: `return-settle:${requestId}` },
      ]);
      expect(await pending(orderId)).toBe(0);
      expect(await creditLines(orderId)).toEqual([]);
      expect(await notPaidCollections(orderId)).toBe(0);
    });

    it('보류 차감 5,000·메모 → «반품 차감» 방법 5,000, 환불이 그만큼 적다 — 택배비와 한 주문 수정', async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }]);
      const returnId = await requestReturn(orderId, itemOf('A'), 2);
      const requestId = rid('cr');

      const res = await settle(orderId, returnId, {
        requestId,
        items: [{ item_id: itemOf('A'), received: 2, dismissed: 0 }],
        hold_deduction: { amount: 5000, memo: '사용 흔적' },
      });

      expect(res.status).toBe(200);
      expect(res.data).toEqual(
        expect.objectContaining({ refundAmount: 49000, deduction: { returnShipping: 3000, freeShippingBreak: 0, roundTrip: 3000, hold: 5000 } }),
      );
      expect(readReturnSettlementRecord((await returnRow(returnId)).metadata)).toEqual(
        expect.objectContaining({ hold: { requested: 5000, memo: '사용 흔적' }, refundAmount: 49000 }),
      );
      // 방법 둘이 한 주문 수정(return-fee 태그 하나)에 들어갔다
      expect(await changesTagged(orderId, `return-fee:${requestId}`)).toEqual([expect.objectContaining({ status: 'confirmed' })]);
      expect(await chargeMethods(orderId)).toEqual([
        { name: '반품 차감', amount: 5000 },
        { name: '반품 택배비', amount: 6000 },
      ]);
      expect(wallet.refunds.map((r) => r.amount)).toEqual([49000]);
      expect(await pending(orderId)).toBe(0);
      expect(await balance(orderId)).toBe(0);
      expect(await notPaidCollections(orderId)).toBe(0);
    });

    it('보류 차감 100,000 → 적용액 = 남은 돈, 환불 0, 기록에 요청·적용', async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }]);
      const returnId = await requestReturn(orderId, itemOf('A'), 2);

      const res = await settle(orderId, returnId, {
        requestId: rid('cr'),
        items: [{ item_id: itemOf('A'), received: 2, dismissed: 0 }],
        hold_deduction: { amount: 100000, memo: '전손' },
      });

      expect(res.status).toBe(200);
      expect(res.data).toEqual(
        expect.objectContaining({ refundAmount: 0, deduction: { returnShipping: 3000, freeShippingBreak: 0, roundTrip: 3000, hold: 54000 } }),
      );
      expect(readReturnSettlementRecord((await returnRow(returnId)).metadata)).toEqual(
        expect.objectContaining({
          stage: 'refunded',
          hold: { requested: 100000, memo: '전손' },
          deduction: { returnShipping: 3000, freeShippingBreak: 0, roundTrip: 3000, hold: 54000 },
          refundAmount: 0,
        }),
      );
      expect(wallet.refundCalls()).toHaveLength(0);
      expect(await chargeMethods(orderId)).toEqual([
        { name: '반품 차감', amount: 54000 },
        { name: '반품 택배비', amount: 6000 },
      ]);
      expect(await pending(orderId)).toBe(0);
      expect(await notPaidCollections(orderId)).toBe(0);
    });

    it('closesMissing 로 2개 중 1개만 정산 → partially_received, 환불 30,000 − 택배비', async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }]);
      const returnId = await requestReturn(orderId, itemOf('A'), 2);

      const res = await settle(orderId, returnId, {
        requestId: rid('cr'),
        items: [{ item_id: itemOf('A'), received: 1, dismissed: 0 }],
        closes_missing: true,
      });

      // 남는 A 30,000 은 50,000 아래 — 반품비 3,000 + 깨짐 3,000
      expect(res.status).toBe(200);
      expect(res.data).toEqual(
        expect.objectContaining({ refundAmount: 24000, deduction: { returnShipping: 3000, freeShippingBreak: 3000, roundTrip: 0 } }),
      );
      const row = await returnRow(returnId);
      expect(row.status).toBe('partially_received');
      expect(readReturnSettlementRecord(row.metadata)).toEqual(
        expect.objectContaining({ closesMissing: true, owed: 30000, items: [{ itemId: itemOf('A'), received: 1, dismissed: 0 }] }),
      );
      expect(wallet.refunds.map((r) => r.amount)).toEqual([24000]);
      expect(await pending(orderId)).toBe(0);
      expect(await notPaidCollections(orderId)).toBe(0);
    });

    it('closesMissing 없이 1개만 → 400 items_mismatch — closesMissing 이어도 반품 밖 품목·초과·0 은 items_mismatch', async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }, { variant: 'B', quantity: 1 }]);
      const returnId = await requestReturn(orderId, itemOf('A'), 2);

      for (const body of [
        { items: [{ item_id: itemOf('A'), received: 1, dismissed: 0 }] },
        { items: [{ item_id: itemOf('B'), received: 1, dismissed: 0 }], closes_missing: true },
        { items: [{ item_id: itemOf('A'), received: 2, dismissed: 1 }], closes_missing: true },
        { items: [{ item_id: itemOf('A'), received: 0, dismissed: 0 }], closes_missing: true },
      ]) {
        const res = await settle(orderId, returnId, { requestId: rid('cr'), ...body });
        expect(res.status).toBe(400);
        expect(res.data).toEqual(expect.objectContaining({ code: 'return_settle_rejected', reason: 'items_mismatch' }));
      }
      expect((await returnRow(returnId)).status).toBe('requested');
      expect(wallet.refundCalls()).toHaveLength(0);
    });

    it('선환불한 반품을 closesMissing 으로 정산 → 500, 반품 그대로(N15 — 상계 뒤 차액이 양수가 될 수 있다)', async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }]);
      const returnId = await requestReturn(orderId, itemOf('A'), 2);
      const requestId = rid('cr');
      expect((await prepay(orderId, returnId, { requestId, memo: '먼저' })).status).toBe(200);

      const res = await settle(orderId, returnId, {
        requestId,
        items: [{ item_id: itemOf('A'), received: 1, dismissed: 0 }],
        closes_missing: true,
      });

      expect(res.status).toBe(500);
      const row = await returnRow(returnId);
      expect(row.status).toBe('requested');
      expect(readReturnSettlementRecord(row.metadata)).toBeNull();
      expect(await changesTagged(orderId, `return-receive:${requestId}`)).toHaveLength(0);
    });

    it('외부 환불 있는 주문 + alreadyRefundedAmount → 그만큼 상계, 뒤의 부분취소가 그 외부 환불을 다시 묻지 않는다', async () => {
      // A×2 배송완료, E 미출고. 반품 요청 «뒤» 외부 환불 — 열린 반품 요청이 흡수해 크레딧이 안 붙는다(Task 1), 상계 라인도 0
      const { orderId, intentId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }, { variant: 'E', quantity: 1 }], ['A']);
      const returnId = await requestReturn(orderId, itemOf('A'), 2);
      wallet.addExternalRefund(intentId, 10000);

      const res = await settle(orderId, returnId, {
        requestId: rid('cr'),
        items: [{ item_id: itemOf('A'), received: 2, dismissed: 0 }],
        already_refunded_amount: 10000,
      });

      // 남는 E 10,000 — 반품비 3,000 + 깨짐 3,000
      expect(res.status).toBe(200);
      expect(res.data).toEqual(
        expect.objectContaining({
          refundAmount: 44000,
          externalRefundApplied: 10000,
          deduction: { returnShipping: 3000, freeShippingBreak: 3000, roundTrip: 0 },
        }),
      );
      expect(readReturnSettlementRecord((await returnRow(returnId)).metadata)).toEqual(expect.objectContaining({ externalRefundApplied: 10000 }));
      expect(await pending(orderId)).toBe(0);
      expect(await creditLines(orderId)).toEqual([]);

      const pc = await api
        .post(
          `/admin/orders/${orderId}/partial-cancel`,
          { requestId: rid('pc'), items: [{ item_id: itemOf('E'), quantity: 1 }], reasonCode: 'CUSTOMER_REQUEST', requestedBy: 'operator' },
          c.adminHeaders,
        )
        .catch((e: any) => e.response);
      // 외부 환불을 다시 묻지 않는다(external_refund_unresolved 아님). 금액은 N13 의 알려진 잔여 그대로다 — A×2+E «반품 먼저·취소
      // 나중»은 반품이 받은 깨짐 3,000 을 E 취소가 돌려준다(PR 6 (a-2), 고객 유리, 이 PR 에서 고치지 않는다)
      expect(pc.status).toBe(200);
      expect(pc.data).toEqual(expect.objectContaining({ refundAmount: 13000, shippingDelta: -3000, externalRefundApplied: 0 }));
      expect(wallet.refunds.map((r) => r.amount)).toEqual([10000, 44000, 13000]);
      expect(await pending(orderId)).toBe(0);
      // 반품 요청 «뒤» 외부 환불은 크레딧이 없어 상계 라인도 없다. 남은 +3,000 은 부분취소의 배송비 환불 몫에
      // refundPaymentWorkflow 가 붙인 크레딧이다(부분취소의 정상 장부)
      expect((await creditLines(orderId)).filter((l) => l.reference === 'return-offset')).toEqual([]);
      expect(await creditSum(orderId)).toBe(3000);
      expect(await notPaidCollections(orderId)).toBe(0);
    });

    it('alreadyRefundedAmount 가 미해결보다 크면 400 external_refund_exceeds, 외부 환불이 없는데 주면 external_refund_absent', async () => {
      const { orderId, intentId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }]);
      const returnId = await requestReturn(orderId, itemOf('A'), 2);
      const items = [{ item_id: itemOf('A'), received: 2, dismissed: 0 }];

      const absent = await settle(orderId, returnId, { requestId: rid('cr'), items, already_refunded_amount: 5000 });
      expect(absent.status).toBe(400);
      expect(absent.data).toEqual(expect.objectContaining({ code: 'return_settle_rejected', reason: 'external_refund_absent' }));

      wallet.addExternalRefund(intentId, 10000);
      const exceeds = await settle(orderId, returnId, { requestId: rid('cr'), items, already_refunded_amount: 20000 });
      expect(exceeds.status).toBe(400);
      expect(exceeds.data).toEqual(expect.objectContaining({ code: 'return_settle_rejected', reason: 'external_refund_exceeds' }));

      const row = await returnRow(returnId);
      expect(row.status).toBe('requested');
      expect(readReturnSettlementRecord(row.metadata)).toBeNull();
      expect(wallet.refundCalls()).toHaveLength(0);
    });

    it('반품 «전» 외부 환불(크레딧 +10,000) + alreadyRefundedAmount 10,000 → 상계 −10,000, 마지막 차액 0', async () => {
      const { orderId, itemOf } = await creditBackedExternalRefund([{ variant: 'A', quantity: 2 }], 10000);
      const returnId = await requestReturn(orderId, itemOf('A'), 2);
      const requestId = rid('cr');

      const res = await settle(orderId, returnId, {
        requestId,
        items: [{ item_id: itemOf('A'), received: 2, dismissed: 0 }],
        already_refunded_amount: 10000,
      });

      expect(res.status).toBe(200);
      expect(res.data).toEqual(expect.objectContaining({ refundAmount: 44000, externalRefundApplied: 10000 }));
      expect((await creditLines(orderId)).filter((l) => l.reference === 'return-offset')).toEqual([
        { amount: -10000, reference: 'return-offset', referenceId: requestId },
      ]);
      expect(await creditSum(orderId)).toBe(0);
      expect(wallet.refunds.map((r) => r.amount)).toEqual([10000, 44000]);
      expect(await pending(orderId)).toBe(0);
      expect(await balance(orderId)).toBe(0);
      expect(await notPaidCollections(orderId)).toBe(0);
    });

    it('received 에서 끊긴 보류 정산을 같은 요청으로 이어 가면 «반품 차감»·상계 라인이 하나씩', async () => {
      const { orderId, itemOf } = await creditBackedExternalRefund([{ variant: 'A', quantity: 2 }], 10000);
      const returnId = await requestReturn(orderId, itemOf('A'), 2);
      const requestId = rid('cr');
      const body = {
        requestId,
        items: [{ item_id: itemOf('A'), received: 2, dismissed: 0 }],
        hold_deduction: { amount: 5000, memo: '사용 흔적' },
        already_refunded_amount: 10000,
      };
      // 상계 라인을 넣은 «뒤» 택배비·차감 주문 수정 확정에서 끊는다
      jest.mocked(confirmOrderEditRequestWorkflow).mockImplementationOnce((() => ({
        run: async () => {
          throw new Error('확정 직전 끊김');
        },
      })) as unknown as typeof confirmOrderEditRequestWorkflow);

      const cut = await settle(orderId, returnId, body);
      expect(cut.status).toBe(500);
      expect(readReturnSettlementRecord((await returnRow(returnId)).metadata)?.stage).toBe('received');
      expect((await creditLines(orderId)).filter((l) => l.reference === 'return-offset')).toHaveLength(1);
      expect(await chargeMethods(orderId)).toEqual([]);
      expect(wallet.refundCalls()).toHaveLength(0);

      const done = await settle(orderId, returnId, body);
      expect(done.status).toBe(200);
      expect(done.data).toEqual(
        expect.objectContaining({
          refundAmount: 39000,
          externalRefundApplied: 10000,
          deduction: { returnShipping: 3000, freeShippingBreak: 0, roundTrip: 3000, hold: 5000 },
        }),
      );
      expect(await settle(orderId, returnId, body)).toEqual(expect.objectContaining({ status: 200 }));
      expect((await creditLines(orderId)).filter((l) => l.reference === 'return-offset')).toEqual([
        { amount: -10000, reference: 'return-offset', referenceId: requestId },
      ]);
      expect(await chargeMethods(orderId)).toEqual([
        { name: '반품 차감', amount: 5000 },
        { name: '반품 택배비', amount: 6000 },
      ]);
      expect(wallet.refunds.map((r) => r.amount)).toEqual([10000, 39000]);
      expect(await pending(orderId)).toBe(0);
      expect(await creditSum(orderId)).toBe(0);
      expect(await notPaidCollections(orderId)).toBe(0);
    });

    it('선환불이 있는데 환불 안 끝난 부분취소 기록이 있으면 500, 반품 그대로', async () => {
      // A×2 배송완료, E 미출고. A×2 반품 요청 → 선환불 → E 부분취소의 환불이 502 로 밀려 기록 edited
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }, { variant: 'E', quantity: 1 }], ['A']);
      const returnId = await requestReturn(orderId, itemOf('A'), 2);
      const requestId = rid('cr');
      expect((await prepay(orderId, returnId, { requestId, amount: 10000, memo: '먼저' })).status).toBe(200);
      wallet.failNextRefund = true;
      await expect(
        partialCancelOrder(getContainer(), { orderId, requestId: rid('pc'), items: [{ itemId: itemOf('E'), quantity: 1 }] }),
      ).rejects.toThrow();
      const callsBefore = wallet.refundCalls().length;

      const res = await settle(orderId, returnId, { requestId, items: [{ item_id: itemOf('A'), received: 2, dismissed: 0 }] });

      expect(res.status).toBe(500);
      const row = await returnRow(returnId);
      expect(row.status).toBe('requested');
      expect(readReturnSettlementRecord(row.metadata)).toBeNull();
      expect(await changesTagged(orderId, `return-receive:${requestId}`)).toHaveLength(0);
      expect(wallet.refundCalls()).toHaveLength(callsBefore);
    });

    it('같은 requestId 에 보류 차감액만 다르면 400 request_id_conflict', async () => {
      const { orderId, itemOf } = await deliveredOrder([{ variant: 'A', quantity: 2 }]);
      const returnId = await requestReturn(orderId, itemOf('A'), 2);
      const requestId = rid('cr');
      const items = [{ item_id: itemOf('A'), received: 2, dismissed: 0 }];
      expect((await settle(orderId, returnId, { requestId, items, hold_deduction: { amount: 5000, memo: '흔적' } })).status).toBe(200);

      // 메모는 해시 밖 — 같은 금액·다른 메모는 같은 요청이다
      const sameAmount = await settle(orderId, returnId, { requestId, items, hold_deduction: { amount: 5000, memo: '다른 메모' } });
      expect(sameAmount.status).toBe(200);
      const res = await settle(orderId, returnId, { requestId, items, hold_deduction: { amount: 3000, memo: '흔적' } });
      expect(res.status).toBe(400);
      expect(res.data).toEqual(expect.objectContaining({ code: 'return_settle_rejected', reason: 'request_id_conflict' }));
      const none = await settle(orderId, returnId, { requestId, items });
      expect(none.status).toBe(400);
      expect(none.data.reason).toBe('request_id_conflict');
      expect(wallet.refundCalls()).toHaveLength(1);
    });
  },
});
