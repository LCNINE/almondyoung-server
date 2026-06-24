import type { AdminOrder } from '@/lib/api/domains/medusa';
import { paymentMethodLabel } from './order-labels';

type OrderItem = AdminOrder['items'][number];

/** 주문의 결제수단 라벨 목록 (중복 제거). payment_collections 미포함 시 빈 배열 */
export function orderPaymentMethods(order: AdminOrder): string[] {
  const collections = order.payment_collections ?? [];
  const labels = new Set<string>();
  for (const collection of collections) {
    for (const payment of collection.payments ?? []) {
      if (payment.provider_id) {
        labels.add(paymentMethodLabel(payment.provider_id));
      }
    }
  }
  return [...labels];
}

/** 라인 아이템 수량을 미배송/배송중/배송완료 버킷으로 합산 */
export function fulfillmentBuckets(order: AdminOrder): {
  pending: number;
  shipping: number;
  delivered: number;
} {
  let pending = 0;
  let shipping = 0;
  let delivered = 0;

  for (const item of order.items ?? []) {
    const detail = item.detail;
    const qty = detail?.quantity ?? item.quantity ?? 0;
    const shipped = detail?.shipped_quantity ?? 0;
    const deliv = detail?.delivered_quantity ?? 0;

    delivered += deliv;
    shipping += Math.max(0, shipped - deliv);
    pending += Math.max(0, qty - shipped);
  }

  return { pending, shipping, delivered };
}

/** 개별 품목의 주문상태 라벨 (배송 데이터 기준, 미완성일 수 있음) */
export function itemStatusLabel(item: OrderItem): string {
  const detail = item.detail;
  const qty = detail?.quantity ?? item.quantity ?? 0;
  const shipped = detail?.shipped_quantity ?? 0;
  const deliv = detail?.delivered_quantity ?? 0;

  if (qty > 0 && deliv >= qty) return '배송완료';
  if (deliv > 0) return '부분배송';
  if (shipped > 0) return '배송중';
  return '상품준비중';
}

/** "비투스 CS 핀셋 외 6건" 형태의 대표 상품명 */
export function summarizeItemNames(order: AdminOrder): string {
  const items = order.items ?? [];
  if (items.length === 0) return '-';
  const first = items[0].product_title ?? items[0].title ?? '상품';
  if (items.length === 1) return first;
  return `${first} 외 ${items.length - 1}건`;
}

/** 품목별 주문번호: {display_id}-01, -02 ... */
export function itemOrderNo(
  displayId: number | string | null | undefined,
  index: number
): string {
  return `${displayId ?? '-'}-${String(index + 1).padStart(2, '0')}`;
}
