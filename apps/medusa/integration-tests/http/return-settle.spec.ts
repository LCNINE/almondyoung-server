// apps/medusa/integration-tests/http/return-settle.spec.ts
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { ensureReturnShippingOption } from '../../src/modules/almond-fulfillment/return-shipping-option';
import { cancelOrderReturn } from '../../src/workflows/orders/returns/cancel-order-return';
import { ensureReturnReasons } from '../../src/workflows/orders/returns/return-reasons';
import { readReturnSettlementRecord } from '../../src/workflows/orders/returns/return-settlement-record';
import { requestOrderReturn } from '../../src/workflows/orders/returns/request-order-return';
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
  },
});
