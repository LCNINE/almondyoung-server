import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { refreshCartItemsWorkflow } from '@medusajs/medusa/core-flows';
import { refetchCart } from '../helpers';
import { defaultStoreCartFields } from '../query-config';
import { autoFillShipping, isValidAddress } from '../../customers/me/cart/auto-fill-shipping';
import { findStaleTimeSalePriceLines } from '../../../../workflows/hooks/cart/private-time-sale-price';

/**
 * GET /store/carts/:id
 *
 * 카트 조회 시 고객의 기본 배송지를 자동으로 채웁니다.
 * - customer_id가 있고 shipping_address가 비어있으면 autoFillShipping 호출
 * - 기존 Medusa 기본 동작 유지
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const cartId = req.params.id;

  // 요청된 필드 또는 기본 필드 사용
  const fields = req.queryConfig?.fields?.length ? req.queryConfig.fields : defaultStoreCartFields;

  let cart = await refetchCart(cartId, req.scope, fields);

  if (!cart) {
    return res.status(404).json({
      message: 'Cart not found',
    });
  }

  // 지금 이 고객이 받을 수 없는 옛 타임세일가가 남은 라인이 있으면 가격을 다시 계산한 뒤 응답한다
  try {
    if ((await findStaleTimeSalePriceLines(req.scope, cartId)).length) {
      await refreshCartItemsWorkflow(req.scope).run({ input: { cart_id: cartId, force_refresh: true } });
      cart = await refetchCart(cartId, req.scope, fields);
    }
  } catch (error) {
    console.error('[GET /store/carts/:id] stale time-sale price refresh failed:', error);
  }

  // 고객 카트이고 배송지/메모가 비어있으면 자동 채우기
  const needsAddress = !isValidAddress(cart.shipping_address);
  const needsMemo = !cart.metadata?.shipping_memo_type;

  if (cart.customer_id && (needsAddress || needsMemo)) {
    try {
      await autoFillShipping(req.scope, {
        id: cart.id,
        customer_id: cart.customer_id,
        shipping_address: cart.shipping_address,
        metadata: cart.metadata,
      });
      // 자동 채우기 후 카트 재조회
      cart = await refetchCart(cartId, req.scope, fields);
    } catch (error) {
      console.error('[GET /store/carts/:id] autoFillShipping failed:', error);
    }
  }

  return res.status(200).json({ cart });
}
