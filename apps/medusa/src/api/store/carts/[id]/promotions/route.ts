import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { PromotionActions } from '@medusajs/framework/utils';
import {
  refreshPaymentCollectionForCartWorkflow,
  updateCartPromotionsWorkflow,
} from '@medusajs/medusa/core-flows';
import { refetchCart } from '../../helpers';
import { defaultStoreCartFields } from '../../query-config';
import { enforcePromotionCap } from '../../../../../workflows/hooks/cart/enforce-promotion-cap';

/**
 * 코어 `POST|DELETE /store/carts/:id/promotions` 자리에 우리 핸들러를 둔다 (#488 A4 / P10-B).
 *
 * **왜.** 이 경로는 `updateCartPromotionsWorkflow` 를 직접 부르는데, 그 워크플로의 훅은
 * `validate` 하나뿐이고 **adjustment 가 만들어지기 전**이라 캡을 걸 자리가 없다.
 * 다른 경로에 «복제»하면 원본이 캡 없이 남는다 — 그건 돈이 걸린 통제에는 못 쓴다.
 *
 * **코어와 다른 점은 한 줄뿐이다.** 코어는 `force_refresh_payment_collection: true` 로 워크플로
 * 안에서 결제 컬렉션을 갱신한다. 우리는 그걸 `false` 로 두고 **캡을 건 뒤에** 직접 갱신한다.
 * 순서를 바꾸면 결제 컬렉션이 캡 이전 금액으로 잡힌다.
 *
 * ⚠️ 코어 zod 검증(`req.validatedBody`)은 matcher 단위로 붙어 이 핸들러에도 그대로 먹는다
 * (2026-08-31 P10-A 실측). `api/middlewares.ts` 의 `perCustomerLimitMiddleware` 도 그대로다.
 */
async function applyPromotions(
  req: MedusaRequest,
  res: MedusaResponse,
  action: (typeof PromotionActions)[keyof typeof PromotionActions],
) {
  const cartId = req.params.id;
  const payload = req.validatedBody as { promo_codes: string[] };

  await updateCartPromotionsWorkflow(req.scope).run({
    input: {
      cart_id: cartId,
      promo_codes: payload.promo_codes,
      action,
      force_refresh_payment_collection: false,
    },
  });

  await enforcePromotionCap(req.scope, cartId);

  await refreshPaymentCollectionForCartWorkflow(req.scope).run({
    input: { cart_id: cartId },
  });

  const fields = req.queryConfig?.fields?.length ? req.queryConfig.fields : defaultStoreCartFields;
  const cart = await refetchCart(cartId, req.scope, fields);
  return res.status(200).json({ cart });
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const payload = req.validatedBody as { promo_codes: string[] };
  return applyPromotions(
    req,
    res,
    payload.promo_codes.length > 0 ? PromotionActions.ADD : PromotionActions.REPLACE,
  );
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  return applyPromotions(req, res, PromotionActions.REMOVE);
}
