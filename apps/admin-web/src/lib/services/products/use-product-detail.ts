'use client';

import { useSuspenseQuery } from '@tanstack/react-query';
import { productQueryKeys } from './query-keys';
import { products } from '@/lib/api/domains';
import type {
  MasterVersionDetailDto,
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
  seoTitle: string | null;
  seoDescription: string | null;
  seoKeywords: string[] | null;
  isWholesaleOnly: boolean | null;
  isMembershipOnly: boolean | null;
  createdAt: string;
  updatedAt: string;
  optionGroups: ProductOptionGroup[];
  images: ProductImage[];
  // version 모드에서만 채워짐. master 모드는 별도 variants 훅 사용.
  variantsInline: ProductVariantRow[] | null;
};

function fromMaster(master: ProductMasterDetail): ProductDetailView {
  return {
    source: 'master',
    masterId: master.id,
    versionId: null,
    version: null,
    status:
      master.status === 'active' || master.status === 'inactive' || master.status === 'draft'
        ? master.status
        : null,
    name: master.name,
    description: master.description,
    descriptionHtml: master.descriptionHtml,
    brand: master.brand,
    seoTitle: master.seoTitle,
    seoDescription: master.seoDescription,
    seoKeywords: master.seoKeywords,
    isWholesaleOnly: master.isWholesaleOnly,
    isMembershipOnly: master.isMembershipOnly,
    createdAt: master.createdAt,
    updatedAt: master.updatedAt,
    optionGroups: master.optionGroups,
    images: master.images,
    variantsInline: null,
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
    seoTitle: detail.seoTitle,
    seoDescription: detail.seoDescription,
    seoKeywords: detail.seoKeywords,
    isWholesaleOnly: detail.isWholesaleOnly,
    isMembershipOnly: detail.isMembershipOnly,
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
  };
}

export function useProductDetailSuspense(
  masterId: string,
  versionId: string | null,
): { data: ProductDetailView } {
  const { data } = useSuspenseQuery({
    queryKey: versionId
      ? productQueryKeys.versionDetail(masterId, versionId)
      : productQueryKeys.master(masterId),
    queryFn: async (): Promise<ProductDetailView> => {
      if (versionId) {
        return fromVersion(await products.versions.getById(masterId, versionId));
      }
      return fromMaster(
        (await products.masters.get(masterId)) as unknown as ProductMasterDetail,
      );
    },
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });

  return { data };
}
