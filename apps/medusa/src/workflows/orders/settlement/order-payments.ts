import type { MedusaContainer, RefundDTO } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';

/**
 * 부분취소와 채널 전체취소가 같이 쓰는 주문 잠금 — 한 주문의 정산은 한 번에 하나다(재발행·재배달이 겹쳐도 환불은 한 번).
 * 값은 진행 중인 부분취소 잠금과 맞물리도록 옛 값 그대로 둔다. 안에서 결제 잠금(paymentRefundLockKey)을 잡는다 — 순서는 늘 주문 → 결제.
 */
export const orderCancelLockKey = (orderId: string) => `partial-cancel:${orderId}`;

/** 주문 ↔ 결제 컬렉션은 링크다(주문 버전과 무관). 결제 자체는 payment 모듈에서 읽는다. */
export async function orderPaymentIds(container: MedusaContainer, orderId: string): Promise<string[]> {
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

/** 이 주문 결제들의 환불 행(장부) 전부. 순서는 보장하지 않는다 — 합·메모로만 읽는다. */
export async function listOrderRefunds(container: MedusaContainer, orderId: string): Promise<RefundDTO[]> {
  const paymentIds = await orderPaymentIds(container, orderId);
  if (paymentIds.length === 0) return [];
  const payments = await container.resolve(Modules.PAYMENT).listPayments({ id: paymentIds }, { relations: ['refunds'] });
  return payments.flatMap((p) => p.refunds ?? []);
}
