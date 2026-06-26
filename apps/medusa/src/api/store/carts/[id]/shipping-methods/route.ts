import { MedusaRequest, MedusaResponse, prepareRetrieveQuery } from '@medusajs/framework/http';
import type { ICartModuleService } from '@medusajs/framework/types';
import { Modules } from '@medusajs/framework/utils';
import { refetchCart } from '../../helpers';
import { defaultStoreCartFields } from '../../query-config';

/**
 * 카트의 모든 배송 method 를 제거
 * DELETE /store/carts/:id/shipping-methods
 *
 * 디지털 단독 카트(배송 불필요)인데, 물리 상품이 있던 동안 설정된 배송 method 가 남아 Medusa total 에 배송비가 포함되는 결제 금액 불일치를 막기 위해 사용한
 */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const cartId = req.params.id;
  const cartService = req.scope.resolve<ICartModuleService>(Modules.CART);

  const cart = await cartService.retrieveCart(cartId, {
    relations: ['shipping_methods'],
  });
  const methodIds = (cart.shipping_methods ?? []).map((m) => m.id);

  if (methodIds.length > 0) {
    await cartService.deleteShippingMethods(methodIds);
  }

  const refreshed = await refetchCart(
    cartId,
    req.scope,
    (
      await prepareRetrieveQuery(
        {},
        {
          defaults: defaultStoreCartFields,
        },
      )
    ).remoteQueryConfig.fields,
  );

  res.status(200).json({
    cart: refreshed,
    deleted_count: methodIds.length,
  });
};
