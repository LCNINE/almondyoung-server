import { createCartWorkflow, refreshCartItemsWorkflow } from '@medusajs/medusa/core-flows';
import { enforcePromotionCap } from './enforce-promotion-cap';

/**
 * 정률 쿠폰 캡을 **재계산 지점마다** 건다 (#488 A4 / P10-B).
 *
 * 등록은 전역 부수효과라 유닛이 닿지 않는다. 그래서 이 파일은 **배선만** 갖고 판정은
 * `promotion-cap.ts`(순수) · `enforce-promotion-cap.ts`(I/O) 가 갖는다.
 *
 * ⚠️ 훅은 워크플로당 핸들러 **하나**다. 여기 둘은 2026-08-31 기준 저장소 전체에서 미점유였다
 * (`createCartWorkflow.hooks.validate` 만 `handle-validate-cart-items-inventory.ts` 가 쓴다).
 * `__tests__/no-duplicate-validate-hooks.unit.spec.ts` 가 이걸 계속 지킨다.
 *
 * 여기 없는 경로가 둘 있다 — 이유가 다르다:
 *  - `POST|DELETE /store/carts/:id/promotions` 는 **훅이 없어** 라우트로 덮는다
 *    (`api/store/carts/[id]/promotions/route.ts`).
 *  - `refreshPaymentCollectionForCartWorkflow.hooks.validate` 는 **쓰면 안 된다.** 그 워크플로는
 *    카트를 훅보다 **먼저** fetch 해서 그 `raw_total` 로 결제금액을 정한다. 거기서 깎으면
 *    결제 컬렉션이 캡 이전 금액으로 잡힌다(2026-08-31 소스 확인).
 */
refreshCartItemsWorkflow.hooks.beforeRefreshingPaymentCollection(async ({ input }, { container }) => {
  await enforcePromotionCap(container, (input as any)?.cart_id);
});

createCartWorkflow.hooks.cartCreated(async ({ cart }, { container }) => {
  await enforcePromotionCap(container, (cart as any)?.id);
});
