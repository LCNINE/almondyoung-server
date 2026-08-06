import { MedusaRequest, MedusaResponse, prepareRetrieveQuery } from '@medusajs/framework/http';
import { MedusaError } from '@medusajs/framework/utils';
import { addShippingMethodToCartWorkflow } from '@medusajs/medusa/core-flows';

import { refetchCart } from '../../../helpers';
import { defaultStoreCartFields } from '../../../query-config';

/**
 * 카트에 여러 배송수단을 한 번에 설정.
 * POST /store/carts/:id/shipping-methods/bulk  { option_ids: string[] }
 *
 * Medusa 기본 POST /store/carts/:id/shipping-methods 는 option_id 를 하나만 받고,
 * addShippingMethodToCartWorkflow 가 기존 배송수단을 **전부 지운 뒤** 새로 만든다.
 * 그래서 순차 호출하면 두 번째가 첫 번째를 지운다.
 *
 * 배송비 그룹이 2개 이상 담긴 카트는 shipping profile 마다 배송수단이 하나씩 있어야
 * 결제 완료(core-flows 의 validateShippingStep)를 통과하므로, 한 번에 넣어야 한다.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const cartId = req.params.id;
  const optionIds = (req.body as { option_ids?: unknown })?.option_ids;

  if (!Array.isArray(optionIds) || optionIds.length === 0 || optionIds.some((id) => typeof id !== 'string')) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'option_ids 는 비어 있지 않은 문자열 배열이어야 합니다.');
  }

  await addShippingMethodToCartWorkflow(req.scope).run({
    input: {
      cart_id: cartId,
      options: [...new Set(optionIds as string[])].map((id) => ({ id })),
    },
  });

  // 호출자가 fields 를 넘기면 그대로 존중한다. 기본값만 쓰면 shipping_total/total 같은 합계가
  // 빠져 스토어프론트가 배송비 0원으로 그린다.
  const requestedFields = typeof req.query.fields === 'string' ? req.query.fields : undefined;
  const { remoteQueryConfig } = await prepareRetrieveQuery(
    requestedFields ? { fields: requestedFields } : {},
    { defaults: defaultStoreCartFields, isList: false },
  );

  const cart = await refetchCart(cartId, req.scope, remoteQueryConfig.fields);

  res.status(200).json({ cart });
};
