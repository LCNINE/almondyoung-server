import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from '@medusajs/framework/http';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { defaultStoreCartFields } from '../../../carts/query-config';

/**
 * GET /store/customers/me/cart
 * 로그인한 고객의 미완료 카트를 복구합니다.
 *
 * 로그아웃 후 재로그인 시 이전에 담았던 장바구니를 유실하지 않도록
 * customer_id 기준으로 가장 최근의 미완료 카트를 조회합니다.
 *
 * 반환:
 * - 미완료 카트가 있으면 해당 카트 반환
 * - 미완료 카트가 없으면 null 반환
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) {
  const customerId = req.auth_context?.actor_id;

  if (!customerId) {
    return res.status(401).json({
      message: 'Customer authentication required',
    });
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  // 고객의 미완료 카트 조회 (completed_at이 null인 것만)
  // 가장 최근에 업데이트된 카트를 우선 반환
  const { data: carts } = await query.graph({
    entity: 'cart',
    fields: ['id', 'customer_id', 'completed_at', 'updated_at', ...defaultStoreCartFields],
    filters: {
      customer_id: customerId,
      completed_at: null,
    },
  });

  if (!carts || carts.length === 0) {
    return res.status(200).json({
      cart: null,
      message: 'No active cart found for this customer',
    });
  }

  // 카트 선택 우선순위:
  // 1. 아이템이 있는 카트를 우선
  // 2. 아이템 수가 많은 카트를 우선
  // 3. 최근에 업데이트된 카트를 우선
  const sortedCarts = carts.sort((a: any, b: any) => {
    const itemsA = a.items?.length ?? 0;
    const itemsB = b.items?.length ?? 0;

    // 아이템이 있는 카트 우선
    if (itemsA > 0 && itemsB === 0) return -1;
    if (itemsB > 0 && itemsA === 0) return 1;

    // 아이템 수가 많은 카트 우선
    if (itemsA !== itemsB) return itemsB - itemsA;

    // 최근 업데이트된 카트 우선
    const dateA = new Date(a.updated_at || 0);
    const dateB = new Date(b.updated_at || 0);
    return dateB.getTime() - dateA.getTime();
  });

  const latestCart = sortedCarts[0];

  return res.status(200).json({
    cart: latestCart,
  });
}
