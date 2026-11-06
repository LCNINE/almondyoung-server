'use client';

import { useVariantPriceSets } from '../../use-variant-price-sets';
import type { PricingVariant } from '../../pricing-detail-model';

interface Props {
  variants: PricingVariant[];
  versionId: string | null;
  masterId: string;
}

export function PriceSetTable({ variants, versionId, masterId }: Props) {
  const queries = useVariantPriceSets(variants, versionId, masterId);

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
            <th className="px-3 py-2 text-left">수량 할인</th>
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
                      {data.tieredPrices.length > 0 || (data.membershipTieredPrices ?? []).length > 0 ? (
                        <>
                          <span className="block">
                            일반{' '}
                            {data.tieredPrices.length > 0
                              ? data.tieredPrices.map((t) => `${t.minQuantity}개↑ ${t.price.toLocaleString()}원`).join(' / ')
                              : '할인 없음'}
                          </span>
                          {(data.membershipTieredPrices ?? []).length > 0 && (
                            <span className="block text-muted-foreground">
                              멤버십{' '}
                              {(data.membershipTieredPrices ?? [])
                                .map((t) => `${t.minQuantity}개↑ ${t.price.toLocaleString()}원`)
                                .join(' / ')}
                            </span>
                          )}
                        </>
                      ) : (
                        '-'
                      )}
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
