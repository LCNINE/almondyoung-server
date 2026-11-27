import { calculateShippingFee } from '../calculate-shipping-fee';
import { toAmount, type QueryGraph } from '../service';
import { POLICY_SNAPSHOT_KEY, type ShippingPolicySnapshot } from '../types';

/**
 * 함께 배송 주문이 혼자 나갔다면 냈을 배송비. 결제 시점 정책 스냅샷으로 다시 계산하므로
 * 정책이 나중에 바뀌어도 결제 때 값이 나온다.
 */
export async function waivedShippingAmount(query: QueryGraph, orderId: string): Promise<number> {
  const { data } = await query.graph({
    entity: 'order',
    fields: [
      'id',
      'shipping_address.postal_code',
      'shipping_methods.data',
      'items.product_id',
      'items.requires_shipping',
      'items.subtotal',
      'items.unit_price',
      'items.quantity',
    ],
    filters: { id: orderId },
  });
  const order = data[0];
  if (!order) return 0;

  const snapshots = (order.shipping_methods ?? [])
    .map((m: Record<string, any>) => m?.data?.[POLICY_SNAPSHOT_KEY] as ShippingPolicySnapshot | undefined)
    .filter((s: ShippingPolicySnapshot | undefined): s is ShippingPolicySnapshot => Boolean(s?.policy));
  if (snapshots.length === 0) return 0;

  const items = (order.items ?? []).filter((i: Record<string, any>) => i?.requires_shipping !== false && i?.product_id);
  const toLine = (i: Record<string, any>) => ({
    subtotal: toAmount(i.subtotal ?? toAmount(i.unit_price) * toAmount(i.quantity)),
    quantity: toAmount(i.quantity),
  });

  // 함께 배송 주문은 배송비 그룹이 하나라, 지금 상품 그룹(결제 뒤 바뀔 수 있다)을 보지 않고 배송 줄 전부를 그 그룹으로 본다.
  if (snapshots.length === 1)
    return calculateShippingFee(snapshots[0].policy, items.map(toLine), order.shipping_address?.postal_code);

  const productIds = [...new Set(items.map((i: Record<string, any>) => i.product_id as string))];
  const { data: products } = await query.graph({
    entity: 'product',
    fields: ['id', 'shipping_profile.id'],
    filters: { id: productIds },
  });
  const profileByProduct = new Map(products.map((p) => [p.id, p.shipping_profile?.id]));

  return snapshots.reduce((sum: number, snapshot: ShippingPolicySnapshot) => {
    const lines = items
      .filter((i: Record<string, any>) => profileByProduct.get(i.product_id) === snapshot.shippingProfileId)
      .map(toLine);

    return sum + calculateShippingFee(snapshot.policy, lines, order.shipping_address?.postal_code);
  }, 0);
}
