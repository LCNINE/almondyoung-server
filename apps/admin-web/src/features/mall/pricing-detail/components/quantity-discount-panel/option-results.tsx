'use client';

import { buildTierPrices, type QuantityDiscountTier } from '@/lib/pricing/quantity-discount';

export interface OptionResultRow {
  variantId: string;
  name: string;
  basePrice: number;
  membershipPrice: number;
  /** «기본», «예외 2» 처럼 이 옵션이 쓰는 표. */
  source: string;
  /** 그 옵션이 실제로 쓰는 구간(최소 수량 순). 비었으면 할인 없음. */
  tiers: QuantityDiscountTier[];
  violating: boolean;
}

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

/** 옵션마다 실제로 쓰는 표와 결과 가격. 옵션마다 구간 수가 달라 열을 맞추지 않고 한 칸에 이어 적는다. */
export function OptionResults({ rows }: { rows: OptionResultRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th className="px-3 py-2 text-left">옵션</th>
            <th className="px-3 py-2 text-left">적용 표</th>
            <th className="px-3 py-2 text-left">구간별 개당 가격 (일반 · 멤버십)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const prices = buildTierPrices({ basePrice: row.basePrice, membershipPrice: row.membershipPrice, tiers: row.tiers });
            return (
              <tr
                key={row.variantId}
                data-testid={`option-result-${row.variantId}`}
                className={`border-b align-top ${row.violating ? 'bg-destructive/10' : ''}`}
              >
                <td className="px-3 py-2">{row.name}</td>
                <td className="px-3 py-2 text-muted-foreground">{row.source}</td>
                <td className="px-3 py-2 tabular-nums">
                  {row.tiers.length === 0 ? (
                    <span className="text-muted-foreground">할인 없음</span>
                  ) : (
                    <ul className="flex flex-col gap-0.5">
                      {row.tiers.map((t, i) => (
                        <li key={i}>
                          {Number.isFinite(t.minQuantity) ? `${t.minQuantity}개 이상` : '-'} ·{' '}
                          {t.regularRateBp === 0 ? '할인 없음' : fmt(prices.regular[i]?.price)} ·{' '}
                          {t.membershipRateBp === 0 ? '할인 없음' : fmt(prices.membership[i]?.price)}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function fmt(price: number | undefined): string {
  return price !== undefined && Number.isFinite(price) ? won(price) : '-';
}
