import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { refreshCartItemsWorkflow } from '@medusajs/medusa/core-flows';
import { fixCompareAtPrices } from '../../../../utils/cart-prices';

/**
 * 카트 가격 재계산 (Store용). Admin 버전과 동일 로직, auth_context에서 customerId 가져옴.
 * hasMembershipGroup: 현재 고객이 멤버십 그룹에 속해 있는지 여부.
 *   - true:  멤버십 그룹 반영 완료 → 프론트 폴링 종료 조건
 *   - false: 아직 미반영 → 프론트가 재시도
 *   - null:  활성 카트 없음 → 폴링 불필요
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customerId = req.auth_context.actor_id;

  if (!customerId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data: carts } = await query.graph({
    entity: 'cart',
    fields: [
      'id',
      'currency_code',
      'region_id',
      'customer_id',
      'customer.groups.id',
      'items.id',
      'items.variant_id',
      'items.unit_price',
      'items.compare_at_unit_price',
      'items.quantity',
      'updated_at',
    ],
    filters: {
      customer_id: customerId,
      completed_at: null,
    },
  });

  const activeCart = (carts || [])
    .filter((cart: any) => cart.items?.length > 0)
    .sort((a: any, b: any) => {
      const dateA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const dateB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return dateB - dateA;
    })[0];

  if (!activeCart) {
    return res.status(200).json({ refreshed: false, hasMembershipGroup: null });
  }

  const membershipGroupId = process.env.MEDUSA_MEMBERSHIP_GROUP_ID;
  const hasMembershipGroup = membershipGroupId
    ? (activeCart.customer?.groups ?? []).some((g: any) => g.id === membershipGroupId)
    : null;

  try {
    await refreshCartItemsWorkflow(req.scope).run({
      input: { cart_id: activeCart.id, force_refresh: true },
    });
  } catch (error: any) {
    console.error(`[store/refresh-cart-prices] workflow failed:`, error?.message);
  }

  try {
    await fixCompareAtPrices(req.scope, activeCart);
  } catch (error: any) {
    console.error(`[store/refresh-cart-prices] fixCompareAtPrices failed:`, error?.message);
    return res.status(500).json({ refreshed: false, hasMembershipGroup, message: 'Failed to refresh cart prices' });
  }

  return res.status(200).json({ refreshed: true, cart_id: activeCart.id, hasMembershipGroup });
}

