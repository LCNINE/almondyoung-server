import { MedusaRequest, MedusaResponse, prepareRetrieveQuery } from '@medusajs/framework/http';
import { addToCartWorkflow, refreshCartItemsWorkflow } from '@medusajs/medusa/core-flows';
import { refetchCart } from '../../helpers';
import { findMergedLine, mergedLineNeedsReprice } from '../../merged-line';
import { defaultStoreCartFields } from '../../query-config';
import type { StoreAddLineItemBody } from './validators';

/**
 * POST /store/carts/:id/add-line-item — 코어 담기와 같지만, 기존 라인에 합쳐졌으면 합친 수량으로 다시
 * 가격을 매긴다. 코어 담기는 합칠 때 단가를 새로 담은 수량 기준으로 남겨, 나눠 담으면 수량 할인가가 빠진다.
 *
 * 합치기와 재가격은 둘 다 카트 락 안에서 DB 의 현재 수량으로 돈다 — 동시에 담아도 수량이 덮이지 않는다.
 * 동시에 담은 요청은 각자 자기 담기 뒤의 수량으로 판정하므로, 마지막 요청이 최종 수량을 본다.
 * 담기 검증 훅(회원 자격·구매 제약)은 코어 담기 워크플로가 그대로 탄다.
 */
export const POST = async (req: MedusaRequest<StoreAddLineItemBody>, res: MedusaResponse) => {
  const cartId = req.params.id;
  const item = req.validatedBody;
  const fields = (
    await prepareRetrieveQuery({}, { defaults: [...defaultStoreCartFields, 'items.is_custom_price'] })
  ).remoteQueryConfig.fields;

  await addToCartWorkflow(req.scope).run({ input: { cart_id: cartId, items: [item] } });

  let cart = await refetchCart(cartId, req.scope, fields);
  const merged = findMergedLine(cart.items ?? [], item);
  // 재계산은 카트 워크플로 한 번 값이라, 합친 수량으로 단가가 실제로 바뀔 때만 한다.
  if (merged && (await mergedLineNeedsReprice(req.scope, cartId, merged))) {
    await refreshCartItemsWorkflow(req.scope).run({ input: { cart_id: cartId, force_refresh: true } });
    cart = await refetchCart(cartId, req.scope, fields);
  }

  res.status(200).json({ cart });
};
