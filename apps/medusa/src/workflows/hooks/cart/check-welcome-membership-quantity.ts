import { updateLineItemInCartWorkflow } from '@medusajs/medusa/core-flows';
import { MedusaError, Modules } from '@medusajs/framework/utils';
import type { ICartModuleService, IProductModuleService } from '@medusajs/framework/types';

/**
 * 웰컴 멤버십 상품 수량 변경 서버 검증 훅
 *
 * 장바구니 수량 변경 시:
 * 1. 변경되는 line item이 웰컴 멤버십 상품인지 확인 (product tag: "welcome-membership")
 * 2. 수량이 1 초과이면 에러 반환
 */
const WELCOME_MEMBERSHIP_TAG = 'welcome-membership';

updateLineItemInCartWorkflow.hooks.validate(async ({ input, cart }, { container }) => {
  const newQuantity = input.update?.quantity;
  if (!newQuantity || Number(newQuantity) <= 1) return;

  // cart.items에서 해당 line item의 variant_id 조회
  const lineItem = cart.items?.find((item: any) => item.id === input.item_id);
  const variantId = lineItem?.variant_id;

  if (!variantId) {
    // cart에 items가 없는 경우 cartModule로 fallback
    const cartModule = container.resolve<ICartModuleService>(Modules.CART);
    const fetchedItem = await cartModule.retrieveLineItem(input.item_id, {
      select: ['variant_id'],
    });
    if (!fetchedItem?.variant_id) return;
    return checkVariantTag(fetchedItem.variant_id, container);
  }

  return checkVariantTag(variantId, container);
});

async function checkVariantTag(variantId: string, container: any): Promise<void> {
  const productModule = container.resolve(Modules.PRODUCT) as IProductModuleService;
  const variants = await productModule.listProductVariants(
    { id: [variantId] },
    { relations: ['product', 'product.tags'] },
  );

  const isWelcomeMembership = variants.some((variant) => {
    const tags: Array<{ value: string }> = (variant as any).product?.tags ?? [];
    return tags.some((tag) => tag.value === WELCOME_MEMBERSHIP_TAG);
  });

  if (isWelcomeMembership) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, '웰컴 멤버십 상품은 1인당 1개 구매 가능합니다.');
  }
}
