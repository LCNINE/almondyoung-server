import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { refetchCart } from '../helpers';
import { defaultStoreCartFields } from '../query-config';
import { autoFillShipping, isValidAddress } from '../../customers/me/cart/auto-fill-shipping';

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
