import type { AuthenticatedMedusaRequest } from '@medusajs/framework/http';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';

export type ProductMetadata = {
  isMembershipOnly?: boolean | string;
  [key: string]: unknown;
};

export type ProductVariant = {
  metadata?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export type MembershipProduct = {
  id?: string;
  metadata?: ProductMetadata | null;
  variants?: ProductVariant[] | null;
  [key: string]: unknown;
};

export type MemberState = {
  customerId?: string;
  isMember: boolean;
};

export const MEMBERSHIP_PRICE_HIDDEN_PRODUCT_IDS = new Set([
  'prod_019c0c0d9b01722ab8ff1ceda3f3501f',
  'prod_019c0c0d9b2776fc840b2e730adc6447',
  'prod_019c0c0d9b2e75ca823ec40282e58b09',
  'prod_019c0c0d9b2676c28c79ad749950e351',
  'prod_019c0c0d9b2676c28c7999efcab89e60',
]);

export const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

export const isMembershipOnlyProduct = (product: MembershipProduct): boolean => {
  return product.metadata?.isMembershipOnly === true || product.metadata?.isMembershipOnly === 'true';
};

const sanitizeMembershipPriceMetadata = (metadata: Record<string, unknown>) => {
  const next = { ...metadata };
  delete next.membershipPrice;
  delete next.membership_price;
  delete next.membershipprice;
  return next;
};

export const sanitizeProductForNonMember = (product: MembershipProduct): MembershipProduct => {
  const productId = product.id;

  if (!productId || !MEMBERSHIP_PRICE_HIDDEN_PRODUCT_IDS.has(productId)) {
    return product;
  }

  const variants = Array.isArray(product.variants)
    ? product.variants.map((variant) => {
        if (!variant.metadata || !isRecord(variant.metadata)) {
          return variant;
        }

        return {
          ...variant,
          metadata: sanitizeMembershipPriceMetadata(variant.metadata),
        };
      })
    : product.variants;

  return {
    ...product,
    variants,
  };
};

export const resolveMemberState = async (req: AuthenticatedMedusaRequest): Promise<MemberState> => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const membershipGroupId = process.env.MEDUSA_MEMBERSHIP_GROUP_ID?.trim();
  const customerId = req.auth_context?.actor_id;

  if (!customerId || !membershipGroupId) {
    return {
      customerId,
      isMember: false,
    };
  }

  try {
    const graphResult: unknown = await query.graph({
      entity: 'customer',
      fields: ['id', 'groups.id'],
      filters: { id: customerId },
    });

    const customers = isRecord(graphResult) ? graphResult.data : undefined;

    if (!Array.isArray(customers)) {
      return {
        customerId,
        isMember: false,
      };
    }

    const firstCustomer = (customers as unknown[])[0];
    if (!isRecord(firstCustomer) || !Array.isArray(firstCustomer.groups)) {
      return {
        customerId,
        isMember: false,
      };
    }

    const isMember = firstCustomer.groups.some((group) => {
      return isRecord(group) && group.id === membershipGroupId;
    });

    return {
      customerId,
      isMember,
    };
  } catch (error) {
    console.error('[membership-filter] 멤버십 확인 실패:', error);

    return {
      customerId,
      isMember: false,
    };
  }
};
