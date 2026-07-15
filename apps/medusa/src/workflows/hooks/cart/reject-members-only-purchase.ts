import { addToCartWorkflow, completeCartWorkflow } from '@medusajs/medusa/core-flows';
import { ContainerRegistrationKeys, MedusaError, Modules } from '@medusajs/framework/utils';
import type { IProductModuleService } from '@medusajs/framework/types';
import { requiresMembershipToPurchase, type MembershipProduct } from '../../../utils/membership-filter';

/**
 * 멤버십 전용 구매 상품(purchaseConstraint.requiresMembership)을 비회원·일반회원이 사는 걸 막는다.
 *
 * 상품 응답 미들웨어는 품절로 "보이게"만 할 뿐 실제 재고는 그대로라, 장바구니 API 직접 호출과
 * 게이트 적용 전에 이미 담아둔 카트가 새어나간다. 담기와 결제 두 지점에서 실제로 막는다.
 */
const ERROR_MESSAGE = '멤버십 회원만 구매할 수 있는 상품입니다.';

async function isMembershipCustomer(customerId: string | null | undefined, container: any): Promise<boolean> {
  const membershipGroupId = process.env.MEDUSA_MEMBERSHIP_GROUP_ID?.trim();
  if (!customerId || !membershipGroupId) return false;

  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data: customers } = await query.graph({
    entity: 'customer',
    fields: ['id', 'groups.id'],
    filters: { id: customerId },
  });

  const groups: Array<{ id?: string }> = (customers?.[0] as any)?.groups ?? [];
  return groups.some((group) => group?.id === membershipGroupId);
}

/** variant 들이 속한 상품 중 멤버십 전용 구매가 하나라도 있으면 throw. */
async function assertNoMembersOnlyVariants(variantIds: string[], container: any): Promise<void> {
  const ids = variantIds.filter(Boolean);
  if (ids.length === 0) return;

  const productModule = container.resolve(Modules.PRODUCT) as IProductModuleService;
  const variants = await productModule.listProductVariants({ id: ids }, { relations: ['product'] });

  const blocked = variants.some((variant) =>
    requiresMembershipToPurchase(((variant as any).product ?? {}) as MembershipProduct),
  );

  if (blocked) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, ERROR_MESSAGE);
  }
}

addToCartWorkflow.hooks.validate(async ({ input, cart }, { container }) => {
  const items: Array<{ variant_id?: string }> = (input as any)?.items ?? [];
  const variantIds = items.map((item) => item.variant_id).filter((id): id is string => !!id);
  if (variantIds.length === 0) return;

  if (await isMembershipCustomer((cart as any)?.customer_id, container)) return;

  await assertNoMembersOnlyVariants(variantIds, container);
});

// 담기 이후 멤버십이 만료됐거나, 게이트 적용 전에 담아둔 카트를 결제 시점에 다시 막는다.
completeCartWorkflow.hooks.validate(async ({ cart }, { container }) => {
  const items: Array<{ variant_id?: string }> = (cart as any)?.items ?? [];
  const variantIds = items.map((item) => item.variant_id).filter((id): id is string => !!id);
  if (variantIds.length === 0) return;

  if (await isMembershipCustomer((cart as any)?.customer_id, container)) return;

  await assertNoMembersOnlyVariants(variantIds, container);
});
