import { createHash } from 'crypto';
import type { MedusaContainer } from '@medusajs/framework/types';
import { ChangeActionType, ContainerRegistrationKeys, Modules, OrderChangeStatus } from '@medusajs/framework/utils';
import {
  beginOrderEditOrderWorkflow,
  cancelBeginOrderEditWorkflow,
  confirmOrderEditRequestWorkflow,
  createOrderChangeActionsWorkflow,
  createOrderEditShippingMethodWorkflow,
  orderEditUpdateItemQuantityWorkflow,
  refundPaymentWorkflow,
  requestOrderEditRequestWorkflow,
} from '@medusajs/medusa/core-flows';

import { paymentRefundLockKey } from '../../../modules/almond-payment/refund-data';
import { POLICY_SNAPSHOT_KEY, type ShippingPolicySnapshot } from '../../../modules/almond-fulfillment/types';
import { toNumber } from './amount';
import type { OrderAdjustment } from './prorate-adjustments';
import { planPartialCancel, PartialCancelRejected, type CancelRequestItem, type OrderLine } from './plan-partial-cancel';
import { planShipping, type ShippingMethodView } from './plan-shipping';

export const PARTIAL_CANCEL_CHARGE_NAME = '부분취소 배송비';

export type PartialCancelInput = { orderId: string; requestId: string; items: CancelRequestItem[]; actorId?: string };
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
  refundedAt?: string;
};
export type PartialCancelResult = {
  requestId: string;
  refundAmount: number;
  shippingDelta: number;
  shippingNotAdjusted: boolean;
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

/** 주문 하나의 부분취소를 직렬화한다. 레디스 잠금은 timeout 이 곧 만료라, 주문 수정 + 환불이 넉넉히 들어가게 잡는다. */
const ORDER_LOCK_TIMEOUT_SECONDS = 120;
/** 환불 투영(payment-events)과 같은 값. 이 잠금 안에서는 refundPaymentWorkflow 한 번만 돈다. */
const PAYMENT_LOCK_TIMEOUT_SECONDS = 30;

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
  return locking.execute(`partial-cancel:${input.orderId}`, () => run(container, input), {
    timeout: ORDER_LOCK_TIMEOUT_SECONDS,
  });
}

async function run(container: MedusaContainer, input: PartialCancelInput): Promise<PartialCancelResult> {
  const requestHash = hashItems(input.items);
  const order = await loadOrder(container, input.orderId);
  const existing = readRecords(order.metadata)[input.requestId];
  if (existing && existing.requestHash !== requestHash) {
    throw new PartialCancelRejected(`같은 requestId 로 다른 요청이 왔습니다: ${input.requestId}`);
  }
  if (existing?.stage === 'refunded') return toResult(input.requestId, existing);

  const record = existing ?? (await edit(container, input, order, requestHash));

  try {
    await refund(container, input.orderId, input.requestId, record.refundAmount, input.actorId);
  } catch (error) {
    throw new PartialCancelRefundPending(input.requestId, `부분취소 환불이 끝나지 않았습니다(${input.requestId}): ${describeError(error)}`);
  }
  const done: PartialCancelRecord = { ...record, stage: 'refunded', refundedAt: new Date().toISOString() };
  await writeRecord(container, input.orderId, input.requestId, done);
  return toResult(input.requestId, done);
}

async function edit(container: MedusaContainer, input: PartialCancelInput, order: OrderView, requestHash: string): Promise<PartialCancelRecord> {
  if (order.status === 'canceled') throw new PartialCancelRejected('이미 취소된 주문입니다');
  // 계획 검증보다 «먼저» 본다: 확정 뒤 기록 전에 끊긴 요청은 이미 수량을 줄여 놨다. 줄을 통째로 뺐다면 계획 검증이
  // «주문에 없는 줄»로 업무 거절(400)을 내고, 호출자가 취소를 닫아 주문은 수정된 채 환불 0 으로 남는다.
  await ensureNoDanglingEdit(container, order.id, input.requestId);
  const plan = planPartialCancel(order.lines, input.items);

  const profiles = await productShippingProfiles(
    container,
    order.lines.map((l) => l.productId).filter((x): x is string => !!x),
  );
  const newQty = new Map(plan.lines.map((p) => [p.itemId, p.newQty]));
  const shipping = planShipping({
    methods: order.shippingMethods,
    lines: order.lines.map((l) => ({
      itemId: l.id,
      productShippingProfileId: l.productId ? (profiles.get(l.productId) ?? null) : null,
      unitPrice: l.unitPrice,
      newQty: newQty.get(l.id) ?? l.quantity,
      requiresShipping: l.requiresShipping,
    })),
    postalCode: order.postalCode,
    priorGroupFees: priorGroupFees(order.metadata),
    chargeCap: plan.itemRefundEstimate,
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
      await createOrderEditShippingMethodWorkflow(container).run({
        input: { order_id: order.id, shipping_option_id: target.shippingOptionId, custom_amount: shipping.charge },
      });
      // 이름으로 «부분취소 배송비»를 표시한다 — 다음 부분취소의 그룹 판정에서 이 방법을 뺀다
      await renameAddedShippingMethod(container, change.id, PARTIAL_CANCEL_CHARGE_NAME);
    }

    await requestOrderEditRequestWorkflow(container).run({ input: { order_id: order.id, requested_by: input.actorId } });
    await confirmOrderEditRequestWorkflow(container).run({ input: { order_id: order.id, confirmed_by: input.actorId } });
  } catch (error) {
    // 확정 전 실패 — 열린 주문 수정을 버려 주문을 원래대로 둔다
    await cancelBeginOrderEditWorkflow(container)
      .run({ input: { order_id: order.id } })
      .catch(() => undefined);
    throw error instanceof Error ? error : new Error(`부분취소 주문 수정 실패: ${describeError(error)}`);
  }

  const edited = await loadOrder(container, order.id);
  // 이번 수정이 만든 «돌려줄 차액»만 센다. 수정 전부터 남아 있던 차액(예: 환불이 밀린 다른 부분취소)을 같이 돌려주지 않게.
  const owed = roundWon(order.pendingDifference - edited.pendingDifference);
  if (!Number.isFinite(owed)) throw new Error(`돌려줄 차액을 읽지 못했습니다: ${order.pendingDifference} → ${edited.pendingDifference}`);
  const record: PartialCancelRecord = {
    requestHash,
    stage: 'edited',
    items: normalizeItems(input.items),
    refundAmount: Math.max(0, owed) + (shipping.adjustable ? shipping.refund : 0),
    shippingCharge: shipping.adjustable ? shipping.charge : 0,
    shippingRefund: shipping.adjustable ? shipping.refund : 0,
    shippingNotAdjusted: !shipping.adjustable,
    // newFee 가 아니라 recordedFee — 상한이 청구를 깎았으면 실제로 청구한 만큼만 다음 취소의 기준이 된다
    groupFees: shipping.adjustable ? Object.fromEntries(shipping.groups.map((g) => [g.shippingProfileId, g.recordedFee])) : {},
    at: new Date().toISOString(),
    orderVersion: edited.version,
  };
  await writeRecord(container, order.id, input.requestId, record);
  return record;
}

/**
 * 결제마다 «캡처 − 환불» 남은 만큼 차례로 환불한다. 결제 단위 잠금(환불 투영과 같은 키) 안에서 결제를 다시 읽어 여유를
 * 계산한다 — 같은 금액의 외부 환불 표식이 살아 있는 동안 우리 환불이 끼어들면 wallet 호출을 건너뛸 수 있다.
 * 이미 이 요청 메모로 기록된 환불은 빼고 나머지만 낸다(환불 뒤 기록 전에 끊겼다 다시 불려도 두 번 내지 않게).
 */
async function refund(container: MedusaContainer, orderId: string, requestId: string, amount: number, actorId?: string) {
  if (amount <= 0) return;
  const note = refundNote(requestId);
  const paymentModule = container.resolve(Modules.PAYMENT);
  const locking = container.resolve(Modules.LOCKING);
  const paymentIds = await orderPaymentIds(container, orderId);
  if (paymentIds.length === 0) throw new Error(`환불할 결제가 없습니다: ${orderId}`);

  const before = await paymentModule.listPayments({ id: paymentIds }, { relations: ['refunds'] });
  const alreadyRefunded = before.flatMap((p) => p.refunds ?? []).filter((r) => r.note === note).reduce((s, r) => s + toNumber(r.amount), 0);
  let left = amount - alreadyRefunded;

  for (const paymentId of paymentIds) {
    if (left <= 0) break;
    await locking.execute(
      paymentRefundLockKey(paymentId),
      async () => {
        const p = await paymentModule.retrievePayment(paymentId, { relations: ['captures', 'refunds'] });
        if (p.canceled_at) return;
        const captured = (p.captures ?? []).reduce((s, x) => s + toNumber(x.amount), 0);
        const refunded = (p.refunds ?? []).reduce((s, x) => s + toNumber(x.amount), 0);
        const take = Math.min(captured - refunded, left);
        if (!(take > 0)) return;
        await refundPaymentWorkflow(container).run({ input: { payment_id: paymentId, amount: take, created_by: actorId, note } });
        left -= take;
      },
      { timeout: PAYMENT_LOCK_TIMEOUT_SECONDS },
    );
  }
  if (left > 0) throw new Error(`환불할 캡처 잔액이 부족합니다: 남은 ${left}`);
}

// ── 조회 ──────────────────────────────────────────────────────────────────────

type OrderView = {
  id: string;
  status: string;
  version: number;
  metadata: Record<string, unknown> | null;
  lines: OrderLine[];
  shippingMethods: ShippingMethodView[];
  postalCode: string | null;
  /** 현재 버전 summary 의 pending_difference. 음수 = 돌려줄 차액 */
  pendingDifference: number;
};

/**
 * 주문을 «현재 버전» 기준으로 읽는다. query.graph 로 order 를 읽으면 주문 수정 뒤 summary·items 가 버전이 섞여 나온다
 * (Task 1 특성 테스트에서 관찰) — 버전을 아는 order 모듈로 읽는다.
 */
async function loadOrder(container: MedusaContainer, orderId: string): Promise<OrderView> {
  const orderModule = container.resolve(Modules.ORDER);
  const [o] = await orderModule.listOrders(
    { id: orderId },
    {
      select: ['id', 'status', 'version', 'metadata'],
      relations: ['items', 'items.detail', 'items.adjustments', 'shipping_methods', 'summary', 'shipping_address'],
    },
  );
  if (!o) throw new PartialCancelRejected(`주문을 찾을 수 없습니다: ${orderId}`);
  // order 모듈의 DTO 는 summary 를 단일 객체로 적지만 실제로는 버전별 배열이 올 수 있어 모양을 넓혀 받는다.
  const rawSummary = (o as unknown as { summary?: SummaryRow | SummaryRow[] | null }).summary;
  const summary = Array.isArray(rawSummary) ? (rawSummary.find((s) => s.version === o.version) ?? rawSummary[0]) : rawSummary;
  const pendingDifference = toNumber(summary?.totals?.pending_difference ?? summary?.pending_difference ?? 0);
  if (!Number.isFinite(pendingDifference)) throw new Error(`주문 summary 를 읽지 못했습니다: ${orderId}`);

  return {
    id: o.id,
    status: o.status,
    version: o.version,
    metadata: (o.metadata as Record<string, unknown> | null) ?? null,
    lines: (o.items ?? []).map((i) => ({
      id: i.id,
      quantity: toNumber(i.quantity),
      unitPrice: toNumber(i.unit_price),
      productId: i.product_id ?? null,
      requiresShipping: i.requires_shipping !== false,
      adjustments: (i.adjustments ?? []).map((a) => ({
        amount: toNumber(a.amount),
        code: a.code ?? null,
        promotion_id: a.promotion_id ?? null,
        description: a.description ?? null,
        // 모델에는 있는데 OrderLineItemAdjustmentDTO 타입에 빠진 필드라 모양만 넓혀 읽는다.
        is_tax_inclusive: !!(a as { is_tax_inclusive?: boolean | null }).is_tax_inclusive,
      })),
    })),
    shippingMethods: (o.shipping_methods ?? []).map((m) => ({
      id: m.id,
      shippingOptionId: m.shipping_option_id ?? null,
      amount: toNumber(m.amount),
      snapshot: readSnapshot(m.data),
      isPartialCancelCharge: m.name === PARTIAL_CANCEL_CHARGE_NAME,
    })),
    postalCode: o.shipping_address?.postal_code ?? null,
    pendingDifference,
  };
}

type SummaryRow = { version?: number; pending_difference?: unknown; totals?: { pending_difference?: unknown } };

function readSnapshot(data: Record<string, unknown> | null | undefined): ShippingPolicySnapshot | null {
  // Medusa 는 JSON 을 병합 갱신하므로 «지운» 스냅샷은 null 로 남는다. 모양이 맞지 않으면 없는 것으로 본다.
  const v = data?.[POLICY_SNAPSHOT_KEY] as Partial<ShippingPolicySnapshot> | null | undefined;
  if (!v || typeof v !== 'object' || !v.policy || typeof v.shippingProfileId !== 'string') return null;
  return v as ShippingPolicySnapshot;
}

/** 주문 ↔ 결제 컬렉션은 링크다(주문 버전과 무관). 결제 자체는 payment 모듈에서 읽는다. */
async function orderPaymentIds(container: MedusaContainer, orderId: string): Promise<string[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({ entity: 'order', fields: ['id', 'payment_collections.id'], filters: { id: orderId } });
  // query.graph 의 링크 필드는 타입이 넓다 — 경계에서 id 배열로만 좁힌다.
  const collectionIds = ((data[0] as { payment_collections?: Array<{ id: string } | null> } | undefined)?.payment_collections ?? [])
    .flatMap((pc) => (pc?.id ? [pc.id] : []));
  if (collectionIds.length === 0) return [];
  const collections = await container.resolve(Modules.PAYMENT).listPaymentCollections(
    { id: collectionIds },
    { select: ['id'], relations: ['payments'] },
  );
  return collections
    .flatMap((pc) => pc.payments ?? [])
    .sort((a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime() || a.id.localeCompare(b.id))
    .map((p) => p.id);
}

async function productShippingProfiles(container: MedusaContainer, productIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (productIds.length === 0) return map;
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({ entity: 'product', fields: ['id', 'shipping_profile.id'], filters: { id: [...new Set(productIds)] } });
  // 링크 필드(shipping_profile)는 graph 결과 타입에 없다 — 경계에서 좁힌다.
  for (const p of data as Array<{ id: string; shipping_profile?: { id?: string } | null }>) {
    if (p.shipping_profile?.id) map.set(p.id, p.shipping_profile.id);
  }
  return map;
}

/**
 * 이 requestId 로 연 주문 수정이 남아 있는지 본다.
 * - 열린 채(pending/requested) 남았으면 앞선 시도가 확정 전에 끊긴 것 — 버리고 새로 한다.
 * - 확정됐는데 기록이 없으면 확정과 기록 사이에 끊긴 것 — 다시 하면 수량을 두 번 줄이므로 멈춘다(사람이 확인).
 */
async function ensureNoDanglingEdit(container: MedusaContainer, orderId: string, requestId: string) {
  const orderModule = container.resolve(Modules.ORDER);
  // internal_note 는 모델에는 있는데 OrderChangeDTO 타입에 빠져 있다 — 고른 필드만 담은 모양으로 좁힌다.
  const changes = (await orderModule.listOrderChanges(
    { order_id: orderId },
    { select: ['id', 'status', 'internal_note'] },
  )) as Array<{ id: string; status: string; internal_note?: string | null }>;
  const mine = changes.filter((ch) => ch.internal_note === editTag(requestId));
  if (mine.some((ch) => ch.status === OrderChangeStatus.CONFIRMED)) {
    throw new Error(`부분취소 ${requestId} 의 주문 수정은 확정됐는데 진행 기록이 없습니다 — 다시 하면 두 번 취소되므로 멈춥니다. 수동 확인이 필요합니다`);
  }
  if (mine.some((ch) => ch.status === OrderChangeStatus.PENDING || ch.status === OrderChangeStatus.REQUESTED)) {
    await cancelBeginOrderEditWorkflow(container).run({ input: { order_id: orderId } });
  }
}

/** createOrderEditShippingMethodWorkflow 는 이름을 받지 않는다 — 이 주문 수정이 방금 더한 방법의 이름을 바꾼다. */
async function renameAddedShippingMethod(container: MedusaContainer, orderChangeId: string, name: string) {
  const orderModule = container.resolve(Modules.ORDER);
  const actions = await orderModule.listOrderChangeActions(
    { order_change_id: orderChangeId },
    { select: ['id', 'action', 'reference_id', 'ordering'] },
  );
  const added = actions.filter((a) => a.action === ChangeActionType.SHIPPING_ADD).sort((a, b) => a.ordering - b.ordering);
  const id = added[added.length - 1]?.reference_id;
  if (!id) throw new Error(`방금 더한 배송 방법을 찾지 못했습니다: ${orderChangeId}`);
  await orderModule.updateOrderShippingMethods([{ id, name }]);
}

// ── 기록 ──────────────────────────────────────────────────────────────────────

function readRecords(metadata: unknown): Record<string, PartialCancelRecord> {
  const v = (metadata as Record<string, unknown> | null | undefined)?.partialCancels;
  if (!v || typeof v !== 'object') return {};
  // metadata 는 JSON 병합 갱신이라 «지운» 기록은 null 로 남는다 — 객체가 아닌 값은 기록이 없는 것으로 본다.
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>).filter((e): e is [string, PartialCancelRecord] => !!e[1] && typeof e[1] === 'object'),
  );
}

/** 앞선 부분취소들이 남긴 그룹 요금을 주문 버전 순으로 겹친다(나중 것이 이긴다). */
function priorGroupFees(metadata: unknown): Record<string, number> {
  return Object.values(readRecords(metadata))
    .sort((a, b) => a.orderVersion - b.orderVersion)
    .reduce<Record<string, number>>((acc, r) => ({ ...acc, ...r.groupFees }), {});
}

async function writeRecord(container: MedusaContainer, orderId: string, requestId: string, record: PartialCancelRecord) {
  const orderModule = container.resolve(Modules.ORDER);
  const current = await orderModule.retrieveOrder(orderId, { select: ['id', 'metadata'] });
  const meta = (current.metadata ?? {}) as Record<string, unknown>;
  await orderModule.updateOrders([
    { id: orderId, metadata: { ...meta, partialCancels: { ...readRecords(meta), [requestId]: record } } },
  ]);
}

// ── 작은 도우미 ────────────────────────────────────────────────────────────────

const normalizeItems = (items: CancelRequestItem[]): CancelRequestItem[] =>
  [...items].map((i) => ({ itemId: i.itemId, quantity: i.quantity })).sort((a, b) => a.itemId.localeCompare(b.itemId));

const hashItems = (items: CancelRequestItem[]) => createHash('sha256').update(JSON.stringify(normalizeItems(items))).digest('hex');

const toResult = (requestId: string, r: PartialCancelRecord): PartialCancelResult => ({
  requestId,
  refundAmount: r.refundAmount,
  shippingDelta: r.shippingCharge - r.shippingRefund,
  shippingNotAdjusted: r.shippingNotAdjusted,
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

/** Medusa 워크플로는 Error 가 아닌 평범한 객체를 던진다 — «[object Object]» 가 되지 않게 읽을 수 있는 문장으로 바꾼다. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
