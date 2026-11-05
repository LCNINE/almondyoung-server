'use client';

import { useQueries } from '@tanstack/react-query';
import { products } from '@/lib/api/domains';
import { productQueryKeys } from '@/lib/services/products/query-keys';
import type { PricingVariant } from './pricing-detail-model';

/** 옵션별 가격셋(정상가·멤버십가·구간가). 옵션별 가격 현황과 수량 할인 미리보기가 같은 캐시를 쓴다. */
export function useVariantPriceSets(variants: PricingVariant[], versionId: string | null, masterId: string) {
  return useQueries({
    queries: variants.map((v) => ({
      queryKey: versionId
        ? productQueryKeys.pricingVersionPriceSet(versionId, v.id)
        : productQueryKeys.pricingMasterPriceSet(masterId, v.id),
      queryFn: () =>
        versionId
          ? products.pricing.versions.getPriceSet(versionId, v.id)
          : products.pricing.masters.getPriceSet(masterId, v.id),
      enabled: versionId ? true : !!masterId,
      staleTime: 30 * 1000,
      retry: (count: number, error: unknown) => {
        const status =
          typeof error === 'object' && error !== null && 'response' in error
            ? (error as { response?: { status?: number } }).response?.status
            : undefined;
        if (status === 404) return false;
        return count < 2;
      },
    })),
  });
}
