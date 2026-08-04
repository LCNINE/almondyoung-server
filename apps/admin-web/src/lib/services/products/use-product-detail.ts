'use client';

import { useSuspenseQuery } from '@tanstack/react-query';
import { productQueryKeys } from './query-keys';
import { products } from '@/lib/api/domains';
import type {
  MasterVersionDetailDto,
  ProductDetailCategory,
  ProductImage,
  ProductMasterDetail,
  ProductOptionGroup,
  ProductVariantRow,
} from './products-detail.types';

/**
 * 상세 페이지가 소비하는 정규화된 view.
 * - versionId 가 없으면 master 의 active 데이터.
 * - versionId 가 있으면 특정 버전의 detail.
 * - active 여부 판단은 source/status 로.
 */
export type ProductDetailView = {
  source: 'master' | 'version';
  masterId: string;
  versionId: string | null;
  version: number | null;
  status: 'active' | 'inactive' | 'draft' | null;
  name: string;
  description: string | null;
  descriptionHtml: string | null;
  brand: string | null;
  supplierId?: string | null;
  supplyPrice?: number | null;
  marketPrice?: number | null;
  seoTitle: string | null;
  seoDescription: string | null;
  seoKeywords: string[] | null;
  isWholesaleOnly: boolean | null;
  isOverseas: boolean | null;
  hideMembershipPriceForNonMembers: boolean | null;
  isVisibleToMembersOnly: boolean | null;
  /** 멤버십 전용 구매 여부 — 비회원·일반회원에게 품절로 표시. 노출 제한 아님. */
  requiresMembership: boolean | null;
  /** @deprecated use hideMembershipPriceForNonMembers */
  isMembershipOnly: boolean | null;
  fulfillmentKind: 'physical' | 'digital' | null;
  categories: ProductDetailCategory[];
  createdAt: string;
  updatedAt: string;
  optionGroups: ProductOptionGroup[];
  images: ProductImage[];
  // version 모드에서만 채워짐. master 모드는 별도 variants 훅 사용.
  variantsInline: ProductVariantRow[] | null;
  /** 일괄 세션이 이 버전을 잠갔으면 그 세션 id. master 모드는 항상 null. */
  bulkSessionId: string | null;
};

function fromMaster(master: ProductMasterDetail): ProductDetailView {
  return {
    source: 'master',
    masterId: master.id,
    versionId: null,
    version: null,
    status:
      master.status === 'active' ||
      master.status === 'inactive' ||
      master.status === 'draft'
        ? master.status
        : null,
    name: master.name,
    description: master.description,
    descriptionHtml: master.descriptionHtml,
    brand: master.brand,
    supplierId: master.supplierId ?? null,
    supplyPrice: master.supplyPrice ?? null,
    marketPrice: master.marketPrice ?? null,
    seoTitle: master.seoTitle,
    seoDescription: master.seoDescription,
    seoKeywords: master.seoKeywords,
    isWholesaleOnly: master.isWholesaleOnly,
    isOverseas: master.isOverseas ?? null,
    hideMembershipPriceForNonMembers:
      master.hideMembershipPriceForNonMembers ?? master.isMembershipOnly,
    isVisibleToMembersOnly: master.isVisibleToMembersOnly ?? false,
    requiresMembership: master.purchaseConstraint?.requiresMembership ?? false,
    isMembershipOnly:
      master.hideMembershipPriceForNonMembers ?? master.isMembershipOnly,
    fulfillmentKind: master.fulfillmentKind ?? null,
    categories: master.categories,
    createdAt: master.createdAt,
    updatedAt: master.updatedAt,
    optionGroups: master.optionGroups,
    images: master.images,
    variantsInline: null,
    bulkSessionId: null,
  };
}

function fromVersion(detail: MasterVersionDetailDto): ProductDetailView {
  return {
    source: 'version',
    masterId: detail.masterId,
    versionId: detail.id,
    version: detail.version,
    status: detail.status,
    name: detail.name,
    description: detail.description,
    descriptionHtml: detail.descriptionHtml,
    brand: detail.brand,
    supplierId: detail.supplierId ?? null,
    supplyPrice: detail.supplyPrice ?? null,
    marketPrice: detail.marketPrice ?? null,
    seoTitle: detail.seoTitle,
    seoDescription: detail.seoDescription,
    seoKeywords: detail.seoKeywords,
    isWholesaleOnly: detail.isWholesaleOnly,
    isOverseas: detail.isOverseas ?? null,
    hideMembershipPriceForNonMembers:
      detail.hideMembershipPriceForNonMembers ?? detail.isMembershipOnly,
    isVisibleToMembersOnly: detail.isVisibleToMembersOnly ?? false,
    requiresMembership: detail.purchaseConstraint?.requiresMembership ?? false,
    isMembershipOnly:
      detail.hideMembershipPriceForNonMembers ?? detail.isMembershipOnly,
    fulfillmentKind: detail.fulfillmentKind ?? null,
    categories: detail.categories,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
    optionGroups: detail.optionGroups,
    images: detail.images,
    variantsInline: detail.variants.map((v) => ({
      id: v.id,
      masterId: v.masterId ?? detail.masterId,
      variantName: v.variantName,
      imageId: v.imageId,
      displayOrder: v.displayOrder,
      status: v.status,
      isDefault: v.isDefault,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
      optionValues: v.optionValues,
      price: v.price,
    })),
    bulkSessionId: detail.bulkSessionId ?? null,
  };
}

export function useProductDetailSuspense(
  masterId: string,
  versionId: string | null
): { data: ProductDetailView } {
  const { data } = useSuspenseQuery({
    queryKey: versionId
      ? productQueryKeys.versionDetail(masterId, versionId)
      : productQueryKeys.master(masterId),
    queryFn: async (): Promise<ProductDetailView> => {
      if (versionId) {
        return fromVersion(
          await products.versions.getById(masterId, versionId)
        );
      }
      return fromMaster(
        (await products.masters.get(masterId)) as unknown as ProductMasterDetail
      );
    },
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });

  return { data };
}
