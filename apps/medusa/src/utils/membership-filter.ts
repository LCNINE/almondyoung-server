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

export const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

/**
 * 비멤버에게 멤버십가 숫자를 숨길 상품인지 판정한다.
 *
 * isMembershipOnly는 "상품 자체를 숨김/구매 차단"이 아니라
 * "비멤버에게 멤버십가 숫자 대신 '멤버십 회원 공개'를 표시할지 여부"를 의미한다.
 * 상품 목록/상세 노출과 일반 판매가 구매는 제한하지 않는다.
 * (과거의 상품 ID 하드코딩 목록은 dev/live 데이터 보정 완료 후 제거 — metadata가 유일한 기준)
 */
export const isMembershipPriceHiddenProduct = (product: MembershipProduct): boolean => {
  return product.metadata?.isMembershipOnly === true || product.metadata?.isMembershipOnly === 'true';
};

const sanitizeMembershipPriceMetadata = (metadata: Record<string, unknown>) => {
  const next = { ...metadata };
  delete next.membershipPrice;
  delete next.membership_price;
  delete next.membershipprice;
  return next;
};

/**
 * 비멤버 응답에서 variant.metadata의 멤버십가 숫자만 제거한다.
 * 상품 자체(id, variants, 그 외 metadata)는 그대로 유지된다.
 */
export const sanitizeProductForNonMember = (product: MembershipProduct): MembershipProduct => {
  if (!isMembershipPriceHiddenProduct(product)) {
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

/**
 * 단일 상품에 멤버십가 표시 정책을 적용한다.
 * 비회원이면 멤버십가 숨김 상품(metadata.isMembershipOnly=true)의
 * variant.metadata 멤버십가 숫자를 제거하고, 회원은 그대로 둔다.
 */
export const applyMembershipPriceVisibility = (
  product: MembershipProduct,
  isMember: boolean,
): MembershipProduct => {
  return isMember ? product : sanitizeProductForNonMember(product);
};

/**
 * /store/products, /store/products/:id, /store/products-sorted 등의 응답 payload에
 * 멤버십가 표시 정책을 적용한다. `products` 배열과 `product` 단건 모두 처리하며,
 * 상품을 제거하거나 count를 바꾸지 않는다.
 */
export const transformStoreProductsPayload = (payload: unknown, isMember: boolean): unknown => {
  if (!isRecord(payload)) {
    return payload;
  }

  let next: Record<string, unknown> | null = null;

  if (Array.isArray(payload.products)) {
    next = { ...payload };
    next.products = payload.products.map((item) =>
      isRecord(item) ? applyMembershipPriceVisibility(item as MembershipProduct, isMember) : item,
    );
  }

  if (isRecord(payload.product)) {
    next = next ?? { ...payload };
    next.product = applyMembershipPriceVisibility(payload.product as MembershipProduct, isMember);
  }

  return next ?? payload;
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
