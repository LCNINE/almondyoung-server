'use client';

import { useQueries } from '@tanstack/react-query';
import { products } from '@/lib/api/domains';
import { productQueryKeys } from '@/lib/services/products/query-keys';
import type { PricingVariant } from '../../pricing-detail-model';

interface Props {
  variants: PricingVariant[];
  versionId: string | null;
  masterId: string;
}

export function PriceSetTable({ variants, versionId, masterId }: Props) {
  const usesVersionPricing = Boolean(versionId);
  const queries = useQueries({
    queries: variants.map((v) => ({
      queryKey: usesVersionPricing && versionId
        ? productQueryKeys.pricingVersionPriceSet(versionId, v.id)
        : productQueryKeys.pricingMasterPriceSet(masterId, v.id),
      queryFn: () =>
        usesVersionPricing && versionId
          ? products.pricing.versions.getPriceSet(versionId, v.id)
          : products.pricing.masters.getPriceSet(masterId, v.id),
      enabled: usesVersionPricing ? !!versionId : !!masterId,
      staleTime: 30 * 1000,
      retry: (count: number, error: any) => {
        if (error?.response?.status === 404) return false;
        return count < 2;
      },
    })),
  });

  if (variants.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">옵션이 없습니다.</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th className="px-3 py-2 text-left">옵션</th>
            <th className="px-3 py-2 text-right">정상가</th>
            <th className="px-3 py-2 text-right">멤버십가</th>
            <th className="px-3 py-2 text-left">수량별</th>
          </tr>
        </thead>
        <tbody>
          {variants.map((v, i) => {
            const q = queries[i];
            const data = q.data;
            return (
              <tr key={v.id} className="border-b">
                <td className="px-3 py-2">{v.name}</td>
                {q.isLoading ? (
                  <td className="px-3 py-2 text-right text-muted-foreground" colSpan={3}>
                    로딩 중...
                  </td>
                ) : q.isError ? (
                  <td className="px-3 py-2 text-right text-muted-foreground" colSpan={3}>
                    -
                  </td>
                ) : data ? (
                  <>
                    <td className="px-3 py-2 text-right">{data.basePrice.toLocaleString()}원</td>
                    <td className="px-3 py-2 text-right">{data.membershipPrice.toLocaleString()}원</td>
                    <td className="px-3 py-2 text-xs">
                      {data.tieredPrices.length > 0
                        ? data.tieredPrices
                            .map((t) => `${t.minQuantity}개↑ ${t.price.toLocaleString()}원`)
                            .join(' / ')
                        : '-'}
                    </td>
                  </>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
