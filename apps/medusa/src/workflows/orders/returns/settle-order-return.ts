import type { MedusaContainer } from '@medusajs/framework/types';
import { Modules, ReturnStatus } from '@medusajs/framework/utils';
import {
  beginReceiveReturnWorkflow,
  cancelBeginOrderEditWorkflow,
  cancelReturnReceiveWorkflow,
  confirmReturnReceiveWorkflow,
  dismissItemReturnRequestWorkflow,
  receiveItemReturnRequestWorkflow,
} from '@medusajs/medusa/core-flows';

import { readWalletRefundRefusal } from '../../../modules/almond-payment/wallet-refund-refusal';
import { describeError } from '../../../utils/describe-error';
import { toNumber } from '../partial-cancel/amount';
import { unresolvedExternalRefund } from '../partial-cancel/external-refund';
import { readPartialCancelRecords } from '../partial-cancel/partial-cancel-order';
import { RETURN_FEE_CHARGE_NAME } from '../partial-cancel/plan-shipping';
import { priorGroupFeesFor } from '../partial-cancel/prior-group-fees';
import { shippingPlanLines } from '../partial-cancel/shipping-plan-lines';
import { loadOrderView, productShippingProfiles, type OrderView } from '../settlement/load-order-view';
import type { ShippingMethodView } from '../partial-cancel/plan-shipping';
import { addSettlementCharge, ensureNoDanglingChange } from '../settlement/order-edit-charge';
import { listOrderRefunds, orderCancelLockKey } from '../settlement/order-payments';
import { refundOrderPayments } from '../settlement/refund-order-payments';
import type { RefundMode } from '../settlement/refund-mode';
import { reconcileOrderWalletRefunds } from '../settlement/wallet-refund-ledger';
import { readReturnRequestRecord } from './load-return-order';
import { planReturnFees, type ReturnSettlementDeduction } from './plan-return-fees';
import { ReturnOrderNotFound } from './request-order-return';
import {
  assertNoReturnAwaitingCharge,
  assertReadableSettlementRecord,
  hashReturnSettlement,
  loadReturnSettlementRecords,
  readReturnSettlementRecord,
  RETURN_SETTLEMENT_METADATA_KEY,
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
};

export type SettleOrderReturnResult = {
  returnId: string;
  requestId: string;
  refundAmount: number;
  deduction: ReturnSettlementDeduction;
  feeNotAdjusted: boolean;
  refund: { mode: RefundMode; amount: number };
  stage: 'refunded';
};

export type ReturnSettleRejectReason =
  | 'not_our_return'
  | 'return_canceled'
  | 'request_id_conflict'
  | 'items_mismatch'
  | 'external_refund_unresolved'
  | 'return_already_received';

/** 정해진 거절 — 다시 불러도 같다. 라우트가 400 code=return_settle_rejected + reason 으로 낸다. 반품·주문은 그대로다. */
export class ReturnSettleRejected extends Error {
  constructor(
    readonly reason: ReturnSettleRejectReason,
    message: string,
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

/**
 * 반품 정산(K8 PR6, N13·N14). 수령 확정(받은 품목 receive · 폐기 품목 dismiss) → 택배비 주문 수정(«반품 택배비» 방법,
 * 차감 0 이면 건너뜀) → RETURN 환불. 택배비는 수령 «뒤»에 넣는다 — 앞에 넣으면 차액이 잠깐 양수가 돼 NOT_PAID 결제
 * 컬렉션이 생긴다. 단계는 반품 metadata 의 정산 기록에 남고, 같은 requestId 로 다시 부르면 기록의 단계부터 잇는다.
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
  const requestHash = hashReturnSettlement(input.requestId, input.items);
  const existing = readReturnSettlementRecord(ret.metadata);
  if (existing && existing.requestHash !== requestHash) {
    throw new ReturnSettleRejected('request_id_conflict', `이 반품에 다른 정산 요청이 이미 있습니다: ${input.requestId}`);
  }
  if (existing?.stage === 'refunded') return toResult(input, existing);
  const mode = input.refundMode ?? 'auto';

  const received = existing ?? (await receive(container, input, ret, request.feeBearer, requestHash));
  const charged = received.stage === 'received' ? await charge(container, input, received) : received;

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
): Promise<ReturnSettlementRecord> {
  assertItemsMatch(ret.quantities, input.items);
  // 이 반품은 아직 기록이 없으니 목록은 «다른» 반품들의 기록이다. 수령까지 하고 청구 전에 멈춘 반품이 있으면 기다린다(500 → 재시도):
  // 그 반품의 groupFees 는 아직 겹치기에 안 들어가(charged·refunded 만) 이 반품이 같은 깨짐을 받고, 그 반품이 이어 가며 또 받는다.
  const otherReturns = await loadReturnSettlementRecords(container, input.orderId);
  assertNoReturnAwaitingCharge(otherReturns);
  // 수령 «전»에 장부를 맞춘다 — 투영 안 된 외부 환불까지 보고 거절하게
  await reconcileOrderWalletRefunds(container, input.orderId);
  await assertNoExternalRefund(container, await loadOrder(container, input.orderId), otherReturns);

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

  // 택배비 계획은 수령 «뒤»에 돈다 — 상한(chargeCap)이 돌려줄 차액이다. 남는 수량 = 줄 수량 − 돌아온 수량(이번 반품이 이미 들어 있다)
  const profiles = await productShippingProfiles(
    container,
    after.lines.map((l) => l.productId).filter((x): x is string => !!x),
  );
  const returnedNow = new Map(input.items.map((i) => [i.itemId, i.received + i.dismissed]));
  const plan = planReturnFees({
    feeBearer,
    methods: after.shippingMethods,
    lines: shippingPlanLines(after.lines, new Map(), profiles).map((l) => ({ ...l, returnedNow: returnedNow.get(l.itemId) ?? 0 })),
    postalCode: after.postalCode,
    priorGroupFees: priorGroupFeesFor(Object.values(readPartialCancelRecords(after.metadata)), otherReturns),
    chargeCap: Math.max(0, owed),
  });
  const chargeShippingOptionId = plan.total > 0 ? chargeShippingOption(after.shippingMethods, after.lines, profiles, input.items) : null;
  if (plan.total > 0 && !chargeShippingOptionId) throw new Error(`반품 택배비를 붙일 배송 방법을 찾지 못했습니다: ${input.orderId}`);

  const record: ReturnSettlementRecord = {
    requestId: input.requestId,
    requestHash,
    stage: 'received',
    items: normalizeItems(input.items),
    owed,
    deduction: plan.deduction,
    feeNotAdjusted: plan.feeNotAdjusted,
    refundAmount: Math.max(0, owed - plan.total),
    groupFees: plan.groupFees,
    orderVersion: after.version,
    receivedAt: new Date().toISOString(),
    chargeShippingOptionId,
  };
  await writeRecord(container, ret.id, record);
  return record;
}

/** ② 차감이 있으면 «반품 택배비» 주문 수정을 확정한다 → 기록 charged. 차감 0 이면 수정 없이 charged. */
async function charge(container: MedusaContainer, input: SettleOrderReturnInput, record: ReturnSettlementRecord): Promise<ReturnSettlementRecord> {
  const total = record.deduction.returnShipping + record.deduction.freeShippingBreak + record.deduction.roundTrip;
  if (total > 0) {
    const tag = feeTag(input.requestId);
    await ensureNoDanglingChange(container, input.orderId, tag, async () => {
      await cancelBeginOrderEditWorkflow(container).run({ input: { order_id: input.orderId } });
    });
    // 옵션은 수령 때 정해 기록에 둔 값 — 이어 갈 때 주문의 배송 방법 순서에 다시 기대지 않는다
    if (!record.chargeShippingOptionId) throw new Error(`차감이 있는데 택배비 배송 옵션이 기록에 없습니다: ${input.returnId}`);
    await addSettlementCharge(container, {
      orderId: input.orderId,
      tag,
      shippingOptionId: record.chargeShippingOptionId,
      charges: [{ name: RETURN_FEE_CHARGE_NAME, amount: total }],
      actorId: input.actorId,
    });
  }
  const charged: ReturnSettlementRecord = { ...record, stage: 'charged' };
  await writeRecord(container, input.returnId, charged);
  return charged;
}

// ── 판정 ──────────────────────────────────────────────────────────────────────

/** 품목 집합이 반품 품목과 같고, 줄마다 수령 + 폐기 = 반품 품목 수량. 부분 도착은 이 PR 에서 정산하지 않는다(N7). */
function assertItemsMatch(quantities: ReadonlyMap<string, number>, items: SettleOrderReturnInput['items']): void {
  const ids = new Set(items.map((i) => i.itemId));
  const sameSet = ids.size === items.length && ids.size === quantities.size && [...ids].every((id) => quantities.has(id));
  if (!sameSet || items.some((i) => i.received + i.dismissed !== quantities.get(i.itemId))) {
    throw new ReturnSettleRejected('items_mismatch', '정산 품목·수량이 반품 품목과 다릅니다');
  }
}

/**
 * wallet 에서 직접 낸 환불(`wallet:` 메모)이 품목에 연결되지 않은 채 있으면 거절한다(N16) — 반품 환불을 더 내면 이중 환불이다.
 * 앞선 부분취소·다른 반품 정산(PR 6b 의 externalRefundApplied)이 상계로 가져간 몫은 뺀다.
 */
async function assertNoExternalRefund(
  container: MedusaContainer,
  order: OrderView,
  returnRecords: ReturnSettlementRecord[],
): Promise<void> {
  const unresolved = await orderUnresolvedExternalRefund(container, order, returnRecords);
  if (unresolved > 0) {
    throw new ReturnSettleRejected(
      'external_refund_unresolved',
      `품목에 연결 안 된 외부 환불 ${unresolved}원이 있는 주문입니다 — 반품 환불을 더 내면 이중 환불이라 정산하지 않습니다`,
    );
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

/**
 * «반품 택배비» 방법을 붙일 배송 옵션 — 이번 반품이 닿은 첫 그룹(주문의 배송 방법 순서)의 원래 방법 옵션.
 * 금액은 custom_amount 라 옵션은 그릇일 뿐이다. 차감이 있으면 계획이 그룹을 맞춘 것이라 있어야 한다.
 */
function chargeShippingOption(
  methods: ShippingMethodView[],
  lines: OrderView['lines'],
  profiles: ReadonlyMap<string, string>,
  items: SettleOrderReturnInput['items'],
): string | null {
  const ids = new Set(items.filter((i) => i.received + i.dismissed > 0).map((i) => i.itemId));
  const touched = new Set(
    lines.flatMap((l) => {
      const profile = ids.has(l.id) && l.productId ? profiles.get(l.productId) : undefined;
      return profile ? [profile] : [];
    }),
  );
  const target = methods.find(
    (m) => !m.isSettlementCharge && !m.isReturnExchangeOrClaimShipping && m.snapshot && touched.has(m.snapshot.shippingProfileId),
  );
  return target?.shippingOptionId ?? null;
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

const toResult = (input: SettleOrderReturnInput, r: ReturnSettlementRecord): SettleOrderReturnResult => ({
  returnId: input.returnId,
  requestId: input.requestId,
  refundAmount: r.refundAmount,
  deduction: r.deduction,
  feeNotAdjusted: r.feeNotAdjusted,
  // 기록의 refundMode 는 문자열로 읽힌다 — 우리가 쓴 값은 auto·manual 뿐이다
  refund: { mode: r.refundMode === 'manual' ? 'manual' : 'auto', amount: r.refundAmount },
  stage: 'refunded',
});
