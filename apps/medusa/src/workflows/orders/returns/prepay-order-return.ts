import type { MedusaContainer } from '@medusajs/framework/types';
import { Modules, ReturnStatus } from '@medusajs/framework/utils';

import { readWalletRefundRefusal } from '../../../modules/almond-payment/wallet-refund-refusal';
import { describeError } from '../../../utils/describe-error';
import { readPartialCancelRecords } from '../partial-cancel/partial-cancel-order';
import { priorGroupFeesFor } from '../partial-cancel/prior-group-fees';
import { shippingPlanLines } from '../partial-cancel/shipping-plan-lines';
import { productShippingProfiles, type OrderView } from '../settlement/load-order-view';
import { listOrderRefunds, orderCancelLockKey } from '../settlement/order-payments';
import { refundOrderPayments } from '../settlement/refund-order-payments';
import type { RefundMode } from '../settlement/refund-mode';
import { reconcileOrderWalletRefunds } from '../settlement/wallet-refund-ledger';
import { readReturnRequestRecord, type ReturnRequestRecord } from './load-return-order';
import { planReturnFees, type ReturnSettlementDeduction } from './plan-return-fees';
import { ReturnOrderNotFound } from './request-order-return';
import { returnItemValue } from './return-item-value';
import {
  hashReturnPrepay,
  prepaidTotal,
  prepayNote,
  readReturnPrepayRecord,
  RETURN_PREPAY_METADATA_KEY,
  type ReturnPrepayRecord,
} from './return-prepay-record';
import { loadReturnSettlementRecords, RETURN_SETTLEMENT_METADATA_KEY, type ReturnSettlementRecord } from './return-settlement-record';
import { loadOrder, loadReturn, orderUnresolvedExternalRefund, writeReturnMetadata, type ReturnRow } from './settle-order-return';

export type PrepayOrderReturnInput = {
  orderId: string;
  returnId: string;
  /** core customer_returns.id — 환불 메모(return-prepay:<id>)가 이것으로 만들어진다 */
  requestId: string;
  /** 없으면 기본값(품목 값 − 택배비 예상). 있으면 1 이상 품목 값 이하 정수(원) */
  amount?: number;
  /** 없으면 auto. 요청 해시에 넣지 않는다 — 자동 거절 뒤 같은 요청을 수동으로 다시 보낸다 */
  refundMode?: RefundMode;
  /** CS 메모 — 요청 해시에 든다 */
  memo: string;
  actorId?: string;
};

export type PrepayOrderReturnResult = {
  returnId: string;
  requestId: string;
  amount: number;
  refund: { mode: RefundMode; amount: number };
  stage: 'refunded';
};

export type ReturnPrepayRejectReason =
  | 'not_our_return'
  | 'return_canceled'
  | 'return_already_settled'
  | 'request_id_conflict'
  | 'prepay_exceeds_item_value'
  | 'external_refund_unresolved'
  | 'pending_refund_outstanding';

/** 정해진 거절 — 다시 불러도 같다. 라우트가 400 code=return_prepay_rejected + reason 으로 낸다. 돈은 움직이지 않았다. */
export class ReturnPrepayRejected extends Error {
  constructor(
    readonly reason: ReturnPrepayRejectReason,
    message: string,
  ) {
    super(message);
    this.name = 'ReturnPrepayRejected';
  }
}

/** 선환불 기록(requested)은 남았고 환불을 끝내지 못했다. 같은 requestId 로 다시 부르면 장부를 맞추고 남은 몫만 낸다. */
export class ReturnPrepayRefundPending extends Error {
  constructor(
    readonly requestId: string,
    message: string,
  ) {
    super(message);
    this.name = 'ReturnPrepayRefundPending';
  }
}

/** wallet 이 선환불을 영구 거절했다(retryable: false). 기록은 requested 로 남는다 — 같은 요청을 refundMode manual 로 다시 보낼 수 있다. */
export class ReturnPrepayRefundRefused extends Error {
  constructor(
    readonly requestId: string,
    readonly refusalCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'ReturnPrepayRefundRefused';
  }
}

/** 정산과 같은 잠금·같은 만료 — 장부 맞추기 + 환불이 넉넉히 들어가게 잡는다. */
const ORDER_LOCK_TIMEOUT_SECONDS = 120;

/**
 * 반품 선환불(K8 PR6b N4·N5). 반품 요청이 열린 채(수령 전) RETURN 환불을 먼저 낸다 — 주문 변경은 없다. 정산과 같은 주문 잠금이
 * 둘을 줄 세운다(N7): 정산이 먼저면 이 호출은 return_already_settled, 선환불이 먼저면 정산이 return-prepay 메모 환불 합만큼 덜 낸다.
 * 기록(requested → refunded)은 반품 metadata 에 남고, 같은 requestId 로 다시 부르면 장부를 맞춘 뒤 같은 메모의 남은 몫만 낸다.
 * 반품 요청이 열린 동안의 환불엔 크레딧 라인이 붙지 않아 차액이 +P 가 되고, 수령이 그만큼 상계한다(Task 1 실측).
 */
export async function prepayOrderReturn(container: MedusaContainer, input: PrepayOrderReturnInput): Promise<PrepayOrderReturnResult> {
  const locking = container.resolve(Modules.LOCKING);
  return locking.execute(orderCancelLockKey(input.orderId), () => run(container, input), {
    timeout: ORDER_LOCK_TIMEOUT_SECONDS,
  });
}

async function run(container: MedusaContainer, input: PrepayOrderReturnInput): Promise<PrepayOrderReturnResult> {
  const ret = await loadReturn(container, input.returnId);
  // 다른 주문의 반품 id 는 «없는 반품» — 존재 여부를 가르지 않는다
  if (!ret || ret.orderId !== input.orderId) throw new ReturnOrderNotFound(`반품을 찾을 수 없습니다: ${input.returnId}`);
  const request = assertOurLiveReturn(ret);
  const requestHash = hashReturnPrepay(input.requestId, input.amount ?? null, input.memo);
  const existing = readPrepayRecordStrict(ret);
  if (existing && existing.requestHash !== requestHash) {
    throw new ReturnPrepayRejected('request_id_conflict', `이 반품에 다른 선환불 요청이 이미 있습니다: ${input.requestId}`);
  }
  // 끝난 선환불은 반품이 그 뒤 정산(수령)됐어도 결과 그대로 — 돈이 나갔다는 사실을 «정산됨»으로 덮지 않는다
  if (existing?.stage === 'refunded') return toResult(input, existing);
  const mode = input.refundMode ?? 'auto';
  if (isSettledOrReceived(ret)) return settledAfterPrepay(container, input, ret, existing, mode);
  assertRequested(ret);

  const record = existing ?? (await open(container, input, ret, request, requestHash));
  try {
    // 이어 가는 호출은 응답을 잃은 환불을 이 메모로 장부에 넣은 뒤 남은 몫만 낸다(refundOrderPayments 가 같은 메모의 장부 몫을 뺀다)
    if (existing) await reconcileOrderWalletRefunds(container, input.orderId);
    await refundOrderPayments(container, {
      orderId: input.orderId,
      amount: record.amount,
      note: prepayNote(input.requestId),
      mode,
      kind: 'RETURN',
      actorId: input.actorId,
    });
  } catch (error) {
    const refusal = readWalletRefundRefusal(error);
    if (refusal) throw new ReturnPrepayRefundRefused(input.requestId, refusal.code, refusal.message);
    throw new ReturnPrepayRefundPending(input.requestId, `반품 선환불이 끝나지 않았습니다(${input.requestId}): ${describeError(error)}`);
  }
  const done: ReturnPrepayRecord = { ...record, stage: 'refunded', refundedAt: new Date().toISOString(), refundMode: mode };
  await writePrepayRecord(container, ret.id, done);
  return toResult(input, done);
}

/**
 * 정산(수령)이 이 선환불보다 먼저 끝났다(N7). 더 내지 않는다 — 그러나 응답을 잃은 선환불은 돈이 이미 나갔을 수 있어
 * 장부(N6: 이 메모 환불 행이 정본)를 맞춰 본다: 나간 돈이 있으면 그 합으로 기록을 refunded 로 닫고 200(관측이 선환불을 낸다),
 * 없으면 return_already_settled.
 */
async function settledAfterPrepay(
  container: MedusaContainer,
  input: PrepayOrderReturnInput,
  ret: ReturnRow,
  existing: ReturnPrepayRecord | null,
  mode: RefundMode,
): Promise<PrepayOrderReturnResult> {
  await reconcileOrderWalletRefunds(container, input.orderId);
  const paid = prepaidTotal(await listOrderRefunds(container, input.orderId), input.requestId);
  if (paid <= 0) throw new ReturnPrepayRejected('return_already_settled', '이미 정산(수령)한 반품입니다 — 선환불할 수 없습니다');
  // 기록은 환불 «전»에 쓰이므로 기록 없는 선환불 메모 환불은 우리 길로 생기지 않는다 — 모르는 돈이라 멈춘다
  if (!existing) throw new Error(`선환불 기록 없이 선환불 메모 환불 ${paid}원이 있습니다: ${input.requestId}`);
  const done: ReturnPrepayRecord = { ...existing, amount: paid, stage: 'refunded', refundedAt: new Date().toISOString(), refundMode: mode };
  await writePrepayRecord(container, ret.id, done);
  return toResult(input, done);
}

/** 기록이 없을 때만 온다 — 장부 맞추기 → 거절 판정 → 금액(N5) → 기록 requested. 돈은 아직 안 움직인다. */
async function open(
  container: MedusaContainer,
  input: PrepayOrderReturnInput,
  ret: ReturnRow,
  request: ReturnRequestRecord,
  requestHash: string,
): Promise<ReturnPrepayRecord> {
  // 판정 «전»에 장부를 맞춘다 — 투영 안 된 외부 환불까지 보고 거절하게
  await reconcileOrderWalletRefunds(container, input.orderId);
  const order = await loadOrder(container, input.orderId);
  const settlements = await loadReturnSettlementRecords(container, input.orderId);
  const unresolved = await orderUnresolvedExternalRefund(container, order, settlements);
  if (unresolved > 0) {
    throw new ReturnPrepayRejected(
      'external_refund_unresolved',
      `품목에 연결 안 된 외부 환불 ${unresolved}원이 있는 주문입니다 — 선환불을 더 내면 이중 환불이라 내지 않습니다`,
    );
  }
  // 돌려줄 돈이 이미 밀려 있다(환불 못 끝낸 부분취소·정산) — 정산의 상계 식(N6)은 다른 돈 일이 끝난 주문을 전제한다.
  // 원 미만은 할인 안분의 잔여라 보지 않는다(반올림)
  if (Math.round(order.pendingDifference) < 0) {
    throw new ReturnPrepayRejected(
      'pending_refund_outstanding',
      `아직 돌려주지 못한 차액 ${-order.pendingDifference}원이 있는 주문입니다 — 그 환불이 끝난 뒤 선환불하세요`,
    );
  }

  const estimate = await estimateReturnPrepay(container, { order, ret, feeBearer: request.feeBearer, settlements });
  const amount = input.amount ?? estimate.defaultPrepayAmount;
  // 상한이 품목 값이라 정산의 owed ≥ P 가 늘 선다 — 넘으면 상계 뒤 차액이 양수(NOT_PAID)가 된다(N5)
  if (!Number.isInteger(amount) || amount < 1 || amount > estimate.itemValue) {
    throw new ReturnPrepayRejected(
      'prepay_exceeds_item_value',
      input.amount === undefined
        ? `먼저 환불할 금액이 없습니다 — 품목 값 ${estimate.itemValue}원이 택배비 예상을 넘지 않습니다`
        : `선환불 금액 ${amount}원이 반품 품목 값 ${estimate.itemValue}원을 넘습니다`,
    );
  }

  const record: ReturnPrepayRecord = {
    requestId: input.requestId,
    requestHash,
    stage: 'requested',
    amount,
    itemValue: estimate.itemValue,
    feeEstimate: estimate.feeEstimate,
    memo: input.memo,
    requestedAt: new Date().toISOString(),
  };
  // 환불 «전»에 쓴다 — 환불 뒤 끊겨도 같은 requestId 가 이 금액으로 이어 가고, 반품 취소가 이 기록을 보고 거절한다
  await writePrepayRecord(container, ret.id, record);
  return record;
}

// ── 판정·금액 (미리보기와 같이 쓴다) ────────────────────────────────────────────

/**
 * 선환불·미리보기가 열리는 반품인지 본다 — 우리 반품(요청 기록)이고, 취소되지 않았고, 정산 기록이 없고 수령 전(requested).
 * 정산 기록은 읽히는지와 무관하게 키가 있으면 정산된 것으로 본다 — 반만 믿고 돈을 움직이지 않는다.
 */
export function assertPrepayableReturn(ret: ReturnRow): ReturnRequestRecord {
  const request = assertOurLiveReturn(ret);
  if (isSettledOrReceived(ret)) {
    throw new ReturnPrepayRejected('return_already_settled', '이미 정산(수령)한 반품입니다 — 선환불할 수 없습니다');
  }
  assertRequested(ret);
  return request;
}

/** 우리 반품(요청 기록)이고 취소되지 않았다. */
function assertOurLiveReturn(ret: ReturnRow): ReturnRequestRecord {
  const request = readReturnRequestRecord(ret.metadata);
  if (!request) throw new ReturnPrepayRejected('not_our_return', '이 반품은 선환불할 수 없습니다');
  if (ret.status === ReturnStatus.CANCELED) throw new ReturnPrepayRejected('return_canceled', '취소된 반품입니다');
  return request;
}

const isSettledOrReceived = (ret: ReturnRow): boolean =>
  ret.metadata?.[RETURN_SETTLEMENT_METADATA_KEY] !== undefined ||
  ret.status === ReturnStatus.RECEIVED ||
  ret.status === ReturnStatus.PARTIALLY_RECEIVED;

/** open = 확정 전에 끊긴 요청의 흔적. 같은 requestId 의 요청 재시도가 치운다 — 정해진 거절이 아니라 기다림(500) */
function assertRequested(ret: ReturnRow): void {
  if (ret.status !== ReturnStatus.REQUESTED) throw new Error(`요청이 확정되지 않은 반품입니다: ${ret.id} (${ret.status})`);
}

export type ReturnPrepayEstimate = {
  /** 반품 품목 값 V — 선환불 상한 */
  itemValue: number;
  /** 택배비 예상 F — 정산이 수령 뒤 받을 차감과 같은 계산(상한 V) */
  feeEstimate: ReturnSettlementDeduction;
  /** V − F */
  defaultPrepayAmount: number;
};

/**
 * 선환불 금액의 재료(N5) — V = 반품 품목 전부의 값(할인 몫 빼고 내림), F = planReturnFees(returnedNow = 반품 수량, chargeCap = V).
 * 정산은 수령 «뒤» 같은 계산을 돈다. 수령 전이라 남는 수량 = 줄 수량 − 이 반품 수량 − 이미 돌아온 수량으로 넘긴다.
 * settlements 는 이 주문 반품들의 정산 기록(이 반품은 아직 없다 — assertPrepayableReturn).
 */
export async function estimateReturnPrepay(
  container: MedusaContainer,
  p: { order: OrderView; ret: ReturnRow; feeBearer: 'customer' | 'seller'; settlements: ReturnSettlementRecord[] },
): Promise<ReturnPrepayEstimate> {
  const { order, ret } = p;
  const itemValue = returnItemValue(
    order.lines,
    [...ret.quantities].map(([itemId, quantity]) => ({ itemId, quantity })),
  );
  const profiles = await productShippingProfiles(
    container,
    order.lines.map((l) => l.productId).filter((x): x is string => !!x),
  );
  const afterReturn = new Map(
    order.lines.filter((l) => ret.quantities.has(l.id)).map((l) => [l.id, l.quantity - (ret.quantities.get(l.id) ?? 0)]),
  );
  const plan = planReturnFees({
    feeBearer: p.feeBearer,
    methods: order.shippingMethods,
    lines: shippingPlanLines(order.lines, afterReturn, profiles).map((l) => ({
      ...l,
      returnedNow: ret.quantities.get(l.itemId) ?? 0,
    })),
    postalCode: order.postalCode,
    priorGroupFees: priorGroupFeesFor(Object.values(readPartialCancelRecords(order.metadata)), p.settlements),
    chargeCap: itemValue,
  });
  return { itemValue, feeEstimate: plan.deduction, defaultPrepayAmount: Math.max(0, itemValue - plan.total) };
}

// ── 기록 ──────────────────────────────────────────────────────────────────────

/** 키가 있는데 읽히지 않는 기록은 멈춘다(500) — 없는 것으로 보고 새로 쓰면 앞선 선환불 금액을 덮는다. */
function readPrepayRecordStrict(ret: ReturnRow): ReturnPrepayRecord | null {
  if (ret.metadata?.[RETURN_PREPAY_METADATA_KEY] === undefined) return null;
  const record = readReturnPrepayRecord(ret.metadata);
  if (!record) throw new Error(`반품 선환불 기록의 모양이 어긋납니다: ${ret.id}`);
  return record;
}

/** 쓰기 전에 본다: 읽기가 버릴 모양이면 다음 호출이 멈추므로 쓰지 않는다. */
async function writePrepayRecord(container: MedusaContainer, returnId: string, record: ReturnPrepayRecord): Promise<void> {
  if (!readReturnPrepayRecord({ [RETURN_PREPAY_METADATA_KEY]: record })) {
    throw new Error(`반품 선환불 기록의 모양이 어긋납니다: ${JSON.stringify(record)}`);
  }
  await writeReturnMetadata(container, returnId, RETURN_PREPAY_METADATA_KEY, record);
}

const toResult = (input: PrepayOrderReturnInput, r: ReturnPrepayRecord): PrepayOrderReturnResult => ({
  returnId: input.returnId,
  requestId: input.requestId,
  amount: r.amount,
  // 기록의 refundMode 는 문자열로 읽힌다 — 우리가 쓴 값은 auto·manual 뿐이다
  refund: { mode: r.refundMode === 'manual' ? 'manual' : 'auto', amount: r.amount },
  stage: 'refunded',
});
