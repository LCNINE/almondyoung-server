// apps/medusa/integration-tests/http/partial-cancel.spec.ts
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { Modules } from '@medusajs/framework/utils';
import { createOrderCreditLinesWorkflow, refundPaymentWorkflow } from '@medusajs/medusa/core-flows';
import {
  partialCancelOrder, PartialCancelRefundPending,
} from '../../src/workflows/orders/partial-cancel/partial-cancel-order';
import { PartialCancelRejected } from '../../src/workflows/orders/partial-cancel/plan-partial-cancel';
import { PartialCancelExternalRefundRejected } from '../../src/workflows/orders/partial-cancel/external-refund';
import { handleRefundProjection } from '../../src/api/hooks/payment-events/route';
import { POLICY_SNAPSHOT_KEY } from '../../src/modules/almond-fulfillment/types';
import {
  FakeWallet, WALLET_BASE_URL, setupCommerce, placeOrder, createOrderFixedPromo, createShippingFixedPromo, loadOrder, Commerce,
} from './fixtures/partial-cancel-fixture';

jest.setTimeout(300 * 1000);
process.env.WALLET_BASE_URL = WALLET_BASE_URL;
process.env.WALLET_API_KEY = 'test-wallet-key';
const wallet = new FakeWallet();
const num = (v: any) => Number(v?.numeric_ ?? v?.value ?? v);
const silent = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

/**
 * 채널 주문 부분취소 오케스트레이터(#1016 35번 PR-A, 스펙 §6.2). 금액은 픽스처 상품으로 손으로 계산한 값이다:
 * A·B 30,000 (조건부 무료 50,000 / 3,000), C 10,000 (고정 3,000), D 5,000 (수량당 1,000).
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: { WALLET_BASE_URL, WALLET_API_KEY: 'test-wallet-key' },
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let c: Commerce;
    const ctx = { api, getContainer };
    beforeAll(async () => {
      await wallet.start();
      c = await setupCommerce(ctx);
      await createOrderFixedPromo(ctx, c, 'PC6000', 6000);
      await createOrderFixedPromo(ctx, c, 'PC61750', 61750);
      await createShippingFixedPromo(ctx, c, 'PCSHIP3000', 3000);
    });
    afterAll(async () => wallet.stop());
    beforeEach(() => wallet.reset());

    const itemOf = (o: any, unitPrice: number) => o.items.find((i: any) => num(i.unit_price) === unitPrice);
    const balance = (o: any) => num(o.summary.pending_difference);

    it('줄 제거 + 조건부 무료 미달: 상품값 − 할인분 − 배송비를 한 번 환불하고 장부가 0 이 된다', async () => {
      // A 30,000 + B 30,000 (cond, 60,000 ≥ 50,000 → 무료), 할인 6,000 across → 줄마다 3,000
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 1 }, { variant: 'B', quantity: 1 }], promoCode: 'PC6000' });
      const o = await loadOrder(getContainer(), orderId);
      const b = o.items.find((i: any) => i.product_id !== itemOf(o, 30000).product_id) ?? o.items[1];

      const res = await partialCancelOrder(getContainer(), { orderId, requestId: 'req-1', items: [{ itemId: b.id, quantity: 1 }] });

      // 30,000 − 3,000(B 의 할인) − 3,000(남은 A 가 기준 미달)
      expect(res.refundAmount).toBe(24000);
      expect(res.shippingDelta).toBe(3000);
      expect(wallet.refunds.map((r) => r.amount)).toEqual([24000]);
      const after = await loadOrder(getContainer(), orderId);
      expect(balance(after)).toBe(0);
      expect(after.metadata.partialCancels['req-1'].stage).toBe('refunded');
      const charge = after.shipping_methods.find((m: any) => m.name === '부분취소 배송비');
      expect(num(charge?.amount)).toBe(3000);
    });

    it('수량 감소: 할인을 비례로 다시 쓴다', async () => {
      // A × 3 = 90,000, 할인 6,000 전부 A 줄. 1개 취소 → 남길 할인 4,000, 취소분 2,000. 남은 60,000 ≥ 50,000 → 배송비 변화 없음
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }], promoCode: 'PC6000' });
      const o = await loadOrder(getContainer(), orderId);

      const res = await partialCancelOrder(getContainer(), { orderId, requestId: 'req-2', items: [{ itemId: o.items[0].id, quantity: 1 }] });

      expect(res.refundAmount).toBe(28000);
      const after = await loadOrder(getContainer(), orderId);
      expect(after.items[0].adjustments.reduce((s: number, a: any) => s + num(a.amount), 0)).toBe(4000);
      expect(balance(after)).toBe(0);
    });

    it('그룹이 통째로 비면 그 그룹 배송비를 함께 돌려주고, 그 몫은 크레딧 라인으로 장부를 맞춘다', async () => {
      // A 60,000 이상 위해 A × 2(cond 무료) + C 10,000(flat 3,000)
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 2 }, { variant: 'C', quantity: 1 }] });
      const o = await loadOrder(getContainer(), orderId);

      const res = await partialCancelOrder(getContainer(), { orderId, requestId: 'req-3', items: [{ itemId: itemOf(o, 10000).id, quantity: 1 }] });

      expect(res.refundAmount).toBe(13000);
      expect(res.shippingDelta).toBe(-3000);
      const after = await loadOrder(getContainer(), orderId);
      expect(balance(after)).toBe(0);
      expect(after.credit_lines.reduce((s: number, l: any) => s + num(l.amount), 0)).toBe(3000);
    });

    it('같은 requestId 로 다시 부르면 아무것도 다시 하지 않고 같은 결과를 돌려준다', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
      const o = await loadOrder(getContainer(), orderId);
      const input = { orderId, requestId: 'req-4', items: [{ itemId: o.items[0].id, quantity: 1 }] };

      const first = await partialCancelOrder(getContainer(), input);
      const second = await partialCancelOrder(getContainer(), input);

      expect(second).toEqual(first);
      expect(wallet.refunds).toHaveLength(1);
    });

    it('같은 requestId 인데 내용이 다르면 거절한다', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
      const o = await loadOrder(getContainer(), orderId);
      await partialCancelOrder(getContainer(), { orderId, requestId: 'req-5', items: [{ itemId: o.items[0].id, quantity: 1 }] });

      await expect(
        partialCancelOrder(getContainer(), { orderId, requestId: 'req-5', items: [{ itemId: o.items[0].id, quantity: 2 }] }),
      ).rejects.toThrow(PartialCancelRejected);
    });

    it('환불이 한 번 실패하면 refund_pending 으로 멈추고, 다시 부르면 환불 단계부터 이어 간다(주문 수정은 한 번)', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
      const o = await loadOrder(getContainer(), orderId);
      const input = { orderId, requestId: 'req-6', items: [{ itemId: o.items[0].id, quantity: 1 }] };
      wallet.failNextRefund = true;

      const failure = await partialCancelOrder(getContainer(), input).catch((e) => e);
      expect(failure).toBeInstanceOf(PartialCancelRefundPending);
      expect(failure.requestId).toBe('req-6');
      expect(failure.message).not.toContain('[object Object]');
      const mid = await loadOrder(getContainer(), orderId);
      expect(mid.metadata.partialCancels['req-6'].stage).toBe('edited');
      const versionAfterEdit = mid.version;

      const res = await partialCancelOrder(getContainer(), input);
      expect(res.refundAmount).toBe(30000);
      expect(wallet.refunds.map((r) => r.amount)).toEqual([30000]);
      const after = await loadOrder(getContainer(), orderId);
      expect(after.version).toBe(versionAfterEdit);
      expect(balance(after)).toBe(0);
    });

    it('wallet 이 200 에 FAILED 환불 행을 담아 돌려주면 환불로 치지 않고 refund_pending 으로 멈추고, 다시 부르면 끝낸다', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
      const o = await loadOrder(getContainer(), orderId);
      const input = { orderId, requestId: 'req-6f', items: [{ itemId: o.items[0].id, quantity: 1 }] };
      wallet.failNextRefundAs200Failed = true;

      const failure = await partialCancelOrder(getContainer(), input).catch((e) => e);
      expect(failure).toBeInstanceOf(PartialCancelRefundPending);
      expect(failure.message).toMatch(/FAILED/);
      expect(wallet.refunds).toHaveLength(0);
      const mid = await loadOrder(getContainer(), orderId);
      expect(mid.metadata.partialCancels['req-6f'].stage).toBe('edited');
      // Medusa 장부에 환불이 남지 않는다 — 남으면 차액이 0 이 되어 아무도 다시 환불하지 않는다
      expect(mid.payment_collections[0].payments[0].refunds ?? []).toHaveLength(0);
      expect(balance(mid)).toBe(-30000);

      const res = await partialCancelOrder(getContainer(), input);
      expect(res.refundAmount).toBe(30000);
      expect(wallet.refunds.map((r) => r.amount)).toEqual([30000]);
      expect(balance(await loadOrder(getContainer(), orderId))).toBe(0);
    });

    it('같은 주문 두 번째 부분취소는 첫 번째가 남긴 그룹 요금에서 계산한다', async () => {
      // A × 2 (60,000 무료) → A 1개 취소(30,000 → 기준 미달, 3,000 차감) → 남은 A 1개 취소는 전체취소라 거절, 대신 D 를 섞는다
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 2 }, { variant: 'D', quantity: 2 }] });
      const o = await loadOrder(getContainer(), orderId);
      const a = itemOf(o, 30000);
      const d = itemOf(o, 5000);

      const first = await partialCancelOrder(getContainer(), { orderId, requestId: 'req-7a', items: [{ itemId: a.id, quantity: 1 }] });
      expect(first.shippingDelta).toBe(3000);
      const second = await partialCancelOrder(getContainer(), { orderId, requestId: 'req-7b', items: [{ itemId: d.id, quantity: 1 }] });
      // cond 그룹은 그대로(이미 3,000), perq 는 2,000 → 1,000
      expect(second.shippingDelta).toBe(-1000);
      expect(balance(await loadOrder(getContainer(), orderId))).toBe(0);
    });

    it('스냅샷 없는 주문은 배송비를 건드리지 않고 표시한다', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 2 }, { variant: 'C', quantity: 1 }] });
      // 배포 전 주문을 흉내: 배송 방법 data 에서 스냅샷을 지운다.
      // Medusa 는 JSON 컬럼을 병합 갱신하므로 `data: {}` 로는 안 지워진다 — 키를 null 로 쓴다.
      const orderModule = getContainer().resolve(Modules.ORDER);
      const o = await loadOrder(getContainer(), orderId);
      await orderModule.updateOrderShippingMethods(o.shipping_methods.map((m: any) => ({ id: m.id, data: { [POLICY_SNAPSHOT_KEY]: null } })));
      const wiped = await loadOrder(getContainer(), orderId);
      expect(wiped.shipping_methods.every((m: any) => m.data?.[POLICY_SNAPSHOT_KEY] == null)).toBe(true);

      const res = await partialCancelOrder(getContainer(), { orderId, requestId: 'req-8', items: [{ itemId: itemOf(o, 10000).id, quantity: 1 }] });
      expect(res.shippingNotAdjusted).toBe(true);
      expect(res.refundAmount).toBe(10000);
    });

    it('배송비 할인이 붙은 주문은 그룹이 비어도 배송비를 돌려주지 않는다 — 고객은 할인 뒤 금액을 냈다', async () => {
      // A×2 60,000(cond 무료) + C 10,000(flat 3,000 − 배송비 할인 3,000 = 0)
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 2 }, { variant: 'C', quantity: 1 }], shippingPromoCode: 'PCSHIP3000' });
      const o = await loadOrder(getContainer(), orderId);
      const orderModule = getContainer().resolve(Modules.ORDER);
      const [withAdj] = await orderModule.listOrders({ id: orderId }, { select: ['id'], relations: ['shipping_methods', 'shipping_methods.adjustments'] });
      const shipAdj = (withAdj.shipping_methods ?? []).flatMap((m: any) => m.adjustments ?? []).reduce((s: number, a: any) => s + num(a.amount), 0);
      expect(shipAdj).toBe(3000);

      // C 를 빼면 flat 그룹이 빈다. 할인 전 3,000 을 돌려주면 고객이 내지 않은 돈을 크레딧 라인으로 내준다.
      const res = await partialCancelOrder(getContainer(), { orderId, requestId: 'req-ship-disc', items: [{ itemId: itemOf(o, 10000).id, quantity: 1 }] });
      expect(res.shippingNotAdjusted).toBe(true);
      expect(res.shippingDelta).toBe(0);
      expect(res.refundAmount).toBe(10000);
      expect(wallet.refunds.map((r) => r.amount)).toEqual([10000]);
    });

    it('검증 거절은 주문을 건드리지 않는다', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 1 }] });
      const o = await loadOrder(getContainer(), orderId);
      await expect(
        partialCancelOrder(getContainer(), { orderId, requestId: 'req-9', items: [{ itemId: o.items[0].id, quantity: 1 }] }),
      ).rejects.toThrow(PartialCancelRejected);
      expect((await loadOrder(getContainer(), orderId)).version).toBe(o.version);
    });

    it('첫 부분취소가 배송비를 돌려주며 붙인 크레딧 라인은 두 번째 부분취소의 환불을 줄이지 않는다', async () => {
      // A×2 60,000 + C 10,000 + D×2 10,000 = 80,000, 할인 6,000 across → A 4,500 · C 750 · D 750.
      // 배송비: cond 0(60,000 ≥ 50,000) · flat 3,000 · perq 2,000.
      const { orderId } = await placeOrder(ctx, c, wallet, {
        lines: [{ variant: 'A', quantity: 2 }, { variant: 'C', quantity: 1 }, { variant: 'D', quantity: 2 }],
        promoCode: 'PC6000',
      });
      const o = await loadOrder(getContainer(), orderId);
      const adj = (i: any) => i.adjustments.reduce((s: number, a: any) => s + num(a.amount), 0);
      expect([adj(itemOf(o, 30000)), adj(itemOf(o, 10000)), adj(itemOf(o, 5000))]).toEqual([4500, 750, 750]);

      // C 를 빼면 flat 그룹이 빈다: 10,000 − 750 + 3,000 = 12,250. 배송비 3,000 은 크레딧 라인으로 맞춘다.
      const first = await partialCancelOrder(getContainer(), { orderId, requestId: 'req-10a', items: [{ itemId: itemOf(o, 10000).id, quantity: 1 }] });
      expect(first.refundAmount).toBe(12250);
      expect(first.shippingDelta).toBe(-3000);
      const mid = await loadOrder(getContainer(), orderId);
      expect(balance(mid)).toBe(0);
      expect(mid.credit_lines.reduce((s: number, l: any) => s + num(l.amount), 0)).toBe(3000);

      // D 2 → 1: 5,000 − 375(D 할인의 절반) + 1,000(perq 2,000 → 1,000) = 5,625. 첫 취소의 크레딧 라인 3,000 이 깎으면 안 된다.
      const second = await partialCancelOrder(getContainer(), { orderId, requestId: 'req-10b', items: [{ itemId: itemOf(o, 5000).id, quantity: 1 }] });
      expect(second.refundAmount).toBe(5625);
      expect(second.shippingDelta).toBe(-1000);
      expect(wallet.refunds.map((r) => r.amount)).toEqual([12250, 5625]);
      const after = await loadOrder(getContainer(), orderId);
      expect(balance(after)).toBe(0);
      expect(adj(after.items.find((i: any) => i.id === itemOf(o, 5000).id))).toBe(375);
    });

    it('환불이 밀린 부분취소가 있어도 다음 부분취소는 자기 몫만 돌려주고, 밀린 것은 다시 부를 때 자기 몫을 돌려준다', async () => {
      // A×3 90,000(cond 무료) + D×2 10,000(perq 2,000)
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }, { variant: 'D', quantity: 2 }] });
      const o = await loadOrder(getContainer(), orderId);
      const first = { orderId, requestId: 'req-12a', items: [{ itemId: itemOf(o, 30000).id, quantity: 1 }] };

      wallet.failNextRefund = true;
      await expect(partialCancelOrder(getContainer(), first)).rejects.toThrow(PartialCancelRefundPending);

      // 수정 전부터 남아 있던 −30,000 을 같이 돌려주면 안 된다: 5,000 + 1,000(perq 2,000 → 1,000)
      const second = await partialCancelOrder(getContainer(), { orderId, requestId: 'req-12b', items: [{ itemId: itemOf(o, 5000).id, quantity: 1 }] });
      expect(second.refundAmount).toBe(6000);

      const resumed = await partialCancelOrder(getContainer(), first);
      expect(resumed.refundAmount).toBe(30000);
      expect(wallet.refunds.map((r) => r.amount)).toEqual([6000, 30000]);
      expect(balance(await loadOrder(getContainer(), orderId))).toBe(0);
    });

    it('환불은 냈는데 기록 전에 끊겼다면, 다시 불러도 같은 요청의 환불을 두 번 내지 않는다', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
      const o = await loadOrder(getContainer(), orderId);
      const input = { orderId, requestId: 'req-13', items: [{ itemId: o.items[0].id, quantity: 1 }] };
      wallet.failNextRefund = true;
      await expect(partialCancelOrder(getContainer(), input)).rejects.toThrow(PartialCancelRefundPending);

      // 환불은 나갔지만 기록(stage refunded)을 쓰기 전에 끊긴 상황을 흉내: 같은 메모로 환불만 낸다
      const payment = o.payment_collections[0].payments[0];
      await refundPaymentWorkflow(getContainer()).run({ input: { payment_id: payment.id, amount: 30000, note: 'partial-cancel:req-13' } });

      const res = await partialCancelOrder(getContainer(), input);
      expect(res.refundAmount).toBe(30000);
      expect(wallet.refunds.map((r) => r.amount)).toEqual([30000]);
      expect(balance(await loadOrder(getContainer(), orderId))).toBe(0);
    });

    it('주문 수정이 확정됐는데 진행 기록이 없으면 두 번 취소하지 않고 멈춘다', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
      const o = await loadOrder(getContainer(), orderId);
      const input = { orderId, requestId: 'req-14', items: [{ itemId: o.items[0].id, quantity: 1 }] };
      await partialCancelOrder(getContainer(), input);

      // 확정과 기록 사이에 끊긴 상황을 흉내: 기록만 지운다(JSON 병합 갱신이라 null 로 쓴다)
      const orderModule = getContainer().resolve(Modules.ORDER);
      await orderModule.updateOrders([{ id: orderId, metadata: { partialCancels: { 'req-14': null } } }]);
      const before = await loadOrder(getContainer(), orderId);

      await expect(partialCancelOrder(getContainer(), input)).rejects.toThrow(/진행 기록이 없습니다/);
      const after = await loadOrder(getContainer(), orderId);
      expect(after.version).toBe(before.version);
      expect(num(after.items[0].quantity)).toBe(2);
      expect(wallet.refunds).toHaveLength(1);
    });

    it('확정 뒤 기록 전에 끊긴 요청이 줄을 통째로 뺐어도, 재시도는 업무 거절이 아니라 «진행 기록이 없습니다»로 멈춘다', async () => {
      // A + B, B 를 통째로 뺀다 → 재시도 시점엔 B 줄이 주문에 없다. 계획 검증이 먼저 돌면 «주문에 없는 줄»(400) 이 되어
      // 호출자가 취소를 닫아 버리고, 주문은 수정된 채 환불은 0 으로 남는다.
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 1 }, { variant: 'B', quantity: 1 }] });
      const o = await loadOrder(getContainer(), orderId);
      const input = { orderId, requestId: 'req-15', items: [{ itemId: o.items[1].id, quantity: 1 }] };
      await partialCancelOrder(getContainer(), input);

      const orderModule = getContainer().resolve(Modules.ORDER);
      await orderModule.updateOrders([{ id: orderId, metadata: { partialCancels: { 'req-15': null } } }]);
      const before = await loadOrder(getContainer(), orderId);

      const err = await partialCancelOrder(getContainer(), input).catch((e) => e);
      expect(err).not.toBeInstanceOf(PartialCancelRejected);
      expect(err.message).toMatch(/진행 기록이 없습니다/);
      expect((await loadOrder(getContainer(), orderId)).version).toBe(before.version);
      expect(wallet.refunds).toHaveLength(1);
    });

    it('한 요청이 한 줄은 통째로 빼고 할인이 붙은 다른 줄은 수량을 줄이면, 줄인 줄의 할인을 비례로 다시 쓰고 한 번 환불한다', async () => {
      // A×2 60,000 + C 10,000 + D×2 10,000 = 80,000, 할인 6,000 across → A 4,500 · C 750 · D 750.
      // C 통째로(10,000 − 750) + A 2 → 1(30,000 − 2,250) = 37,000.
      // 배송비: cond 0 → 3,000(남은 A 30,000 기준 미달, 청구) · flat 3,000 → 0(비어 환불) — 서로 상쇄돼 0.
      const { orderId } = await placeOrder(ctx, c, wallet, {
        lines: [{ variant: 'A', quantity: 2 }, { variant: 'C', quantity: 1 }, { variant: 'D', quantity: 2 }],
        promoCode: 'PC6000',
      });
      const o = await loadOrder(getContainer(), orderId);
      const a = itemOf(o, 30000);
      const cl = itemOf(o, 10000);

      const res = await partialCancelOrder(getContainer(), {
        orderId, requestId: 'req-16', items: [{ itemId: cl.id, quantity: 1 }, { itemId: a.id, quantity: 1 }],
      });

      expect(res.refundAmount).toBe(37000);
      expect(res.shippingDelta).toBe(0);
      expect(wallet.refunds.map((r) => r.amount)).toEqual([37000]);
      const after = await loadOrder(getContainer(), orderId);
      const aAfter = after.items.find((i: any) => i.id === a.id);
      expect(num(aAfter.quantity)).toBe(1);
      expect(aAfter.adjustments.reduce((s: number, x: any) => s + num(x.amount), 0)).toBe(2250);
      const cAfter = after.items.find((i: any) => i.id === cl.id);
      expect(!cAfter || num(cAfter.quantity) === 0).toBe(true);
      expect(balance(after)).toBe(0);
    });

    it('라우트: 성공 200, 거절 400 not_allowed, 환불 실패 502 refund_pending, 본문 오류 400 invalid_data, 무인증 거절', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
      const o = await loadOrder(getContainer(), orderId);
      const item = o.items[0].id;

      const noAuth = await api.post(`/admin/orders/${orderId}/partial-cancel`, { requestId: 'r-route-0', items: [{ item_id: item, quantity: 1 }] }).catch((e: any) => e.response);
      expect(noAuth.status).toBe(401);

      const invalid = await api.post(`/admin/orders/${orderId}/partial-cancel`, { requestId: 'r-route-0', items: [] }, c.adminHeaders).catch((e: any) => e.response);
      expect(invalid.status).toBe(400);
      expect(invalid.data.type).toBe('invalid_data');

      const bad = await api.post(`/admin/orders/${orderId}/partial-cancel`, { requestId: 'r-route-1', items: [{ item_id: item, quantity: 3 }] }, c.adminHeaders).catch((e: any) => e.response);
      expect(bad.status).toBe(400);
      expect(bad.data.type).toBe('not_allowed');
      expect(bad.data.code).toBe('partial_cancel_rejected');

      wallet.failNextRefund = true;
      const pending = await api.post(`/admin/orders/${orderId}/partial-cancel`, { requestId: 'r-route-2', items: [{ item_id: item, quantity: 1 }] }, c.adminHeaders).catch((e: any) => e.response);
      expect(pending.status).toBe(502);
      expect(pending.data).toEqual(expect.objectContaining({ type: 'refund_pending', stage: 'edited', requestId: 'r-route-2' }));

      const ok = await api.post(`/admin/orders/${orderId}/partial-cancel`, { requestId: 'r-route-2', items: [{ item_id: item, quantity: 1 }] }, c.adminHeaders);
      expect(ok.status).toBe(200);
      expect(ok.data).toEqual(expect.objectContaining({ requestId: 'r-route-2', refundAmount: 30000, stage: 'refunded' }));
      expect(ok.data).toHaveProperty('shippingDelta');
      expect(ok.data).toHaveProperty('shippingNotAdjusted');
    });

    it('상한에 깎인 배송비 청구는 깎인 만큼만 기록되고, 그 그룹이 나중에 비면 실제로 청구한 만큼만 돌려준다', async () => {
      // A 30,000 + B 30,000 + D 5,000 = 65,000, 할인 61,750 across → A 28,500 · B 28,500 · D 4,750.
      // 배송비: cond 0(60,000 ≥ 50,000) · perq 1,000.
      const { orderId } = await placeOrder(ctx, c, wallet, {
        lines: [{ variant: 'A', quantity: 1 }, { variant: 'B', quantity: 1 }, { variant: 'D', quantity: 1 }],
        promoCode: 'PC61750',
      });
      const o = await loadOrder(getContainer(), orderId);
      const [first30, second30] = o.items.filter((i: any) => num(i.unit_price) === 30000);
      expect(first30.adjustments.reduce((s: number, a: any) => s + num(a.amount), 0)).toBe(28500);

      // 하나를 빼면 cond 가 기준 미달(3,000)이 되지만 청구는 상한(30,000 − 28,500 = 1,500)에 깎인다 → 환불 0.
      const first = await partialCancelOrder(getContainer(), { orderId, requestId: 'req-11a', items: [{ itemId: second30.id, quantity: 1 }] });
      expect(first.refundAmount).toBe(0);
      expect(first.shippingDelta).toBe(1500);
      expect(wallet.refunds).toHaveLength(0);
      const mid = await loadOrder(getContainer(), orderId);
      expect(balance(mid)).toBe(0);
      expect(mid.metadata.partialCancels['req-11a'].groupFees[c.groups.cond.shippingProfileId]).toBe(1500);

      // 남은 30,000 을 빼면 cond 그룹이 빈다: 상품 1,500(30,000 − 28,500) + 실제로 청구했던 1,500 = 3,000 (3,000 이 아니라 4,500 이면 과환불).
      const second = await partialCancelOrder(getContainer(), { orderId, requestId: 'req-11b', items: [{ itemId: first30.id, quantity: 1 }] });
      expect(second.shippingDelta).toBe(-1500);
      expect(second.refundAmount).toBe(3000);
      expect(wallet.refunds.map((r) => r.amount)).toEqual([3000]);
      expect(balance(await loadOrder(getContainer(), orderId))).toBe(0);
    });

    it('특성(#1016 37번): 음수 크레딧 라인만 있으면 합이 0 으로 잘려 차액이 움직이지 않는다', async () => {
      // A×3 90,000(cond 무료). 환불을 실패시켜 «수정 확정 · 환불 전»에 멈춘다 → 차액 −30,000
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
      const o = await loadOrder(getContainer(), orderId);
      wallet.failNextRefund = true;
      await expect(
        partialCancelOrder(getContainer(), { orderId, requestId: 'req-37-char', items: [{ itemId: o.items[0].id, quantity: 1 }] }),
      ).rejects.toThrow(PartialCancelRefundPending);
      expect(balance(await loadOrder(getContainer(), orderId))).toBe(-30000);

      // 실측: 워크플로는 던지지 않고 라인을 저장하며 credit_line_total 은 −10,000 이 되지만,
      // pending_difference 는 −30,000 그대로다 — calculateCreditLinesTotal 이 합 ≤ 0 을 0 으로 자른다.
      await createOrderCreditLinesWorkflow(getContainer()).run({
        input: { id: orderId, credit_lines: [{ amount: -10000, reference: 'partial-cancel', reference_id: 'req-37-char' }] },
      });
      const after = await loadOrder(getContainer(), orderId);
      expect(after.credit_lines.reduce((s: number, l: any) => s + num(l.amount), 0)).toBe(-10000);
      expect(after.credit_lines.filter((l: any) => l.reference_id === 'req-37-char')).toHaveLength(1);
      expect(num(after.summary.credit_line_total)).toBe(-10000);
      expect(balance(after)).toBe(-30000);
    });

    it('특성(#1016 37번): 앞선 양수 라인을 상쇄하는 음수 라인은 수정 직후에도 차액을 그만큼 줄인다', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
      const o = await loadOrder(getContainer(), orderId);
      // 외부 환불이 남기는 +10,000 라인 — 안전망이 거절하는 `wallet:` 메모 없이 만든다
      const payment = o.payment_collections[0].payments[0];
      await refundPaymentWorkflow(getContainer()).run({ input: { payment_id: payment.id, amount: 10000, note: 'char-positive' } });
      const mid = await loadOrder(getContainer(), orderId);
      expect(balance(mid)).toBe(0);
      expect(mid.credit_lines.reduce((s: number, l: any) => s + num(l.amount), 0)).toBe(10000);

      wallet.failNextRefund = true;
      await expect(
        partialCancelOrder(getContainer(), { orderId, requestId: 'req-37-char2', items: [{ itemId: o.items[0].id, quantity: 1 }] }),
      ).rejects.toThrow(PartialCancelRefundPending);
      expect(balance(await loadOrder(getContainer(), orderId))).toBe(-30000);

      await createOrderCreditLinesWorkflow(getContainer()).run({
        input: { id: orderId, credit_lines: [{ amount: -10000, reference: 'partial-cancel', reference_id: 'req-37-char2' }] },
      });
      const after = await loadOrder(getContainer(), orderId);
      expect(balance(after)).toBe(-20000);
      expect(after.credit_lines.reduce((s: number, l: any) => s + num(l.amount), 0)).toBe(0);
      expect(after.credit_lines.filter((l: any) => l.reference_id === 'req-37-char2')).toHaveLength(1);
    });

    const project = (orderId: string, intentId: string, amount: number, id: string) =>
      handleRefundProjection(getContainer(), intentId, amount, `msg-${id}`, orderId, silent, { refundId: id, reasonCode: 'ADMIN_REFUND' });
    const ourLines = (o: any, requestId: string) => o.credit_lines.filter((l: any) => l.reference === 'partial-cancel' && l.reference_id === requestId);
    const creditSum = (o: any) => o.credit_lines.reduce((s: number, l: any) => s + num(l.amount), 0);

    describe('외부 환불 뒤 부분취소 (#1016 37번)', () => {
      it('금액 없이 오면 주문을 건드리지 않고 거절한다 — 사유와 미해결 금액', async () => {
        const { orderId, intentId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
        await project(orderId, intentId, 10000, 'wr-37-a');
        const o = await loadOrder(getContainer(), orderId);

        const err = await partialCancelOrder(getContainer(), { orderId, requestId: 'req-37-a', items: [{ itemId: o.items[0].id, quantity: 1 }] }).catch((e) => e);
        expect(err).toBeInstanceOf(PartialCancelExternalRefundRejected);
        expect(err).toMatchObject({ reason: 'external_refund_unresolved', unresolvedAmount: 10000 });
        expect((await loadOrder(getContainer(), orderId)).version).toBe(o.version);
        expect(wallet.callsTo('/refund')).toBe(0);
      });

      it('이미 환불한 금액만큼 음수 크레딧 라인으로 상계하고 나머지만 환불한다 — 장부 0', async () => {
        const { orderId, intentId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
        await project(orderId, intentId, 10000, 'wr-37-b');
        const o = await loadOrder(getContainer(), orderId);

        const res = await partialCancelOrder(getContainer(), {
          orderId, requestId: 'req-37-b', items: [{ itemId: o.items[0].id, quantity: 1 }], alreadyRefunded: 10000,
        });
        expect(res).toMatchObject({ refundAmount: 20000, externalRefundApplied: 10000 });
        expect(wallet.refunds.map((r) => r.amount)).toEqual([20000]);
        const after = await loadOrder(getContainer(), orderId);
        expect(balance(after)).toBe(0);
        expect(creditSum(after)).toBe(0);
        expect(ourLines(after, 'req-37-b').map((l: any) => num(l.amount))).toEqual([-10000]);
        expect(after.metadata.partialCancels['req-37-b']).toMatchObject({ stage: 'refunded', externalRefundApplied: 10000 });
      });

      it('환불이 실패한 뒤 다시 부르면 음수 라인을 두 번 넣지 않는다', async () => {
        const { orderId, intentId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
        await project(orderId, intentId, 10000, 'wr-37-c');
        const o = await loadOrder(getContainer(), orderId);
        const input = { orderId, requestId: 'req-37-c', items: [{ itemId: o.items[0].id, quantity: 1 }], alreadyRefunded: 10000 };
        wallet.failNextRefund = true;
        await expect(partialCancelOrder(getContainer(), input)).rejects.toThrow(PartialCancelRefundPending);
        expect(ourLines(await loadOrder(getContainer(), orderId), 'req-37-c')).toHaveLength(1);

        const res = await partialCancelOrder(getContainer(), input);
        expect(res.refundAmount).toBe(20000);
        const after = await loadOrder(getContainer(), orderId);
        expect(ourLines(after, 'req-37-c')).toHaveLength(1);
        expect(wallet.refunds.map((r) => r.amount)).toEqual([20000]);
        expect(balance(after)).toBe(0);
      });

      it('0 원이면 전액 환불하고 외부 환불은 미해결로 남아 다음 부분취소가 다시 묻는다', async () => {
        const { orderId, intentId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
        await project(orderId, intentId, 10000, 'wr-37-d');
        const o = await loadOrder(getContainer(), orderId);

        const first = await partialCancelOrder(getContainer(), {
          orderId, requestId: 'req-37-d1', items: [{ itemId: o.items[0].id, quantity: 1 }], alreadyRefunded: 0,
        });
        expect(first).toMatchObject({ refundAmount: 30000, externalRefundApplied: 0 });
        expect('externalRefundApplied' in (await loadOrder(getContainer(), orderId)).metadata.partialCancels['req-37-d1']).toBe(true);

        const err = await partialCancelOrder(getContainer(), { orderId, requestId: 'req-37-d2', items: [{ itemId: o.items[0].id, quantity: 1 }] }).catch((e) => e);
        expect(err).toMatchObject({ reason: 'external_refund_unresolved', unresolvedAmount: 10000 });
      });

      it('품목 차액보다 큰 금액은 차액까지만 상계하고 남은 몫은 미해결로 둔다', async () => {
        const { orderId, intentId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
        await project(orderId, intentId, 40000, 'wr-37-e');
        const o = await loadOrder(getContainer(), orderId);

        const res = await partialCancelOrder(getContainer(), {
          orderId, requestId: 'req-37-e1', items: [{ itemId: o.items[0].id, quantity: 1 }], alreadyRefunded: 40000,
        });
        expect(res).toMatchObject({ refundAmount: 0, externalRefundApplied: 30000 });
        expect(wallet.callsTo('/refund')).toBe(0);
        const after = await loadOrder(getContainer(), orderId);
        expect(balance(after)).toBe(0);
        expect(creditSum(after)).toBe(10000);

        const err = await partialCancelOrder(getContainer(), { orderId, requestId: 'req-37-e2', items: [{ itemId: o.items[0].id, quantity: 1 }] }).catch((e) => e);
        expect(err).toMatchObject({ reason: 'external_refund_unresolved', unresolvedAmount: 10000 });
      });

      it('미해결보다 큰 금액·외부 환불 없는데 금액은 거절한다', async () => {
        const { orderId, intentId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
        const o = await loadOrder(getContainer(), orderId);
        const item = [{ itemId: o.items[0].id, quantity: 1 }];
        await expect(partialCancelOrder(getContainer(), { orderId, requestId: 'req-37-f1', items: item, alreadyRefunded: 5000 }))
          .rejects.toMatchObject({ reason: 'external_refund_absent' });
        await project(orderId, intentId, 10000, 'wr-37-f');
        const versionAfterProjection = (await loadOrder(getContainer(), orderId)).version; // 투영이 크레딧 라인을 더해 버전이 올랐다
        await expect(partialCancelOrder(getContainer(), { orderId, requestId: 'req-37-f2', items: item, alreadyRefunded: 10001 }))
          .rejects.toMatchObject({ reason: 'external_refund_exceeds', unresolvedAmount: 10000 });
        expect((await loadOrder(getContainer(), orderId)).version).toBe(versionAfterProjection);
      });

      it('배송비 환불이 섞여도 상계는 품목 몫만 — 양수 라인은 배송비 몫만 붙고 장부 0', async () => {
        // A×2 60,000(cond 무료) + C 10,000(flat 3,000). C 를 빼면 flat 그룹이 빈다: 10,000 + 3,000
        const { orderId, intentId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 2 }, { variant: 'C', quantity: 1 }] });
        await project(orderId, intentId, 5000, 'wr-37-g');
        const o = await loadOrder(getContainer(), orderId);

        const res = await partialCancelOrder(getContainer(), {
          orderId, requestId: 'req-37-g', items: [{ itemId: itemOf(o, 10000).id, quantity: 1 }], alreadyRefunded: 5000,
        });
        expect(res).toMatchObject({ refundAmount: 8000, shippingDelta: -3000, externalRefundApplied: 5000 });
        expect(wallet.refunds.map((r) => r.amount)).toEqual([8000]);
        const after = await loadOrder(getContainer(), orderId);
        expect(balance(after)).toBe(0);
        // +5,000(외부) −5,000(상계) +3,000(배송비 환불)
        expect(creditSum(after)).toBe(3000);
      });

      it('확정 뒤 기록 전에 끊긴 요청은 외부 환불이 있어도 업무 거절이 아니라 «진행 기록이 없습니다»로 멈춘다', async () => {
        const { orderId, intentId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
        const o = await loadOrder(getContainer(), orderId);
        const input = { orderId, requestId: 'req-37-h', items: [{ itemId: o.items[0].id, quantity: 1 }] };
        await partialCancelOrder(getContainer(), input);
        await project(orderId, intentId, 10000, 'wr-37-h');
        const orderModule = getContainer().resolve(Modules.ORDER);
        await orderModule.updateOrders([{ id: orderId, metadata: { partialCancels: { 'req-37-h': null } } }]);

        const err = await partialCancelOrder(getContainer(), input).catch((e) => e);
        expect(err).not.toBeInstanceOf(PartialCancelRejected);
        expect(err.message).toMatch(/진행 기록이 없습니다/);
      });

      it('외부 환불이 없는 주문은 지금과 같다 — 결과에 상계 0, 기록에 상계 키 없음', async () => {
        const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
        const o = await loadOrder(getContainer(), orderId);
        const res = await partialCancelOrder(getContainer(), { orderId, requestId: 'req-37-i', items: [{ itemId: o.items[0].id, quantity: 1 }] });
        expect(res).toMatchObject({ refundAmount: 30000, externalRefundApplied: 0 });
        expect('externalRefundApplied' in (await loadOrder(getContainer(), orderId)).metadata.partialCancels['req-37-i']).toBe(false);
      });

      it('라우트: 400 에 사유·미해결 금액, already_refunded 로 200 + 상계액', async () => {
        const { orderId, intentId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
        await project(orderId, intentId, 10000, 'wr-37-r');
        const o = await loadOrder(getContainer(), orderId);
        const item = o.items[0].id;

        const rejected = await api
          .post(`/admin/orders/${orderId}/partial-cancel`, { requestId: 'r-37-1', items: [{ item_id: item, quantity: 1 }] }, c.adminHeaders)
          .catch((e: any) => e.response);
        expect(rejected.status).toBe(400);
        expect(rejected.data).toMatchObject({ type: 'not_allowed', code: 'partial_cancel_rejected', reason: 'external_refund_unresolved', unresolvedAmount: 10000 });

        const bad = await api
          .post(`/admin/orders/${orderId}/partial-cancel`, { requestId: 'r-37-2', items: [{ item_id: item, quantity: 1 }], already_refunded: -1 }, c.adminHeaders)
          .catch((e: any) => e.response);
        expect(bad.status).toBe(400);
        expect(bad.data.type).toBe('invalid_data');

        const ok = await api.post(
          `/admin/orders/${orderId}/partial-cancel`,
          { requestId: 'r-37-3', items: [{ item_id: item, quantity: 1 }], already_refunded: 10000 },
          c.adminHeaders,
        );
        expect(ok.status).toBe(200);
        expect(ok.data).toMatchObject({ refundAmount: 20000, externalRefundApplied: 10000 });
      });
    });
  },
});
