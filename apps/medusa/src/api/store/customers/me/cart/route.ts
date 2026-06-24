import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { addToCartWorkflow, transferCartCustomerWorkflow } from '@medusajs/medusa/core-flows';
import { defaultStoreCartFields } from '../../../carts/query-config';
import { autoFillShipping } from './auto-fill-shipping';

/**
 * 고객 카트 조회 헬퍼
 */
async function getCustomerCart(query: any, customerId: string) {
  const { data: carts } = await query.graph({
    entity: 'cart',
    fields: ['id', 'customer_id', 'completed_at', 'updated_at', 'metadata', ...defaultStoreCartFields],
    filters: {
      customer_id: customerId,
      completed_at: null,
    },
  });

  // 결제용 checkout cart / 배송 미리보기 cart 는 일반 장바구니 복구 대상에서 제외.
  // createCheckoutCartFromLineItems 가 checkout cart 도 고객에게 transfer 하므로, 무통장 입금 대기 (최대 72h) 동안 쿠키가 소실되면 결제용 cart 가 고객 장바구니로 복구되는 레이스가 생긴다.
  // source_cart_id(원본 참조) / is_shipping_preview metadata 로 파생 cart 를 가려남.
  const shoppingCarts = (carts || []).filter((cart: any) => {
    // 안전망: query.graph 의 `completed_at: null` 필터가 환경/버전에 따라 안 걸리는 경우가 있어,
    // 완료(주문 전환)된 카트를 JS 에서 명시적으로 한 번 더 배제한다. 이게 빠지면 무통장 주문 직후
    // '방금 완료된 카트'가 복구되어 addToCart 가 'already completed' 로 실패한다.
    if (cart?.completed_at) return false;
    const meta = (cart?.metadata ?? {}) as Record<string, unknown>;
    return !meta.source_cart_id && meta.is_shipping_preview !== true;
  });

  // 카트 선택 우선순위:
  // 1. updated_at 최신 카트 우선
  // 2. 동시간대면 아이템이 있는 카트를 우선
  // 3. 그래도 같으면 아이템 수가 많은 카트를 우선
  const sortedCarts = shoppingCarts.sort((a: any, b: any) => {
    const dateA = new Date(a.updated_at || 0).getTime();
    const dateB = new Date(b.updated_at || 0).getTime();

    if (dateA !== dateB) {
      return dateB - dateA;
    }

    const itemsA = a.items?.length ?? 0;
    const itemsB = b.items?.length ?? 0;

    if (itemsA > 0 && itemsB === 0) return -1;
    if (itemsB > 0 && itemsA === 0) return 1;

    return itemsB - itemsA;
  });

  return sortedCarts[0] || null;
}

/**
 * GET /store/customers/me/cart
 * 로그인한 고객의 미완료 카트를 조회합니다.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customerId = req.auth_context?.actor_id;

  if (!customerId) {
    return res.status(401).json({
      message: 'Customer authentication required',
    });
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  let customerCart = await getCustomerCart(query, customerId);

  if (!customerCart) {
    return res.status(200).json({
      cart: null,
      message: 'No active cart found for this customer',
    });
  }

  // 배송지 및 배송 메모 자동 채우기 (기존 고객 카트 복구 시)
  try {
    await autoFillShipping(req.scope, {
      id: customerCart.id,
      customer_id: customerCart.customer_id,
      shipping_address: customerCart.shipping_address,
      metadata: customerCart.metadata,
    });
    // 업데이트가 있었을 수 있으므로 카트를 다시 조회
    customerCart = await getCustomerCart(query, customerId);
  } catch (error) {
    console.error('[GET /store/customers/me/cart] autoFillShipping failed:', error);
  }

  return res.status(200).json({
    cart: customerCart,
  });
}

/**
 * POST /store/customers/me/cart
 * 고객의 미완료 카트를 복구하고, 게스트 카트 아이템을 병합합니다.
 *
 * Body:
 * - guestCartId?: string - 게스트 카트 ID (전달 시 아이템 병합)
 *
 * 반환:
 * - 병합된 고객 카트 (또는 기존 카트)
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customerId = req.auth_context?.actor_id;

  if (!customerId) {
    return res.status(401).json({
      message: 'Customer authentication required',
    });
  }

  const { guestCartId } = req.body as { guestCartId?: string };
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  let customerCart = await getCustomerCart(query, customerId);

  // 게스트 카트 ID가 전달된 경우:
  // 1) 고객 카트가 없으면 게스트 카트를 고객 카트로 이관
  // 2) 고객 카트가 있으면 누락 아이템만 병합
  if (guestCartId) {
    try {
      // 게스트 카트 조회
      const { data: guestCarts } = await query.graph({
        entity: 'cart',
        fields: ['id', 'customer_id', 'items.id', 'items.variant_id', 'items.quantity'],
        filters: {
          id: guestCartId,
          completed_at: null,
        },
      });

      const guestCart = guestCarts?.[0];

      if (!customerCart && guestCart?.id) {
        const isSameCustomerCart = guestCart.customer_id === customerId;

        if (!guestCart.customer_id || isSameCustomerCart) {
          await transferCartCustomerWorkflow(req.scope).run({
            input: {
              id: guestCart.id,
              customer_id: customerId,
            },
          });
        }

        customerCart = await getCustomerCart(query, customerId);
      }

      if (customerCart && guestCart?.items?.length > 0) {
        // 고객 카트에 이미 있는 variant_id 목록
        const existingVariantIds = new Set((customerCart.items || []).map((item: any) => item.variant_id));

        // 고객 카트에 없는 게스트 아이템만 필터링
        const itemsToAdd = guestCart.items
          .filter((item: any) => item.variant_id && !existingVariantIds.has(item.variant_id))
          .map((item: any) => ({
            variant_id: item.variant_id,
            quantity: item.quantity || 1,
          }));

        // 병합할 아이템이 있으면 추가
        if (itemsToAdd.length > 0) {
          await addToCartWorkflow(req.scope).run({
            input: {
              cart_id: customerCart.id,
              items: itemsToAdd,
            },
          });

          // 병합 후 카트 다시 조회
          customerCart = await getCustomerCart(query, customerId);
        }
      }
    } catch (error) {
      // 병합 실패해도 기존 고객 카트는 반환
      console.error('Failed to merge guest cart items:', error);
    }
  }

  if (!customerCart) {
    return res.status(200).json({
      cart: null,
      message: 'No active cart found for this customer',
    });
  }

  // 배송지 및 배송 메모 자동 채우기
  try {
    await autoFillShipping(req.scope, {
      id: customerCart.id,
      customer_id: customerCart.customer_id,
      shipping_address: customerCart.shipping_address,
      metadata: customerCart.metadata,
    });
    // 업데이트가 있었을 수 있으므로 카트를 다시 조회
    customerCart = await getCustomerCart(query, customerId);
  } catch (error) {
    console.error('[POST /store/customers/me/cart] autoFillShipping failed:', error);
  }

  return res.status(200).json({
    cart: customerCart,
  });
}
