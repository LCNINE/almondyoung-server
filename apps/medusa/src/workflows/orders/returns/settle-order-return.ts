import type { MedusaContainer } from '@medusajs/framework/types';
import { Modules, ReturnStatus } from '@medusajs/framework/utils';
import {
  beginReceiveReturnWorkflow,
  cancelReturnReceiveWorkflow,
  confirmReturnReceiveWorkflow,
  dismissItemReturnRequestWorkflow,
  receiveItemReturnRequestWorkflow,
} from '@medusajs/medusa/core-flows';

import { readWalletRefundRefusal } from '../../../modules/almond-payment/wallet-refund-refusal';
import { describeError } from '../../../utils/describe-error';
import { toNumber } from '../partial-cancel/amount';
import { checkAlreadyRefunded, PartialCancelExternalRefundRejected, unresolvedExternalRefund } from '../partial-cancel/external-refund';
import { readPartialCancelRecords } from '../partial-cancel/partial-cancel-order';
import { RETURN_FEE_CHARGE_NAME, RETURN_HOLD_DEDUCTION_NAME } from '../partial-cancel/plan-shipping';
import { priorGroupFeesFor } from '../partial-cancel/prior-group-fees';
import { shippingPlanLines } from '../partial-cancel/shipping-plan-lines';
import { loadOrderView, productShippingProfiles, type OrderView } from '../settlement/load-order-view';
import { offsetCreditLine } from '../settlement/offset-credit-line';
import { addSettlementCharge, cancelOpenOrderEdit, ensureNoDanglingChange } from '../settlement/order-edit-charge';
import { listOrderRefunds, orderCancelLockKey } from '../settlement/order-payments';
import { refundOrderPayments } from '../settlement/refund-order-payments';
import type { RefundMode } from '../settlement/refund-mode';
import { reconcileOrderWalletRefunds } from '../settlement/wallet-refund-ledger';
import { applyReturnOffsets } from './apply-return-offsets';
import { chargeShippingOption } from './charge-shipping-option';
import { addExchangeReplacements, planExchangeReplacements } from './exchange-replacements';
import { isExchangeRecord, readReturnRequestRecord } from './load-return-order';
import { planReturnFees, type ReturnSettlementDeduction } from './plan-return-fees';
import { ReturnOrderNotFound } from './request-order-return';
import { prepaidTotal } from './return-prepay-record';
import {
  assertNoReturnAwaitingCharge,
  assertReadableSettlementRecord,
  hashReturnSettlement,
  loadReturnSettlementRecords,
  readReturnSettlementRecord,
  RETURN_SETTLEMENT_METADATA_KEY,
  type ReturnExchangeItem,
  type ReturnSettlementRecord,
} from './return-settlement-record';

export type SettleOrderReturnInput = {
  orderId: string;
  returnId: string;
  /** core customer_returns.id — 환불 메모·주문 변경 태그가 이것으로 만들어진다 */
  requestId: string;
  /** 반품 품목마다 수령(양품)·폐기(불량·보류). 합이 반품 품목 수량과 같아야 한다 */
  items: Array<{ itemId: string; received: number; dismissed: number }>;
  /** 없으면 auto. 요청 해시에 넣지 않는다 — 자동 거절 뒤 같은 요청을 수동으로 다시 보낸다 */
  refundMode?: RefundMode;
  actorId?: string;
  // ── PR 6b(CS 의 문) — 셋 다 요청 해시에 든다(보류 차감은 금액만). 재발행은 같은 값을 내므로 늘 같고, 다르면 request_id_conflict ──
  /** CS 보류 차감 요청액(N2·N3). 넘치면 남은 돈 안으로 깎는다 — 수령 뒤라 거절하면 반품이 received 에 갇힌다 */
  holdDeduction?: { amount: number; memo: string };
  /** CS 가 적은 «이미 환불한 외부 환불»(N16) — 있으면 그만큼 상계하고, 없으면 PR 6 처럼 미해결 외부 환불을 거절한다 */
  alreadyRefundedAmount?: number;
  /** core 가 미도착 수량을 닫았다(N8) — 품목이 반품 품목의 부분집합·수량 미달이어도 받는다. 남은 반품 품목은 취소하지 않는다 */
  closesMissing?: boolean;
};

export type SettleOrderReturnResult = {
  returnId: string;
  requestId: string;
  refundAmount: number;
  /** 택배비 세 몫 + 보류 차감 적용액(hold, 보류 정산일 때만) */
  deduction: ReturnSettlementDeduction;
  feeNotAdjusted: boolean;
  /** 선환불에서 덜 낸 몫 */
  prepaidApplied: number;
  /** CS 가 적은 외부 환불에서 덜 낸 몫 */
  externalRefundApplied: number;
  refund: { mode: RefundMode; amount: number };
  /** exchanged = 교환 정산(K8 PR11) — 환불 0, 대체 품목 줄을 exchangeItems 에 싣는다 */
  stage: 'refunded' | 'exchanged';
  exchangeItems?: ReturnExchangeItem[];
};

export type ReturnSettleRejectReason =
  | 'not_our_return'
  | 'return_canceled'
  | 'request_id_conflict'
  | 'items_mismatch'
  | 'external_refund_unresolved'
  | 'external_refund_exceeds'
  | 'external_refund_absent'
  | 'return_already_received'
  | 'prepaid_closes_missing'
  | 'no_charge_shipping_option'
  | 'exchange_settle_unsupported';

/**
 * 정해진 거절 — 다시 불러도 같다. 라우트가 400 code=return_settle_rejected + reason 으로 낸다. 반품·주문은 그대로다.
 * external_refund_* 는 미해결 외부 환불(unresolvedAmount, 원)을 싣는다 — CS 가 «이미 환불한 금액»을 채울 숫자다(부분취소와 같다).
 */
export class ReturnSettleRejected extends Error {
  constructor(
    readonly reason: ReturnSettleRejectReason,
    message: string,
    readonly unresolvedAmount?: number,
  ) {
    super(message);
    this.name = 'ReturnSettleRejected';
  }
}

/** 수령(과 택배비)은 확정됐는데 환불을 끝내지 못했다. 같은 requestId 로 다시 부르면 환불부터 이어 간다. */
export class ReturnSettleRefundPending extends Error {
  constructor(
    readonly requestId: string,
    message: string,
  ) {
    super(message);
    this.name = 'ReturnSettleRefundPending';
  }
}

/** 수령은 확정됐는데 wallet 이 환불을 영구 거절했다(retryable: false). 의무는 장부의 음수 차액에 남는다. */
export class ReturnSettleRefundRefused extends Error {
  constructor(
    readonly requestId: string,
    readonly refusalCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'ReturnSettleRefundRefused';
  }
}

/** 부분취소와 같은 잠금·같은 만료 — 수령 + 택배비 주문 수정 + 환불이 넉넉히 들어가게 잡는다. */
const ORDER_LOCK_TIMEOUT_SECONDS = 120;

const receiveTag = (requestId: string) => `return-receive:${requestId}`;
const feeTag = (requestId: string) => `return-fee:${requestId}`;
const refundNote = (requestId: string) => `return-settle:${requestId}`;
/** 상계 크레딧 라인(N6) — reference_id 는 requestId. 부분취소는 'partial-cancel' */
const RETURN_OFFSET_REFERENCE = 'return-offset';

/**
 * 반품 정산(K8 PR6, N13·N14). 수령 확정(받은 품목 receive · 폐기 품목 dismiss) → 상계 크레딧 라인 → 택배비·보류 차감
 * 주문 수정(«반품 택배비»·«반품 차감» 방법, 0 원 몫은 건너뜀) → RETURN 환불. 청구는 수령 «뒤»에 넣는다 — 앞에 넣으면
 * 차액이 잠깐 양수가 돼 NOT_PAID 결제 컬렉션이 생긴다. 단계는 반품 metadata 의 정산 기록에 남고, 같은 requestId 로
 * 다시 부르면 기록의 단계부터 잇는다.
 * PR 6b: 수령이 만든 «돌려줄 차액»을 선환불(return-prepay 메모 환불 합) → CS 가 적은 외부 환불 → 택배비 → 보류 차감 순으로
 * 채우고(applyReturnOffsets) 남은 것만 환불한다.
 */
export async function settleOrderReturn(container: MedusaContainer, input: SettleOrderReturnInput): Promise<SettleOrderReturnResult> {
  const locking = container.resolve(Modules.LOCKING);
  return locking.execute(orderCancelLockKey(input.orderId), () => run(container, input), {
    timeout: ORDER_LOCK_TIMEOUT_SECONDS,
  });
}

export type ReturnRow = {
  id: string;
  orderId: string;
  status: string;
  metadata: Record<string, unknown> | null;
  /** item_id → 반품 품목 수량(같은 줄이 여러 행이면 합) */
  quantities: Map<string, number>;
};

async function run(container: MedusaContainer, input: SettleOrderReturnInput): Promise<SettleOrderReturnResult> {
  const ret = await loadReturn(container, input.returnId);
  // 다른 주문의 반품 id 는 «없는 반품» — 존재 여부를 가르지 않는다
  if (!ret || ret.orderId !== input.orderId) throw new ReturnOrderNotFound(`반품을 찾을 수 없습니다: ${input.returnId}`);
  const request = readReturnRequestRecord(ret.metadata);
  if (!request) throw new ReturnSettleRejected('not_our_return', '이 반품은 정산할 수 없습니다');
  if (ret.status === ReturnStatus.CANCELED) throw new ReturnSettleRejected('return_canceled', '취소된 반품입니다');
  const exchange = isExchangeRecord(request);
  if (exchange) assertExchangeSettlable(input, request.feeBearer);
  const requestHash = hashReturnSettlement(input.requestId, input.items, {
    holdDeductionAmount: input.holdDeduction?.amount,
    alreadyRefundedAmount: input.alreadyRefundedAmount,
    closesMissing: input.closesMissing,
  });
  const existing = readReturnSettlementRecord(ret.metadata);
  if (existing && existing.requestHash !== requestHash) {
    throw new ReturnSettleRejected('request_id_conflict', `이 반품에 다른 정산 요청이 이미 있습니다: ${input.requestId}`);
  }
  if (existing?.stage === 'refunded' || existing?.stage === 'exchanged') return toResult(input, existing);
  const mode = input.refundMode ?? 'auto';

  const received = existing ?? (await receive(container, input, ret, request.feeBearer, requestHash, exchange));
  const charged = received.stage === 'received' ? await charge(container, input, received) : received;
  if (exchange) return exchangeAfterReceive(container, input, ret.id, charged);

  try {
    // 수령은 확정됐다 — 여기부터의 실패는 refund_pending(재시도) 또는 영구 거절 표지(400)다.
    // 이어 가는 호출은 응답을 잃은 환불을 이 메모로 장부에 넣은 뒤 남은 몫만 낸다.
    if (existing) await reconcileOrderWalletRefunds(container, input.orderId);
    await refundOrderPayments(container, {
      orderId: input.orderId,
      amount: charged.refundAmount,
      note: refundNote(input.requestId),
      mode,
      kind: 'RETURN',
      actorId: input.actorId,
    });
  } catch (error) {
    const refusal = readWalletRefundRefusal(error);
    if (refusal) throw new ReturnSettleRefundRefused(input.requestId, refusal.code, refusal.message);
    throw new ReturnSettleRefundPending(input.requestId, `반품 환불이 끝나지 않았습니다(${input.requestId}): ${describeError(error)}`);
  }
  const done: ReturnSettlementRecord = { ...charged, stage: 'refunded', refundedAt: new Date().toISOString(), refundMode: mode };
  await writeRecord(container, ret.id, done);
  return toResult(input, done);
}

/** ① 수령 확정 → 돌려줄 차액·택배비 계획 → 기록 received. 기록이 없을 때만 온다. */
async function receive(
  container: MedusaContainer,
  input: SettleOrderReturnInput,
  ret: ReturnRow,
  feeBearer: 'customer' | 'seller',
  requestHash: string,
  exchange: boolean,
): Promise<ReturnSettlementRecord> {
  const closesMissing = input.closesMissing === true;
  assertItemsMatch(ret.quantities, input.items, closesMissing);
  // 이 반품은 아직 기록이 없으니 목록은 «다른» 반품들의 기록이다. 수령까지 하고 청구 전에 멈춘 반품이 있으면 기다린다(500 → 재시도):
  // 그 반품의 groupFees 는 아직 겹치기에 안 들어가(charged·refunded 만) 이 반품이 같은 깨짐을 받고, 그 반품이 이어 가며 또 받는다.
  const otherReturns = await loadReturnSettlementRecords(container, input.orderId);
  assertNoReturnAwaitingCharge(otherReturns);
  // 수령 «전»에 장부를 맞춘다 — 투영 안 된 외부 환불까지 보고 거절하게, 응답을 잃은 선환불까지 P 에 들게
  await reconcileOrderWalletRefunds(container, input.orderId);
  const reconciled = await loadOrder(container, input.orderId);
  const refunds = await listOrderRefunds(container, input.orderId);
  // 교환은 돈이 움직이지 않는다(환불 대신 대체 품목) — 품목에 연결 안 된 외부 환불이 있어도 이중 환불이 생기지 않는다.
  // 교환은 alreadyRefundedAmount 도 받지 않으니(assertExchangeSettlable) 이 검사를 두면 그런 주문의 교환은 나갈 길이 없다
  if (!exchange) assertExternalRefundResolved(refunds, reconciled, otherReturns, input.alreadyRefundedAmount);
  // 선환불한 금액의 정본은 이 메모 환불 행이다(N6) — 선환불 기록의 amount 가 아니다
  const prepaid = prepaidTotal(refunds, input.requestId);
  const externalRefund = input.alreadyRefundedAmount ?? 0;
  assertOffsetPremises(reconciled, otherReturns, { prepaid, externalRefund, closesMissing });
  // 청구를 붙일 배송 옵션은 수령 «전»에 정한다 — 수령 뒤에 못 찾고 던지면 수령은 확정됐는데 기록이 없어 다시 부를 때마다
  // ensureNoDanglingChange 가 멈춘다. 배송 방법은 수령으로 바뀌지 않는다. 택배비가 있으면 계획이 맞춘 그룹이라 늘 찾는다
  const profiles = await productShippingProfiles(
    container,
    reconciled.lines.map((l) => l.productId).filter((x): x is string => !!x),
  );
  const chargeOptionId = chargeShippingOption(reconciled.shippingMethods, reconciled.lines, profiles, input.items);
  if (!chargeOptionId && (input.holdDeduction?.amount ?? 0) > 0) {
    throw new ReturnSettleRejected(
      'no_charge_shipping_option',
      `보류 차감을 붙일 배송 방법이 없는 주문입니다 — 차감 없이 정산하거나 수동으로 처리하세요: ${input.orderId}`,
    );
  }

  const tag = receiveTag(input.requestId);
  // 확정됐는데 기록이 없으면(확정과 기록 사이에 끊김) 다시 받으면 재고·차액이 두 번 움직인다 — 멈춘다. 열린 채면 버리고 새로 한다
  await ensureNoDanglingChange(container, input.orderId, tag, async () => {
    await cancelReturnReceiveWorkflow(container).run({ input: { return_id: ret.id } });
  });
  // 우리 태그의 확정 수령이 없는데 이미 받은 반품 — 다른 경로(기본 라우트·대시보드)가 받았다. 차액이 이미 움직여 돌려줄 돈을 셀 수 없다
  if (ret.status === ReturnStatus.RECEIVED || ret.status === ReturnStatus.PARTIALLY_RECEIVED) {
    throw new ReturnSettleRejected('return_already_received', '정산 밖에서 이미 수령한 반품입니다 — 수동 확인이 필요합니다');
  }
  // 맞추기·끊긴 수령 버리기가 모두 끝난 «뒤»에 읽는다 — 그 둘이 움직인 차액이 owed 에 섞이지 않게
  const before = await loadOrder(container, input.orderId);
  await beginReceiveReturnWorkflow(container).run({
    input: { return_id: ret.id, created_by: input.actorId, internal_note: tag },
  });
  try {
    const good = input.items.filter((i) => i.received > 0).map((i) => ({ id: i.itemId, quantity: i.received }));
    const bad = input.items.filter((i) => i.dismissed > 0).map((i) => ({ id: i.itemId, quantity: i.dismissed }));
    if (good.length > 0) await receiveItemReturnRequestWorkflow(container).run({ input: { return_id: ret.id, items: good } });
    if (bad.length > 0) await dismissItemReturnRequestWorkflow(container).run({ input: { return_id: ret.id, items: bad } });
    await confirmReturnReceiveWorkflow(container).run({ input: { return_id: ret.id, confirmed_by: input.actorId } });
  } catch (error) {
    // 확정 전 실패 — 열린 수령을 버려 반품을 원래대로 둔다
    await cancelReturnReceiveWorkflow(container)
      .run({ input: { return_id: ret.id } })
      .catch(() => undefined);
    throw error instanceof Error ? error : new Error(`반품 수령 실패: ${describeError(error)}`);
  }

  const after = await loadOrder(container, input.orderId);
  // 이번 수령이 만든 «돌려줄 차액»만 센다(Task 1 실측: 요청 확정은 차액을 안 움직이고 수령·폐기 확정이 움직인다)
  const owed = Math.round(before.pendingDifference - after.pendingDifference);
  if (!Number.isFinite(owed)) throw new Error(`돌려줄 차액을 읽지 못했습니다: ${before.pendingDifference} → ${after.pendingDifference}`);

  // 택배비 계획은 수령 «뒤»에 돈다 — 상한(chargeCap)은 돌려줄 차액에서 선환불·외부 상계를 뺀 것(N3: 상계가 택배비보다 먼저다).
  // 남는 수량 = 줄 수량 − 돌아온 수량(이번 반품이 이미 들어 있다). 미도착을 닫았으면 input.items 가 실제로 정산한 품목이다
  const returnedNow = new Map(input.items.map((i) => [i.itemId, i.received + i.dismissed]));
  const plan = planReturnFees({
    feeBearer,
    methods: after.shippingMethods,
    lines: shippingPlanLines(after.lines, new Map(), profiles).map((l) => ({ ...l, returnedNow: returnedNow.get(l.itemId) ?? 0 })),
    postalCode: after.postalCode,
    priorGroupFees: priorGroupFeesFor(Object.values(readPartialCancelRecords(after.metadata)), otherReturns),
    chargeCap: Math.max(0, owed - prepaid - externalRefund),
  });
  const offsets = applyReturnOffsets({
    owed,
    // Medusa 는 음수 크레딧 라인이 |수령 뒤 차액| 을 넘으면 거절한다(부분취소의 room 과 같다)
    room: after.pendingDifference < 0 ? Math.floor(-after.pendingDifference) : 0,
    diffBeforeReceive: before.pendingDifference,
    prepaid,
    externalRefund,
    fees: plan.deduction,
    holdRequested: input.holdDeduction?.amount ?? 0,
  });
  // 상계 라인은 원 단위로 내린다 — 수령 전 차액에 원 미만(할인 안분 잔여)이 섞이면 식이 소수를 낸다. room 이 라인을 묶은 경우
  // (원 미만 반올림 몫)도 그 차이는 원 미만의 음수 차액으로 남는다. 부분취소는 그 몫을 환불이 떠안지만 여기서는 상계 적용액
  // (externalRefundApplied)을 줄이지 않는다 — 그 값은 다음 판정의 «품목에 연결 안 된 외부 환불»에서만 빠지고, 원 미만은 잡음이다
  const offsetLine = Math.floor(offsets.offsetCreditLine);
  const chargeTotal = deductionTotal(offsets.deduction);
  const chargeShippingOptionId = chargeTotal > 0 ? chargeOptionId : null;
  // 닿지 않는 자리 — 보류 차감은 위에서 거절했고 택배비는 계획이 그룹(옵션이 있는 원래 방법)을 맞췄을 때만 0 보다 크다
  if (chargeTotal > 0 && !chargeShippingOptionId) throw new Error(`반품 택배비·차감을 붙일 배송 방법을 찾지 못했습니다: ${input.orderId}`);

  const record: ReturnSettlementRecord = {
    requestId: input.requestId,
    requestHash,
    stage: 'received',
    items: normalizeItems(input.items),
    owed,
    deduction: offsets.deduction,
    feeNotAdjusted: plan.feeNotAdjusted,
    refundAmount: offsets.refundAmount,
    // 보류 차감은 그룹 요금이 아니다(N2) — 택배비 계획의 그룹 요금만 남긴다
    groupFees: plan.groupFees,
    orderVersion: after.version,
    receivedAt: new Date().toISOString(),
    chargeShippingOptionId,
    ...(input.holdDeduction ? { hold: { requested: input.holdDeduction.amount, memo: input.holdDeduction.memo } } : {}),
    prepaidApplied: offsets.prepaidApplied,
    externalRefundApplied: offsets.externalRefundApplied,
    ...(closesMissing ? { closesMissing: true } : {}),
    ...(offsetLine > 0 ? { offsetCreditLine: offsetLine } : {}),
  };
  await writeRecord(container, ret.id, record);
  return record;
}

/**
 * ② 상계 크레딧 라인 → 택배비·보류 차감 주문 수정 하나(«반품 택배비»·«반품 차감») → 기록 charged. 셋 다 0 이면 아무것도 없이 charged.
 * 라인을 «먼저» 넣는다 — Medusa 는 음수 라인이 |차액| 을 넘으면 거절하는데, 청구가 차액을 줄이기 전이 가장 넓다. 라인은
 * 같은 reference·requestId 가 있으면 건너뛰고, 끊긴 주문 수정은 버리고 새로 하므로 이어 가기가 두 번 넣지 않는다.
 */
async function charge(container: MedusaContainer, input: SettleOrderReturnInput, record: ReturnSettlementRecord): Promise<ReturnSettlementRecord> {
  await offsetCreditLine(container, {
    orderId: input.orderId,
    reference: RETURN_OFFSET_REFERENCE,
    referenceId: input.requestId,
    amount: record.offsetCreditLine ?? 0,
  });
  const fees = record.deduction.returnShipping + record.deduction.freeShippingBreak + record.deduction.roundTrip;
  const hold = record.deduction.hold ?? 0;
  if (fees + hold > 0) {
    const tag = feeTag(input.requestId);
    await ensureNoDanglingChange(container, input.orderId, tag, async () => {
      await cancelOpenOrderEdit(container, input.orderId);
    });
    // 옵션은 수령 때 정해 기록에 둔 값 — 이어 갈 때 주문의 배송 방법 순서에 다시 기대지 않는다
    if (!record.chargeShippingOptionId) throw new Error(`차감이 있는데 택배비 배송 옵션이 기록에 없습니다: ${input.returnId}`);
    await addSettlementCharge(container, {
      orderId: input.orderId,
      tag,
      shippingOptionId: record.chargeShippingOptionId,
      charges: [
        { name: RETURN_FEE_CHARGE_NAME, amount: fees },
        { name: RETURN_HOLD_DEDUCTION_NAME, amount: hold },
      ],
      actorId: input.actorId,
    });
  }
  const charged: ReturnSettlementRecord = { ...record, stage: 'charged' };
  await writeRecord(container, input.returnId, charged);
  return charged;
}

/**
 * ③' 교환(K8 PR11 N3·N4·N5) — 환불 대신 주문 수정으로 variant 없는 대체 품목 줄을 넣어 수령이 만든 «돌려줄 차액»을 0 으로
 * 되돌린다 → 기록 exchanged(refundAmount 0). 청구 단계는 부담 주체 seller 라 0 이다. 대체 줄 넣기는 태그로 멱등이고,
 * 확정 뒤 차액이 0 이 아니면 일반 Error(500, 재시도) — 기록은 charged 로 남아 다시 부르면 이 단계부터 잇는다.
 */
async function exchangeAfterReceive(
  container: MedusaContainer,
  input: SettleOrderReturnInput,
  returnId: string,
  charged: ReturnSettlementRecord,
): Promise<SettleOrderReturnResult> {
  const order = await loadOrder(container, input.orderId);
  // 원래 품목 줄로 계획한다 — 끊긴 뒤 이어 가면 이미 넣은 대체 줄이 있을 수 있지만 계획은 원래 품목 id 로만 줄을 찾는다
  const replacements = planExchangeReplacements(order.lines, charged.items);
  const exchangeItems = await addExchangeReplacements(container, {
    orderId: input.orderId,
    requestId: input.requestId,
    replacements,
    actorId: input.actorId,
  });
  const done: ReturnSettlementRecord = {
    ...charged,
    stage: 'exchanged',
    refundAmount: 0,
    exchangedAt: new Date().toISOString(),
    exchangeItems,
  };
  await writeRecord(container, returnId, done);
  return toResult(input, done);
}

// ── 판정 ──────────────────────────────────────────────────────────────────────

/**
 * 교환 정산은 돈이 움직이지 않는다(설계 E2) — 보류 차감·외부 환불 상계·미도착 닫기는 교환에 없다. 수령 «전»에 거절해
 * 반품이 requested 로 남는다(N3). 보류 차감은 금액이 0 보다 클 때만 차감이다.
 */
function assertExchangeSettlable(input: SettleOrderReturnInput, feeBearer: 'customer' | 'seller'): void {
  // 접수가 seller 만 받는다(N2) — 다른 길로 생긴 기록이면 택배비가 매겨져 차액이 0 으로 돌아오지 않는다(방어)
  if (feeBearer !== 'seller') {
    throw new ReturnSettleRejected('exchange_settle_unsupported', '판매자 잘못 사유가 아닌 교환 기록은 정산할 수 없습니다');
  }
  if ((input.holdDeduction?.amount ?? 0) > 0 || input.alreadyRefundedAmount !== undefined || input.closesMissing === true) {
    throw new ReturnSettleRejected(
      'exchange_settle_unsupported',
      '교환은 보류 차감·이미 환불한 금액·미도착 닫기 없이 정산합니다 — 그 처리가 필요하면 반품으로 접수하세요',
    );
  }
}

/**
 * 품목 집합이 반품 품목과 같고, 줄마다 수령 + 폐기 = 반품 품목 수량(PR 6). 미도착을 닫았으면(N8) 반품 품목의 부분집합이고
 * 줄마다 0 < 수령 + 폐기 ≤ 반품 품목 수량 — 남은 수량은 요청 상태로 남는다(반품 partially_received).
 */
function assertItemsMatch(quantities: ReadonlyMap<string, number>, items: SettleOrderReturnInput['items'], closesMissing: boolean): void {
  const ids = new Set(items.map((i) => i.itemId));
  const unique = ids.size === items.length && [...ids].every((id) => quantities.has(id));
  const ok = closesMissing
    ? unique && items.every((i) => i.received + i.dismissed > 0 && i.received + i.dismissed <= (quantities.get(i.itemId) ?? 0))
    : unique && ids.size === quantities.size && items.every((i) => i.received + i.dismissed === quantities.get(i.itemId));
  if (!ok) throw new ReturnSettleRejected('items_mismatch', '정산 품목·수량이 반품 품목과 다릅니다');
}

/**
 * wallet 에서 직접 낸 환불(`wallet:` 메모)이 품목에 연결되지 않은 채 있으면(N16) — «이미 환불한 금액»이 없으면 PR 6 처럼 거절하고
 * (반품 환불을 더 내면 이중 환불이다), 있으면 부분취소와 같은 판정(checkAlreadyRefunded)으로 넘침·없음을 거절한다.
 * 앞선 부분취소·다른 반품 정산이 상계로 가져간 몫은 뺀다.
 */
function assertExternalRefundResolved(
  refunds: Array<{ amount: unknown; note?: string | null }>,
  order: OrderView,
  returnRecords: ReturnSettlementRecord[],
  alreadyRefunded: number | undefined,
): void {
  const unresolved = unresolvedExternalRefund(refunds, [...Object.values(readPartialCancelRecords(order.metadata)), ...returnRecords]);
  if (alreadyRefunded === undefined) {
    if (unresolved > 0) {
      throw new ReturnSettleRejected(
        'external_refund_unresolved',
        `품목에 연결 안 된 외부 환불 ${unresolved}원이 있는 주문입니다 — 반품 환불을 더 내면 이중 환불이라 정산하지 않습니다`,
        unresolved,
      );
    }
    return;
  }
  try {
    checkAlreadyRefunded(unresolved, alreadyRefunded);
  } catch (error) {
    if (error instanceof PartialCancelExternalRefundRejected) {
      throw new ReturnSettleRejected(error.reason, error.message, error.unresolvedAmount);
    }
    throw error;
  }
}

/**
 * 상계 식(N6)이 맞으려면 그 주문의 다른 돈 일이 끝나 있어야 한다 — 수령 전 차액에 «크레딧 없는 선환불·외부 환불»만 양수로
 * 들어 있다고 보고 상계 크레딧 라인을 재기 때문이다. 상계할 돈(선환불·외부 환불)이 있는데 환불이 안 끝난 부분취소·다른 반품
 * 정산 기록이 있으면 기다린다(일반 Error → 500, 재시도). 주문을 바꾸기 «전»이다.
 * 선환불한 반품은 미도착으로 닫지 못한다(N15, prepaid_closes_missing) — 닫으면 정산 품목 값이 선환불보다 작아져 상계 뒤 차액이
 * 양수(NOT_PAID)가 될 수 있다. core 가 막는 자리지만 수령 뒤엔 되돌릴 수 없어 여기서도 정해진 거절로 멈춘다.
 */
function assertOffsetPremises(
  order: OrderView,
  returnRecords: ReturnSettlementRecord[],
  p: { prepaid: number; externalRefund: number; closesMissing: boolean },
): void {
  if (p.closesMissing && p.prepaid > 0) {
    throw new ReturnSettleRejected('prepaid_closes_missing', `선환불(${p.prepaid}원)한 반품은 미도착으로 닫고 정산할 수 없습니다`);
  }
  if (p.prepaid + p.externalRefund <= 0) return;
  const unfinished =
    Object.values(readPartialCancelRecords(order.metadata)).some((r) => r.stage !== 'refunded') ||
    // 교환(exchanged)도 끝난 정산이다 — 돌려줄 차액을 남기지 않는다
    returnRecords.some((r) => r.stage !== 'refunded' && r.stage !== 'exchanged');
  if (unfinished) {
    throw new Error('환불이 끝나지 않은 부분취소·반품 정산이 있는 주문입니다 — 상계를 셀 수 없어 그 환불이 끝난 뒤 다시 시도하세요');
  }
}

/**
 * 주문의 «품목에 연결 안 된 외부 환불»(원) — `wallet:` 메모 환불 합에서 부분취소·반품 정산 기록이 상계로 가져간 몫을 뺀 것.
 * 정산과 선환불이 같은 판정으로 거절한다.
 */
export async function orderUnresolvedExternalRefund(
  container: MedusaContainer,
  order: OrderView,
  returnRecords: ReturnSettlementRecord[],
): Promise<number> {
  return unresolvedExternalRefund(await listOrderRefunds(container, order.id), [
    ...Object.values(readPartialCancelRecords(order.metadata)),
    ...returnRecords,
  ]);
}

// ── 조회·기록 ──────────────────────────────────────────────────────────────────

export async function loadOrder(container: MedusaContainer, orderId: string): Promise<OrderView> {
  const order = await loadOrderView(container, orderId);
  if (!order) throw new ReturnOrderNotFound(`주문을 찾을 수 없습니다: ${orderId}`);
  return order;
}

export async function loadReturn(container: MedusaContainer, returnId: string): Promise<ReturnRow | null> {
  const [row] = await container
    .resolve(Modules.ORDER)
    .listReturns({ id: returnId }, { select: ['id', 'order_id', 'status', 'metadata'], relations: ['items'] });
  if (!row) return null;
  const quantities = new Map<string, number>();
  for (const i of row.items ?? []) {
    const q = toNumber(i.quantity);
    if (!Number.isFinite(q)) throw new Error(`반품 품목 수량을 읽지 못했습니다: ${returnId}`);
    quantities.set(i.item_id, (quantities.get(i.item_id) ?? 0) + q);
  }
  return { id: row.id, orderId: row.order_id, status: row.status, metadata: row.metadata ?? null, quantities };
}

async function writeRecord(container: MedusaContainer, returnId: string, record: ReturnSettlementRecord): Promise<void> {
  assertReadableSettlementRecord(record);
  await writeReturnMetadata(container, returnId, RETURN_SETTLEMENT_METADATA_KEY, record);
}

/**
 * 반품 metadata 의 키 하나를 쓴다. metadata 는 배열형 updateReturns 로만 저장된다(PR 3 실측). 통째로 바뀌므로 읽은 뒤 합친다 —
 * 다른 기록(요청 almondReturn·정산·선환불)을 잃지 않게. 같은 주문 잠금 안에서 부른다.
 */
export async function writeReturnMetadata(container: MedusaContainer, returnId: string, key: string, value: unknown): Promise<void> {
  const orderModule = container.resolve(Modules.ORDER);
  const [row] = await orderModule.listReturns({ id: returnId }, { select: ['id', 'metadata'] });
  await orderModule.updateReturns([
    {
      selector: { id: returnId },
      data: { metadata: { ...(row?.metadata ?? {}), [key]: value } },
    },
  ]);
}

const normalizeItems = (items: SettleOrderReturnInput['items']): ReturnSettlementRecord['items'] =>
  [...items]
    .map((i) => ({ itemId: i.itemId, received: i.received, dismissed: i.dismissed }))
    .sort((a, b) => a.itemId.localeCompare(b.itemId));

const deductionTotal = (d: ReturnSettlementDeduction): number => d.returnShipping + d.freeShippingBreak + d.roundTrip + (d.hold ?? 0);

const toResult = (input: SettleOrderReturnInput, r: ReturnSettlementRecord): SettleOrderReturnResult => ({
  returnId: input.returnId,
  requestId: input.requestId,
  refundAmount: r.refundAmount,
  deduction: r.deduction,
  feeNotAdjusted: r.feeNotAdjusted,
  prepaidApplied: r.prepaidApplied ?? 0,
  externalRefundApplied: r.externalRefundApplied ?? 0,
  // 기록의 refundMode 는 문자열로 읽힌다 — 우리가 쓴 값은 auto·manual 뿐이다
  refund: { mode: r.refundMode === 'manual' ? 'manual' : 'auto', amount: r.refundAmount },
  ...(r.stage === 'exchanged' ? { stage: 'exchanged' as const, exchangeItems: r.exchangeItems ?? [] } : { stage: 'refunded' as const }),
});
