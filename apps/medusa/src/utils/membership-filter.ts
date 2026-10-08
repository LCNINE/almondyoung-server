import type { AuthenticatedMedusaRequest } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, MedusaError } from '@medusajs/framework/utils';

export type ProductMetadata = {
  hideMembershipPriceForNonMembers?: boolean | string;
  isVisibleToMembersOnly?: boolean | string;
  isOverseas?: boolean | string;
  /** core purchaseConstraint 스냅샷 (pim-to-medusa.transformer 가 채움) */
  pimPurchaseConstraint?: { requiresMembership?: boolean | string; lifetimeQuantityLimit?: number | null } | null;
  /** @deprecated use hideMembershipPriceForNonMembers */
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
  /** 고객이 속한 customer group id 목록. pricing context 의 price list rule 매칭에 쓴다. */
  groupIds: string[];
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
  return (
    product.metadata?.hideMembershipPriceForNonMembers === true ||
    product.metadata?.hideMembershipPriceForNonMembers === 'true' ||
    product.metadata?.isMembershipOnly === true ||
    product.metadata?.isMembershipOnly === 'true'
  );
};

export const isVisibleToMembersOnlyProduct = (product: MembershipProduct): boolean => {
  return product.metadata?.isVisibleToMembersOnly === true || product.metadata?.isVisibleToMembersOnly === 'true';
};

export const isOverseasProduct = (product: MembershipProduct): boolean => {
  return product.metadata?.isOverseas === true || product.metadata?.isOverseas === 'true';
};

/**
 * 멤버십 회원만 구매 가능한 상품인지 판정한다.
 * isVisibleToMembersOnly(노출 차단)와 달리 비회원에게도 보이되 구매만 막는다.
 * metadata 없는 응답은 게이트가 안 걸린다(fail-open) — 조회 fields 에 metadata 필수.
 */
export const requiresMembershipToPurchase = (product: MembershipProduct): boolean => {
  const constraint = product.metadata?.pimPurchaseConstraint;
  if (!isRecord(constraint)) {
    return false;
  }

  return constraint.requiresMembership === true || constraint.requiresMembership === 'true';
};

/** 비회원 응답에서 재입고/출시예정 안내만 지운다. 재고와 판매 플래그는 건드리지 않는다. */
const gateVariantForNonMember = (variant: ProductVariant): ProductVariant => {
  if (!isRecord(variant.metadata)) {
    return variant;
  }

  const metadata = { ...variant.metadata };
  delete metadata.inboundDate;
  delete metadata.inboundApproximate;
  delete metadata.comingSoon;
  delete metadata.comingSoonDate;

  return { ...variant, metadata };
};

/**
 * 멤버십 전용 구매 상품의 비회원 응답에서 회원 전용 안내만 걷어낸다.
 * 노출·재고는 그대로 두고, 구매 차단은 장바구니 훅이 맡는다
 * (`handle-validate-cart-items-inventory.ts`, `complete-cart.ts`).
 */
export const applyPurchaseGateForNonMember = (product: MembershipProduct, isMember: boolean): MembershipProduct => {
  if (isMember || !requiresMembershipToPurchase(product)) {
    return product;
  }

  const variants = Array.isArray(product.variants) ? product.variants.map(gateVariantForNonMember) : product.variants;

  return {
    ...product,
    variants,
  };
};

export const filterProductsForMemberState = (products: MembershipProduct[], isMember: boolean): MembershipProduct[] => {
  return products.filter((product) => product.metadata?.timeSaleDisplay !== false && (isMember || !isVisibleToMembersOnlyProduct(product)));
};

export const assertProductVisibleToCustomer = (product: MembershipProduct, isMember: boolean): void => {
  if (!isMember && isVisibleToMembersOnlyProduct(product)) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, '멤버십 회원 전용 상품입니다.');
  }
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
 * 비회원이면 멤버십가 숨김 상품(metadata.hideMembershipPriceForNonMembers=true)의
 * variant.metadata 멤버십가 숫자를 제거하고, 회원은 그대로 둔다.
 */
export const applyMembershipPriceVisibility = (product: MembershipProduct, isMember: boolean): MembershipProduct => {
  return isMember ? product : sanitizeProductForNonMember(product);
};

// 가격표(price list)가 아닌 기본 가격인지.
const isBasePrice = (price: unknown) => isRecord(price) && 'price_list_id' in price && price.price_list_id === null;

// 객체 안쪽까지 키 이름에 membership 이 들어간 항목을 모두 제거한다.
const stripMembershipKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripMembershipKeys);
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/membership/i.test(key))
      .map(([key, entry]) => [key, stripMembershipKeys(entry)]),
  );
};

// 공개 제한 variant 에서 세일·멤버십 가격 필드를 걷어내고 기본 가격만 남긴다.
const hidePrivateSaleVariant = (variant: ProductVariant): ProductVariant => {
  const next: ProductVariant = { ...variant };
  delete next.membership_price;
  delete next.price_list;
  delete next.price_lists;

  if (Array.isArray(variant.prices)) next.prices = variant.prices.filter(isBasePrice);
  if (isRecord(variant.metadata)) next.metadata = sanitizeMembershipPriceMetadata(variant.metadata);
  if (isRecord(variant.calculated_price)) next.calculated_price = stripMembershipKeys(variant.calculated_price);

  return next;
};

/**
 * 가격 공개 제한 세일 상품이면 비회원 응답에서
 * 세일가·멤버십가 흔적을 지우고 metadata.timeSalePriceHidden 을 심는다.
 * 회원이거나 제한 대상이 아니면 그대로 돌려준다.
 */
export const hideTimeSalePrices = (
  product: MembershipProduct,
  isMember: boolean,
  privateIds: Set<string>,
): MembershipProduct => {
  if (isMember || !product.id || !privateIds.has(product.id)) return product;

  const metadata = isRecord(product.metadata) ? sanitizeMembershipPriceMetadata(product.metadata) : {};

  return {
    ...product,
    metadata: { ...metadata, timeSalePriceHidden: true },
    variants: Array.isArray(product.variants) ? product.variants.map(hidePrivateSaleVariant) : product.variants,
  };
};

/**
 * /store/products, /store/products/:id, /store/products-sorted 등의 응답 payload에
 * 멤버십가 표시 정책과 멤버십 회원 전용 노출 정책을 적용한다.
 * 표준 /store/products response filtering은 count mismatch가 있을 수 있다.
 */
export const transformStoreProductsPayload = (
  payload: unknown,
  isMember: boolean,
  privateIds = new Set<string>(),
): unknown => {
  if (!isRecord(payload)) {
    return payload;
  }

  let next: Record<string, unknown> | null = null;

  if (Array.isArray(payload.products)) {
    next = { ...payload };
    const products = payload.products.filter((item): item is MembershipProduct => isRecord(item));
    next.products = filterProductsForMemberState(products, isMember)
      .map((item) => applyMembershipPriceVisibility(item, isMember))
      .map((item) => applyPurchaseGateForNonMember(item, isMember))
      .map((item) => hideTimeSalePrices(item, isMember, privateIds));
  }

  if (isRecord(payload.product)) {
    next = next ?? { ...payload };
    next.product = hideTimeSalePrices(
      applyPurchaseGateForNonMember(
        applyMembershipPriceVisibility(payload.product as MembershipProduct, isMember),
        isMember,
      ),
      isMember,
      privateIds,
    );
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
      groupIds: [],
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
        groupIds: [],
      };
    }

    const firstCustomer = (customers as unknown[])[0];
    if (!isRecord(firstCustomer) || !Array.isArray(firstCustomer.groups)) {
      return {
        customerId,
        isMember: false,
        groupIds: [],
      };
    }

    const groupIds = firstCustomer.groups
      .map((group) => (isRecord(group) && typeof group.id === 'string' ? group.id : null))
      .filter((id): id is string => id !== null);

    return {
      customerId,
      isMember: groupIds.includes(membershipGroupId),
      groupIds,
    };
  } catch (error) {
    console.error('[membership-filter] 멤버십 확인 실패:', error);

    return {
      customerId,
      isMember: false,
      groupIds: [],
    };
  }
};
