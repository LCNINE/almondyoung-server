import { addToCartWorkflow, createCartWorkflow } from '@medusajs/medusa/core-flows';
import { validateInventoryForItems } from '../../../utils/validate-inventory';
import { AddToCartWorkflowInputDTO, CreateCartWorkflowInputDTO } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, MedusaError, Modules } from '@medusajs/framework/utils';
import type { IProductModuleService, ICartModuleService, ICustomerModuleService } from '@medusajs/framework/types';
import { isRecord, isVisibleToMembersOnlyProduct, type MembershipProduct } from '../../../utils/membership-filter';

type CartInput = CreateCartWorkflowInputDTO | AddToCartWorkflowInputDTO;

type ValidItem = {
  variant_id: string;
  quantity: number;
}[];

// 웰컴 멤버십 설정
const MEMBERSHIP_SERVICE_URL = process.env.MEMBERSHIP_SERVICE_URL || 'http://localhost:3040';
const WELCOME_MEMBERSHIP_TAG = 'welcome-membership';

const resolveCartCustomerId = async (input: CartInput, container: any): Promise<string | null> => {
  if ('cart_id' in input && input.cart_id) {
    const cartModule: ICartModuleService = container.resolve(Modules.CART);
    const cart = await cartModule.retrieveCart(input.cart_id, {
      select: ['customer_id'],
    });
    return cart?.customer_id ?? null;
  }

  const inputCustomerId = (input as { customer_id?: string | null }).customer_id;
  return inputCustomerId ?? null;
};

const resolveCustomerIsMembershipMember = async (container: any, customerId: string | null): Promise<boolean> => {
  const membershipGroupId = process.env.MEDUSA_MEMBERSHIP_GROUP_ID?.trim();
  if (!customerId || !membershipGroupId) {
    return false;
  }

  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY);
    const graphResult: unknown = await query.graph({
      entity: 'customer',
      fields: ['id', 'groups.id'],
      filters: { id: customerId },
    });

    const customers = isRecord(graphResult) ? graphResult.data : undefined;
    if (!Array.isArray(customers)) {
      return false;
    }

    const firstCustomer = customers[0];
    if (!isRecord(firstCustomer) || !Array.isArray(firstCustomer.groups)) {
      return false;
    }

    return firstCustomer.groups.some((group) => isRecord(group) && group.id === membershipGroupId);
  } catch (error) {
    console.error('[MembersOnlyVisibility] customer group lookup failed:', error);
    return false;
  }
};

const validateMembersOnlyProductVisibility = async (input: CartInput, container: any, variants: any[]) => {
  const hasMembersOnlyProduct = variants.some((variant) =>
    isVisibleToMembersOnlyProduct((variant.product ?? {}) as MembershipProduct),
  );

  if (!hasMembersOnlyProduct) {
    return;
  }

  const customerId = await resolveCartCustomerId(input, container);
  const isMember = await resolveCustomerIsMembershipMember(container, customerId);

  if (!isMember) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, '멤버십 회원 전용 상품입니다.');
  }
};

/**
 * 웰컴 멤버십 상품 구매 자격 검증
 */
const validateWelcomeMembership = async (input: AddToCartWorkflowInputDTO, container: any, variants: any[]) => {
  const hasWelcomeMembershipItem = variants.some((variant) => {
    const tags: Array<{ value: string }> = variant.product?.tags ?? [];
    return tags.some((tag) => tag.value === WELCOME_MEMBERSHIP_TAG);
  });

  if (!hasWelcomeMembershipItem) return;

  // 웰컴 멤버십 상품이 포함되어 있음 → 고객 자격 확인
  const cartModule: ICartModuleService = container.resolve(Modules.CART);
  const cart = await cartModule.retrieveCart(input.cart_id, {
    select: ['customer_id'],
  });

  if (!cart?.customer_id) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, '웰컴 멤버십 상품은 로그인 후 구매하실 수 있습니다.');
  }

  // Medusa customer → almond user_id 매핑
  const customerModule: ICustomerModuleService = container.resolve(Modules.CUSTOMER);
  const customer = await customerModule.retrieveCustomer(cart.customer_id, {
    select: ['metadata'],
  });
  const userId = (customer?.metadata as Record<string, unknown> | null)?.almond_user_id as string | undefined;

  if (!userId) {
    // almond_user_id 없으면 fail-open (연동 안 된 계정)
    console.warn('[WelcomeMembership] customer has no almond_user_id, failing open');
    return;
  }

  // 멤버십 서비스에 자격 확인 요청
  let eligible = true;
  let reason: string | undefined;
  try {
    const response = await fetch(`${MEMBERSHIP_SERVICE_URL}/welcome-membership/eligibility/${userId}`, {
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = (await response.json()) as { eligible: boolean; reason?: string };
      eligible = data.eligible;
      reason = data.reason;
    } else {
      console.warn(`[WelcomeMembership] eligibility check failed (${response.status}), failing open`);
    }
  } catch (err) {
    console.warn(`[WelcomeMembership] eligibility check error, failing open:`, err);
  }

  if (!eligible) {
    if (reason === 'not_a_member') {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, '웰컴 멤버십 상품은 멤버십 회원만 구매하실 수 있습니다.');
    }
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, '이미 웰컴 멤버십 상품 구매 이력이 있습니다.');
  }
};

/**
 * 장바구니 아이템 검증 통합 핸들러
 * - 재고 검증
 * - 웰컴 멤버십 자격 검증 (addToCart만)
 */
const handleValidateCartItemsInventory = async ({ input }: { input: CartInput }, { container }) => {
  if (!input.items?.length) return;

  const validItems = input.items as ValidItem;
  if (!validItems.length) return;

  const productModuleService: IProductModuleService = container.resolve(Modules.PRODUCT);

  const variants = await productModuleService.listProductVariants(
    {
      id: validItems.map((item) => item.variant_id),
    },
    { relations: ['product', 'product.tags'] },
  );

  // 1. 재고 검증
  await validateInventoryForItems({ items: validItems, variants }, container);

  // 2. 웰컴 멤버십 자격 검증 (addToCart인 경우만 - cart_id가 있음)
  if ('cart_id' in input && input.cart_id) {
    await validateWelcomeMembership(input, container, variants);
  }

  // 3. 멤버십 회원 전용 노출 상품 직접 담기 방어
  await validateMembersOnlyProductVisibility(input, container, variants);
};

// 장바구니 생성 시 재고 검증
createCartWorkflow.hooks.validate(handleValidateCartItemsInventory);

// 장바구니에 상품 추가 시 재고 검증 + 웰컴 멤버십 검증
addToCartWorkflow.hooks.validate(handleValidateCartItemsInventory);
