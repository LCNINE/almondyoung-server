'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { applyPercentDiscount, summarizeSaleRows, type TimeSaleRow } from '../time-sale-model';

const won = (value: number) => `${value.toLocaleString('ko-KR')}원`;

type Group = { productId: string; productTitle: string; rows: TimeSaleRow[] };

const groupByProduct = (rows: TimeSaleRow[]): Group[] => {
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const group = groups.get(row.productId);
    if (group) group.rows.push(row);
    else
      groups.set(row.productId, {
        productId: row.productId,
        productTitle: row.productTitle,
        rows: [row],
      });
  }
  return Array.from(groups.values());
};

/**
 * 세일가 입력.
 *
 * **상품 단위로 접는다.** 옵션이 많은 상품은 품목이 백 개를 넘는데(라이브에 111 개짜리가 있다),
 * 평평한 표로 펼치면 운영자가 그걸 하나씩 채워야 하는 화면으로 읽힌다. 실제로 쓰는 건 할인율
 * 일괄 적용이므로 그걸 상품 줄에 올리고, 품목별 조정은 펼쳤을 때만 보여준다.
 */
export function TimeSalePriceEditor({
  rows,
  errorByVariant,
  onChange,
}: {
  rows: TimeSaleRow[];
  errorByVariant: Map<string, string>;
  onChange: (rows: TimeSaleRow[]) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [percentByProduct, setPercentByProduct] = useState<Record<string, string>>({});

  const groups = groupByProduct(rows);

  const toggleExpanded = (productId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const applyToProduct = (group: Group) => {
    const percent = Number(percentByProduct[group.productId]);
    if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) return;

    const discounted = new Map(
      applyPercentDiscount(group.rows, percent).map((row) => [row.variantId, row])
    );
    onChange(rows.map((row) => discounted.get(row.variantId) ?? row));
  };

  const editRow = (
    variantId: string,
    field: 'generalSalePrice' | 'membershipSalePrice',
    raw: string
  ) => {
    const value = raw === '' ? null : Number(raw);
    onChange(rows.map((row) => (row.variantId === variantId ? { ...row, [field]: value } : row)));
  };

  return (
    <div className="space-y-2">
      {groups.map((group) => {
        const isOpen = expanded.has(group.productId);
        const summary = summarizeSaleRows(group.rows);
        const errorCount = group.rows.filter((row) => errorByVariant.has(row.variantId)).length;
        const percentLabel =
          summary.minPercent === null
            ? null
            : summary.minPercent === summary.maxPercent
              ? `${summary.minPercent}%`
              : `${summary.minPercent}~${summary.maxPercent}%`;
        const priceLabel =
          summary.minPrice === null || summary.maxPrice === null
            ? null
            : summary.minPrice === summary.maxPrice
              ? won(summary.minPrice)
              : `${won(summary.minPrice)}~${won(summary.maxPrice)}`;

        return (
          <div key={group.productId} className="rounded-md border">
            <div className="flex flex-wrap items-center gap-2 px-3 py-2">
              <button
                type="button"
                onClick={() => toggleExpanded(group.productId)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                {isOpen ? (
                  <ChevronDown className="text-muted-foreground h-4 w-4 shrink-0" />
                ) : (
                  <ChevronRight className="text-muted-foreground h-4 w-4 shrink-0" />
                )}
                <span className="truncate text-sm font-medium">{group.productTitle}</span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  품목 {summary.total}개
                </span>
                {percentLabel ? (
                  <span className="shrink-0 text-xs font-medium text-green-700">
                    {percentLabel} 할인 · {priceLabel}
                    {summary.filled < summary.total && (
                      <span className="text-muted-foreground ml-1 font-normal">
                        ({summary.total - summary.filled}개 미입력)
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="text-muted-foreground shrink-0 text-xs">세일가 미입력</span>
                )}
                {errorCount > 0 && (
                  <Badge variant="destructive" className="shrink-0">
                    {errorCount}개 확인 필요
                  </Badge>
                )}
              </button>

              <div className="flex shrink-0 items-center gap-1">
                <Input
                  type="number"
                  className="w-20 text-right"
                  placeholder="%"
                  value={percentByProduct[group.productId] ?? ''}
                  onChange={(event) =>
                    setPercentByProduct((prev) => ({
                      ...prev,
                      [group.productId]: event.target.value,
                    }))
                  }
                />
                <Button type="button" variant="outline" size="sm" onClick={() => applyToProduct(group)}>
                  적용
                </Button>
              </div>
            </div>

            {isOpen && (
              <div className="overflow-x-auto border-t">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-muted text-xs">
                    <tr>
                      <th className="px-3 py-2 text-left">품목</th>
                      <th className="px-3 py-2 text-right">정가</th>
                      <th className="px-3 py-2 text-right">일반 세일가</th>
                      <th className="px-3 py-2 text-right">멤버십가</th>
                      <th className="px-3 py-2 text-right">멤버십 세일가</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((row) => {
                      const error = errorByVariant.get(row.variantId);
                      return (
                        <tr key={row.variantId} className="border-t">
                          <td className="px-3 py-2">
                            <div className="text-xs">{row.variantTitle}</div>
                            {error && <div className="text-xs text-red-600">{error}</div>}
                          </td>
                          <td className="text-muted-foreground px-3 py-2 text-right tabular-nums whitespace-nowrap">
                            {won(row.basePrice)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Input
                              type="number"
                              className="ml-auto w-28 text-right"
                              value={row.generalSalePrice ?? ''}
                              onChange={(event) =>
                                editRow(row.variantId, 'generalSalePrice', event.target.value)
                              }
                            />
                          </td>
                          <td className="text-muted-foreground px-3 py-2 text-right tabular-nums whitespace-nowrap">
                            {row.membershipBasePrice === null
                              ? '—'
                              : won(row.membershipBasePrice)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {row.membershipBasePrice === null ? (
                              <span className="text-muted-foreground text-xs">해당 없음</span>
                            ) : (
                              <Input
                                type="number"
                                className="ml-auto w-28 text-right"
                                value={row.membershipSalePrice ?? ''}
                                onChange={(event) =>
                                  editRow(row.variantId, 'membershipSalePrice', event.target.value)
                                }
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
