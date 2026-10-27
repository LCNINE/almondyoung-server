import type { MedusaContainer } from '@medusajs/framework/types';
import { ChangeActionType, Modules } from '@medusajs/framework/utils';
import {
  beginOrderEditOrderWorkflow,
  confirmOrderEditRequestWorkflow,
  createOrderChangeActionsWorkflow,
  orderEditUpdateItemQuantityWorkflow,
  requestOrderEditRequestWorkflow,
} from '@medusajs/medusa/core-flows';

import { readWalletRefundRefusal } from '../../../modules/almond-payment/wallet-refund-refusal';
import { describeError } from '../../../utils/describe-error';
import { loadOrderView, productShippingProfiles, type OrderView } from '../settlement/load-order-view';
import { offsetCreditLine } from '../settlement/offset-credit-line';
import { addChargeShippingMethod, cancelOpenOrderEdit, ensureNoDanglingChange } from '../settlement/order-edit-charge';
import { orderCancelLockKey, orderPaymentIds } from '../settlement/order-payments';
import { refundOrderPayments } from '../settlement/refund-order-payments';
import type { RefundMode } from '../settlement/refund-mode';
import { reconcileOrderWalletRefunds } from '../settlement/wallet-refund-ledger';
import {
  assertNoReturnAwaitingCharge,
  loadReturnSettlementRecords,
  type ReturnSettlementRecord,
} from '../returns/return-settlement-record';
import { appliedExternalRefund, checkAlreadyRefunded, hashRequest, unresolvedExternalRefund } from './external-refund';
import type { OrderAdjustment } from './prorate-adjustments';
import { planPartialCancel, PartialCancelRejected, type CancelRequestItem, type OrderLine } from './plan-partial-cancel';
import { PARTIAL_CANCEL_CHARGE_NAME, planShipping } from './plan-shipping';
import { priorGroupFeesFor } from './prior-group-fees';
import { shippingPlanLines, shippingRefundFloorLines } from './shipping-plan-lines';
import { cancelShippingFeeBearer, type ShippingFeeBearer } from './shipping-fee-bearer';

export { PARTIAL_CANCEL_CHARGE_NAME };

export type PartialCancelInput = {
  orderId: string;
  requestId: string;
  items: CancelRequestItem[];
  /** 이번 취소 품목에 이미 다른 경로로 돌려준 금액(원) — 품목에 연결 안 된 외부 환불이 있을 때 필요하다(#1016 37번) */
  alreadyRefunded?: number;
  /** 없으면 auto(#1016 36번 재설계). 요청 해시에 넣지 않는다 — 자동 거절 뒤 같은 요청을 수동으로 다시 보낸다 */
  refundMode?: RefundMode;
  /** 취소 사유·요청 주체 — 택배비 부담을 정한다(K8). 요청 해시에 넣지 않는다: 옛 기록으로 멈춘 요청을 사유와 함께 다시 불러도 이어 가야 한다 */
  reasonCode?: string;
  requestedBy?: string;
  actorId?: string;
};
export type PartialCancelRecord = {
  requestHash: string;
  stage: 'edited' | 'refunded';
  items: CancelRequestItem[];
  /** 이번에 환불할(한) 총액 */
  refundAmount: number;
  shippingCharge: number;
  shippingRefund: number;
  shippingNotAdjusted: boolean;
  /** 이 부분취소 뒤 그룹 요금(shippingProfileId → 실제로 유효한 요금) — 다음 부분취소의 priorGroupFees */
  groupFees: Record<string, number>;
  /** 주문 수정을 확정한 시각. 환불 단계에서 바꾸지 않는다. */
  at: string;
  /** 주문 수정 확정 뒤의 주문 버전 — 여러 기록의 groupFees 를 겹칠 때 순서를 정한다. */
  orderVersion: number;
  /** 외부 환불에서 상계한 금액(음수 크레딧 라인). 운영자가 금액을 줬을 때만 있다 — 다음 판정의 U 에서 빠진다 */
  externalRefundApplied?: number;
  refundedAt?: string;
  /** 환불을 끝낸 방식 — refunded 때 쓴다. 옛 기록엔 없다(auto) */
  refundMode?: RefundMode;
  /** 무료배송이 깨질 때 택배비를 누가 냈나 — 옛 기록엔 없다(그땐 고객이 냈다) */
  shippingFeeBearer?: ShippingFeeBearer;
};
export type PartialCancelResult = {
  requestId: string;
  refundAmount: number;
  shippingDelta: number;
  shippingNotAdjusted: boolean;
  externalRefundApplied: number;
  /** 채널 전체취소 200 과 같은 칸(#1016 36번 재설계) */
  refund: { mode: RefundMode; amount: number };
  stage: 'refunded';
};

/** 주문 수정은 확정됐는데 환불을 끝내지 못했다. 같은 requestId 로 다시 부르면 환불부터 이어 간다. */
export class PartialCancelRefundPending extends Error {
  constructor(
    readonly requestId: string,
    message: string,
  ) {
    super(message);
    this.name = 'PartialCancelRefundPending';
  }
}

/**
 * 주문 수정은 확정됐는데 wallet 이 환불을 영구 거절했다(retryable: false, #1016 36번 재설계 §6.1). 의무는 장부의 음수 차액에 남는다.
 * 원인이 풀리거나 수동(refundMode manual)으로 같은 requestId 를 다시 부르면 환불부터 이어 간다.
 * PartialCancelRejected 를 상속하지 않는다 — 그건 «정해진 거절»(partial_cancel_rejected)이고 이건 수정이 끝난 뒤의 돈 문제다.
 */
export class PartialCancelRefundRefused extends Error {
  constructor(
    readonly requestId: string,
    readonly refusalCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'PartialCancelRefundRefused';
  }
}

/** 주문 하나의 부분취소를 직렬화한다. 레디스 잠금은 timeout 이 곧 만료라, 주문 수정 + 환불이 넉넉히 들어가게 잡는다. */
const ORDER_LOCK_TIMEOUT_SECONDS = 120;

/** 상계 음수 크레딧 라인의 reference — reference_id 는 requestId. 재시도가 이것으로 이미 넣었는지 본다 */
const OFFSET_CREDIT_LINE_REFERENCE = 'partial-cancel';

const editTag = (requestId: string) => `partial-cancel:${requestId}`;
const refundNote = (requestId: string) => `partial-cancel:${requestId}`;

/**
 * 채널 주문 부분취소 (#1016 35번, 스펙 §6.2, ADR-0042).
 *
 * Medusa 공식 워크플로를 차례로 부른다: 주문 수정(수량 감소 · 할인 비례 재작성 · 필요하면 «부분취소 배송비») → 확정 →
 * refundPaymentWorkflow 한 번. 배송비 환불 몫은 refundPaymentWorkflow 가 «돌려줄 차액»을 넘는 환불분에 크레딧 라인을
 * 스스로 붙여 장부를 맞춘다. 진행 단계는 주문 metadata.partialCancels[requestId] 에 남아, 같은 requestId 로 다시 부르면
 * 끊긴 곳부터 이어 간다.
 */
export async function partialCancelOrder(container: MedusaContainer, input: PartialCancelInput): Promise<PartialCancelResult> {
  const locking = container.resolve(Modules.LOCKING);
  return locking.execute(orderCancelLockKey(input.orderId), () => run(container, input), {
    timeout: ORDER_LOCK_TIMEOUT_SECONDS,
  });
}

async function run(container: MedusaContainer, input: PartialCancelInput): Promise<PartialCancelResult> {
  const requestHash = hashRequest(input.items, input.alreadyRefunded);
  let order = await loadOrder(container, input.orderId);
  const existing = readPartialCancelRecords(order.metadata)[input.requestId];
  if (existing && existing.requestHash !== requestHash) {
    throw new PartialCancelRejected(`같은 requestId 로 다른 요청이 왔습니다: ${input.requestId}`);
  }
  if (existing?.stage === 'refunded') return toResult(input.requestId, existing);
  const mode = input.refundMode ?? 'auto';

  if (!existing) {
    // ① 새 요청은 수정 «전»에 장부를 맞춘다 — 37번 판정(assertExternalRefundsResolved)이 투영 안 된 외부 환불까지 보게.
    // 맞추기가 넣은 환불은 차액을 움직이므로, 수정 전후 차액(owed)에 섞이지 않게 주문을 다시 읽는다. 실패하면 아무것도 안 바꾼 채 500
    await reconcileOrderWalletRefunds(container, input.orderId);
    order = await loadOrder(container, input.orderId);
  }
  const record = existing ?? (await edit(container, input, order, requestHash));

  try {
    // 수정은 확정됐다 — 여기부터의 실패는 refund_pending(재시도) 또는 영구 거절 표지(400, stage edited)다
    if (existing) await reconcileOrderWalletRefunds(container, input.orderId);
    // 상계 라인을 환불보다 «먼저» 넣는다 — 그래야 환불 뒤 차액이 0 이고, refundPaymentWorkflow 가 배송비 몫만 양수 라인으로 붙인다
    await offsetCreditLine(container, {
      orderId: input.orderId,
      reference: OFFSET_CREDIT_LINE_REFERENCE,
      referenceId: input.requestId,
      amount: record.externalRefundApplied ?? 0,
    });
    await refundOrderPayments(container, {
      orderId: input.orderId,
      amount: record.refundAmount,
      note: refundNote(input.requestId),
      mode,
      kind: 'ITEM_CANCEL',
      actorId: input.actorId,
    });
  } catch (error) {
    const refusal = readWalletRefundRefusal(error);
    if (refusal) throw new PartialCancelRefundRefused(input.requestId, refusal.code, refusal.message);
    throw new PartialCancelRefundPending(input.requestId, `부분취소 환불이 끝나지 않았습니다(${input.requestId}): ${describeError(error)}`);
  }
  const done: PartialCancelRecord = { ...record, stage: 'refunded', refundedAt: new Date().toISOString(), refundMode: mode };
  await writeRecord(container, input.orderId, input.requestId, done);
  return toResult(input.requestId, done);
}

async function edit(container: MedusaContainer, input: PartialCancelInput, order: OrderView, requestHash: string): Promise<PartialCancelRecord> {
  if (order.status === 'canceled') throw new PartialCancelRejected('이미 취소된 주문입니다');
  const returnRecords = await loadReturnSettlementRecords(container, order.id);
  // 수령은 됐는데 택배비 청구 전에 끊긴 반품 정산이 있으면 기다린다(500 → 호출자 재시도). 지금 부분취소하면 이 취소가
  // 깨짐을 받고, 이어 가는 반품 정산이 같은 깨짐을 또 받는다. 수령·청구는 같은 주문 잠금 안이라 이 창은 끊긴 정산 뒤에만 있다.
  // 주문을 바꾸는 단계보다 앞이다.
  assertNoReturnAwaitingCharge(returnRecords);
  // 계획 검증보다 «먼저» 본다: 확정 뒤 기록 전에 끊긴 요청은 이미 수량을 줄여 놨다. 줄을 통째로 뺐다면 계획 검증이
  // «주문에 없는 줄»로 업무 거절(400)을 내고, 호출자가 취소를 닫아 주문은 수정된 채 환불 0 으로 남는다.
  await ensureNoDanglingChange(container, order.id, editTag(input.requestId), async () => {
    await cancelOpenOrderEdit(container, order.id);
  });
  const plan = planPartialCancel(order.lines, input.items);
  // 끊긴 확정 수정을 먼저 가린 «뒤»에 본다 — 앞에 두면 그 경우가 업무 거절(400)로 닫혀 주문만 줄어든 채 남는다(Review Focus 1).
  // 계획 검증 «뒤»에 둬서 잘못된 수량은 금액을 묻기 전에 제 사유로 거절된다. 주문을 바꾸는 단계보다는 여전히 앞이다.
  await assertExternalRefundsResolved(container, order, returnRecords, input.alreadyRefunded);

  const profiles = await productShippingProfiles(
    container,
    order.lines.map((l) => l.productId).filter((x): x is string => !!x),
  );
  const newQty = new Map(plan.lines.map((p) => [p.itemId, p.newQty]));
  const bearer = cancelShippingFeeBearer(input);
  const shipping = planShipping({
    methods: order.shippingMethods,
    lines: shippingPlanLines(order.lines, newQty, profiles),
    // 청구는 돌아온 수량을 뺀 줄로, 환불은 돌아온 물건이 아직 있는 것처럼 센 요금 아래로 내려가지 않게 — 돌아온 물건의
    // 출고 배송비는 이미 썼다. 반품 뒤 남은 줄을 다 취소해도 처음 낸 배송비·반품이 받은 깨짐이 되돌아가지 않는다
    refundFloorLines: shippingRefundFloorLines(order.lines, newQty, profiles),
    postalCode: order.postalCode,
    priorGroupFees: priorGroupFeesFor(Object.values(readPartialCancelRecords(order.metadata)), returnRecords),
    chargeCap: bearer === 'seller' ? 0 : plan.itemRefundEstimate,
  });

  const { result: change } = await beginOrderEditOrderWorkflow(container).run({
    input: { order_id: order.id, created_by: input.actorId, internal_note: editTag(input.requestId) },
  });
  try {
    await orderEditUpdateItemQuantityWorkflow(container).run({
      input: { order_id: order.id, items: plan.lines.map((p) => ({ id: p.itemId, quantity: p.newQty })) },
    });

    // 수량 변경 워크플로가 (carry_over_promotions 가 꺼져 있으면) 기존 ITEM_ADJUSTMENTS_REPLACE 를 지우므로 그 «뒤»에 넣는다.
    const toReplace = plan.lines.flatMap((p) => (p.replaceAdjustments ? [{ itemId: p.itemId, adjustments: p.replaceAdjustments }] : []));
    if (toReplace.length > 0) {
      await createOrderChangeActionsWorkflow(container).run({
        input: toReplace.map((p) => ({
          order_change_id: change.id,
          order_id: order.id,
          version: change.version,
          action: ChangeActionType.ITEM_ADJUSTMENTS_REPLACE,
          details: { reference_id: p.itemId, adjustments: p.adjustments.map(toAdjustmentDetail) },
        })),
      });
    }

    if (shipping.adjustable && shipping.charge > 0) {
      const target = shipping.groups.find((g) => g.recordedFee > g.currentFee);
      if (!target) throw new Error('배송비 청구가 있는데 올라간 그룹이 없습니다');
      // 이름으로 «부분취소 배송비»를 표시한다 — 다음 부분취소의 그룹 판정에서 이 방법을 뺀다
      await addChargeShippingMethod(container, {
        orderId: order.id,
        orderChangeId: change.id,
        shippingOptionId: target.shippingOptionId,
        amount: shipping.charge,
        name: PARTIAL_CANCEL_CHARGE_NAME,
      });
    }

    await requestOrderEditRequestWorkflow(container).run({ input: { order_id: order.id, requested_by: input.actorId } });
    await confirmOrderEditRequestWorkflow(container).run({ input: { order_id: order.id, confirmed_by: input.actorId } });
  } catch (error) {
    // 확정 전 실패 — 열린 주문 수정을 버려 주문을 원래대로 둔다(더한 «부분취소 배송비» 방법도 지운다)
    await cancelOpenOrderEdit(container, order.id).catch(() => undefined);
    throw error instanceof Error ? error : new Error(`부분취소 주문 수정 실패: ${describeError(error)}`);
  }

  const edited = await loadOrder(container, order.id);
  // 이번 수정이 만든 «돌려줄 차액»만 센다. 수정 전부터 남아 있던 차액(예: 환불이 밀린 다른 부분취소)을 같이 돌려주지 않게.
  const owed = roundWon(order.pendingDifference - edited.pendingDifference);
  if (!Number.isFinite(owed)) throw new Error(`돌려줄 차액을 읽지 못했습니다: ${order.pendingDifference} → ${edited.pendingDifference}`);
  // 상계는 Medusa 가 받아 주는 만큼으로도 묶는다: validateOrderCreditLinesStep 은 음수 라인이 |수정 뒤 차액| 을 넘으면
  // 거절한다. owed 는 반올림한 값이라(29,285.71 → 29,286) 그대로 쓰면 재시도마다 거절돼 refund_pending 에 갇힌다 —
  // 차액을 내림한 만큼만 상계하고, 1원 미만 반올림 몫은 환불이 떠안는다.
  const room = edited.pendingDifference < 0 ? Math.floor(-edited.pendingDifference) : 0;
  const applied = Math.min(appliedExternalRefund(input.alreadyRefunded, owed), room);
  const record: PartialCancelRecord = {
    requestHash,
    stage: 'edited',
    items: normalizeItems(input.items),
    refundAmount: Math.max(0, owed) - applied + (shipping.adjustable ? shipping.refund : 0),
    shippingCharge: shipping.adjustable ? shipping.charge : 0,
    shippingRefund: shipping.adjustable ? shipping.refund : 0,
    shippingNotAdjusted: !shipping.adjustable,
    // newFee 가 아니라 recordedFee — 상한이 청구를 깎았으면 실제로 청구한 만큼만 다음 취소의 기준이 된다
    groupFees: shipping.adjustable ? Object.fromEntries(shipping.groups.map((g) => [g.shippingProfileId, g.recordedFee])) : {},
    at: new Date().toISOString(),
    orderVersion: edited.version,
    shippingFeeBearer: bearer,
    ...(input.alreadyRefunded !== undefined ? { externalRefundApplied: applied } : {}),
  };
  await writeRecord(container, order.id, input.requestId, record);
  return record;
}

/**
 * 품목에 연결 안 된 외부 환불(U)이 있는데 운영자가 «이미 환불한 금액»을 주지 않았으면 거절한다(#1016 37번, 스펙 §4.2).
 * 장부만 읽는다 — 투영이 외부 환불을 `wallet:` 메모로 남긴다. 앞선 부분취소와 반품 정산(K8 PR6b)이 상계로 가져간 몫은 뺀다.
 */
async function assertExternalRefundsResolved(
  container: MedusaContainer,
  order: OrderView,
  returnRecords: ReturnSettlementRecord[],
  alreadyRefunded: number | undefined,
) {
  const paymentIds = await orderPaymentIds(container, order.id);
  const payments = paymentIds.length
    ? await container.resolve(Modules.PAYMENT).listPayments({ id: paymentIds }, { relations: ['refunds'] })
    : [];
  const unresolved = unresolvedExternalRefund(
    payments.flatMap((p) => p.refunds ?? []),
    [...Object.values(readPartialCancelRecords(order.metadata)), ...returnRecords],
  );
  checkAlreadyRefunded(unresolved, alreadyRefunded);
}

// ── 조회 ──────────────────────────────────────────────────────────────────────

/** 주문을 «현재 버전» 기준으로 읽는다(읽기 본체는 settlement/load-order-view). 부분취소는 못 찾으면 정해진 거절이다. */
async function loadOrder(container: MedusaContainer, orderId: string): Promise<OrderView> {
  const order = await loadOrderView(container, orderId);
  if (!order) throw new PartialCancelRejected(`주문을 찾을 수 없습니다: ${orderId}`);
  return order;
}

// ── 기록 ──────────────────────────────────────────────────────────────────────

/** 주문 metadata 의 부분취소 기록들. 반품 정산도 읽는다 — 외부 환불 판정(상계한 몫)과 그룹 요금 겹치기. */
export function readPartialCancelRecords(metadata: unknown): Record<string, PartialCancelRecord> {
  const v = (metadata as Record<string, unknown> | null | undefined)?.partialCancels;
  if (!v || typeof v !== 'object') return {};
  // metadata 는 JSON 병합 갱신이라 «지운» 기록은 null 로 남는다 — 객체가 아닌 값은 기록이 없는 것으로 본다.
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>).filter((e): e is [string, PartialCancelRecord] => !!e[1] && typeof e[1] === 'object'),
  );
}

async function writeRecord(container: MedusaContainer, orderId: string, requestId: string, record: PartialCancelRecord) {
  const orderModule = container.resolve(Modules.ORDER);
  const current = await orderModule.retrieveOrder(orderId, { select: ['id', 'metadata'] });
  const meta = (current.metadata ?? {}) as Record<string, unknown>;
  await orderModule.updateOrders([
    { id: orderId, metadata: { ...meta, partialCancels: { ...readPartialCancelRecords(meta), [requestId]: record } } },
  ]);
}

// ── 작은 도우미 ────────────────────────────────────────────────────────────────

const normalizeItems = (items: CancelRequestItem[]): CancelRequestItem[] =>
  [...items].map((i) => ({ itemId: i.itemId, quantity: i.quantity })).sort((a, b) => a.itemId.localeCompare(b.itemId));

const toResult = (requestId: string, r: PartialCancelRecord): PartialCancelResult => ({
  requestId,
  refundAmount: r.refundAmount,
  shippingDelta: r.shippingCharge - r.shippingRefund,
  shippingNotAdjusted: r.shippingNotAdjusted,
  externalRefundApplied: r.externalRefundApplied ?? 0,
  refund: { mode: r.refundMode ?? 'auto', amount: r.refundAmount },
  stage: 'refunded',
});

/**
 * 원화는 소수가 없다. 주문 단위 고정 할인(across)은 줄마다 소수로 나뉘어(예: 714.29), 그런 줄을 빼면 돌려줄 차액도 소수가
 * 된다 — 환불은 원 단위여야 하므로 반올림한다. 남는 1원 미만 차이는 장부에 그대로 남는다.
 */
const roundWon = (n: number) => Math.round(n);

const toAdjustmentDetail = (a: OrderAdjustment) => ({
  amount: a.amount,
  code: a.code ?? undefined,
  promotion_id: a.promotion_id ?? undefined,
  description: a.description ?? undefined,
  is_tax_inclusive: a.is_tax_inclusive ?? false,
});
