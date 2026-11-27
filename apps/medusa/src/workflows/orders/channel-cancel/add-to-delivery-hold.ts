import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules, OrderStatus } from '@medusajs/framework/utils';

import { ADD_TO_DELIVERY_PARENT_KEY } from '../../../modules/almond-fulfillment/add-to-delivery/resolve-parent';
import {
  ADD_TO_DELIVERY_CANCELING_KEY,
  withheldForParent,
} from '../../../modules/almond-fulfillment/add-to-delivery/live-add-ons';
import { paymentRefundLockKey } from '../../../modules/almond-payment/refund-data';
import { cancelShippingFeeBearer } from '../partial-cancel/shipping-fee-bearer';
import { toNumber } from '../partial-cancel/amount';
import { issuePaymentRefund } from '../settlement/issue-payment-refund';
import type { RefundMode } from '../settlement/refund-mode';
import { listOrderRefunds, orderCancelLockKey, orderPaymentIds } from '../settlement/order-payments';
import { reconcileOrderWalletRefunds } from '../settlement/wallet-refund-ledger';

export const ADD_TO_DELIVERY_HOLD_KEY = 'add_to_delivery_hold';

/** 부모만 취소했을 때 환불에서 뺀 함께 배송 배송비. released 는 되돌려준 합, releases 는 자식 주문마다 되돌려준 금액(멱등 키). */
export type AddToDeliveryHold = { amount: number; released: number; releases: Record<string, number> };

const PAYMENT_LOCK_TIMEOUT_SECONDS = 30;
const ORDER_LOCK_TIMEOUT_SECONDS = 120;

const releaseNote = (parentOrderId: string) => `add-to-delivery-release:${parentOrderId}`;

export function readHold(metadata: unknown): AddToDeliveryHold | null {
  const v = (metadata as Record<string, unknown> | null | undefined)?.[
    ADD_TO_DELIVERY_HOLD_KEY
  ] as Partial<AddToDeliveryHold> | null;
  if (!v || typeof v !== 'object' || typeof v.amount !== 'number') return null;

  return {
    amount: v.amount,
    released: typeof v.released === 'number' ? v.released : 0,
    releases: v.releases && typeof v.releases === 'object' ? v.releases : {},
  };
}

/**
 * 함께 배송 주문이 전체취소를 시작한다고 적는다(환불 전). 부모 취소가 이 표시를 본 뒤면 이 주문 몫을 보류하지 않고,
 * 이 표시·자기 환불·되돌려주기는 부모 정산 잠금 안에서 함께 돈다(channel-cancel-order 의 함께 배송 갈래).
 */
export async function markAddOnCanceling(container: MedusaContainer, orderId: string): Promise<void> {
  const orderModule = container.resolve(Modules.ORDER);
  const current = await orderModule.retrieveOrder(orderId, { select: ['id', 'metadata'] });
  const metadata = (current.metadata ?? {}) as Record<string, unknown>;
  if (typeof metadata[ADD_TO_DELIVERY_PARENT_KEY] !== 'string' || metadata[ADD_TO_DELIVERY_CANCELING_KEY]) return;

  await orderModule.updateOrders([
    { id: orderId, metadata: { ...metadata, [ADD_TO_DELIVERY_CANCELING_KEY]: new Date().toISOString() } },
  ]);
}

/** 환불이 영구 거절돼 주문이 그대로 남으면 표시를 지운다 — 남으면 다음 부모 취소가 이 주문 몫을 보류하지 않는다 */
export async function clearAddOnCanceling(container: MedusaContainer, orderId: string): Promise<void> {
  const orderModule = container.resolve(Modules.ORDER);
  const current = await orderModule.retrieveOrder(orderId, { select: ['id', 'metadata'] });
  const metadata = (current.metadata ?? {}) as Record<string, unknown>;
  if (!metadata[ADD_TO_DELIVERY_CANCELING_KEY]) return;

  await orderModule.updateOrders([{ id: orderId, metadata: { ...metadata, [ADD_TO_DELIVERY_CANCELING_KEY]: null } }]);
}

/** 이 주문이 함께 배송 주문이면 부모 주문 id */
export async function addOnParentId(container: MedusaContainer, orderId: string): Promise<string | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({ entity: 'order', fields: ['id', 'metadata'], filters: { id: orderId } });
  const parentId = data[0]?.metadata?.[ADD_TO_DELIVERY_PARENT_KEY];

  return typeof parentId === 'string' && parentId ? parentId : null;
}

/** 부모 주문의 정산 잠금(부모 전체취소가 잡는 것과 같은 키) 안에서 돈다 */
export async function withParentSettlementLock<T>(
  container: MedusaContainer,
  parentOrderId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return container
    .resolve(Modules.LOCKING)
    .execute(orderCancelLockKey(parentOrderId), fn, { timeout: ORDER_LOCK_TIMEOUT_SECONDS });
}

/** 부모 전체취소에서 남겨 둘 금액. 판매자 탓 취소(배송 지연 등)면 고객에게 물리지 않는다. */
export async function holdForParentCancel(
  container: MedusaContainer,
  input: { orderId: string; reasonCode?: string; requestedBy?: string },
): Promise<number> {
  if (cancelShippingFeeBearer(input) !== 'customer') return 0;

  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  return withheldForParent(knex, query, input.orderId);
}

/** 취소 «전»에 보류를 적는다. 남길 것이 없는데 앞 시도가 적은 보류가 있으면 0 으로 덮는다(재시도 사이 자식이 취소된 경우). */
export async function recordHoldBeforeCancel(container: MedusaContainer, orderId: string, held: number): Promise<void> {
  if (held <= 0) {
    const orderModule = container.resolve(Modules.ORDER);
    const current = await orderModule.retrieveOrder(orderId, { select: ['id', 'metadata'] });
    if (!readHold(current.metadata)) return;
  }

  await writeHold(container, orderId, { amount: Math.max(0, held), released: 0, releases: {} });
}

export async function writeHold(container: MedusaContainer, orderId: string, hold: AddToDeliveryHold): Promise<void> {
  const orderModule = container.resolve(Modules.ORDER);
  const current = await orderModule.retrieveOrder(orderId, { select: ['id', 'metadata'] });

  await orderModule.updateOrders([
    { id: orderId, metadata: { ...(current.metadata ?? {}), [ADD_TO_DELIVERY_HOLD_KEY]: hold } },
  ]);
}

/** 부모 정산 잠금 안에서: 부모 보류에서 이제 필요 없는 몫을 돌려준다. 자식마다 한 번(releases). */
export async function releaseInsideParentLock(
  container: MedusaContainer,
  parentOrderId: string,
  input: { childOrderId: string; refundMode: RefundMode; actorId?: string },
): Promise<void> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: 'order',
    fields: ['id', 'status', 'metadata'],
    filters: { id: parentOrderId },
  });
  const parent = data[0];
  const hold = readHold(parent?.metadata);
  if (!parent || parent.status !== OrderStatus.CANCELED || !hold) return;
  if (hold.releases[input.childOrderId] !== undefined) return;

  // 돌려준 몫은 metadata 가 아니라 장부로 센다 — 환불 뒤 기록 전에 끊긴 재시도가 같은 돈을 또 내지 않게. 응답을 잃은 환불도 맞추기가 넣는다
  await reconcileOrderWalletRefunds(container, parentOrderId, { viaPaymentModule: true });
  const releasedInLedger = (await listOrderRefunds(container, parentOrderId))
    .filter((r) => r.note === releaseNote(parentOrderId))
    .reduce((sum, r) => sum + toNumber(r.amount), 0);

  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const stillNeeded = await withheldForParent(knex, query, parentOrderId, [input.childOrderId]);
  const amount = Math.max(0, hold.amount - releasedInLedger - stillNeeded);

  if (amount > 0) await refundOnCanceledOrder(container, parentOrderId, amount, input.refundMode, input.actorId);

  await writeHold(container, parentOrderId, {
    ...hold,
    released: releasedInLedger + amount,
    releases: { ...hold.releases, [input.childOrderId]: amount },
  });
}

/** 취소된 주문의 결제에서 amount 만큼 결제 순서대로 돌려준다. 결제마다 «캡처 − 환불»을 넘지 않는다. */
async function refundOnCanceledOrder(
  container: MedusaContainer,
  orderId: string,
  amount: number,
  mode: RefundMode,
  actorId?: string,
): Promise<void> {
  const paymentModule = container.resolve(Modules.PAYMENT);
  const locking = container.resolve(Modules.LOCKING);
  let left = amount;

  for (const paymentId of await orderPaymentIds(container, orderId)) {
    if (left <= 0) break;

    await locking.execute(
      paymentRefundLockKey(paymentId),
      async () => {
        const p = await paymentModule.retrievePayment(paymentId, { relations: ['captures', 'refunds'] });
        const captured = (p.captures ?? []).reduce((s, x) => s + toNumber(x.amount), 0);
        const refunded = (p.refunds ?? []).reduce((s, x) => s + toNumber(x.amount), 0);
        const take = Math.min(left, captured - refunded);
        if (!(take > 0)) return;

        await issuePaymentRefund(container, {
          paymentId,
          amount: take,
          note: releaseNote(orderId),
          mode,
          kind: 'ITEM_CANCEL',
          actorId,
          viaPaymentModule: true,
        });
        left -= take;
      },
      { timeout: PAYMENT_LOCK_TIMEOUT_SECONDS },
    );
  }

  if (left > 0) throw new Error(`함께 배송 보류를 다 돌려주지 못했습니다(${orderId}): 남은 ${left}원`);
}
