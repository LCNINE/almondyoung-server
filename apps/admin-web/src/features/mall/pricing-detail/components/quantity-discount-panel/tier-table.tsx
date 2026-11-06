'use client';

import { useMemo } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  MAX_QUANTITY_DISCOUNT_TIERS,
  buildTierPrices,
  tiersFromRows,
  type TierForm,
} from '@/lib/pricing/quantity-discount';

export interface TierPreviewBasis {
  name: string;
  basePrice: number;
  membershipPrice: number;
}

interface TierTableProps {
  rows: TierForm[];
  onChange: (rows: TierForm[]) => void;
  editable: boolean;
  /** 결과 가격을 보여 줄 옵션. 이 표를 쓰는 옵션이 없으면 null. */
  preview: TierPreviewBasis | null;
  /** 결과 가격 제목에 옵션 이름을 붙일지(옵션이 둘 이상일 때). */
  namePreview: boolean;
  /** 최소 수량 순서(0부터)의 위반 문장. */
  messagesAt: (sortedIndex: number) => string[];
  maxQuantity: number | null;
  /** 칸 이름 앞에 붙는 말(예외 카드에서 «예외 1 · »). 테스트·스크린리더가 같은 이름을 쓴다. */
  labelPrefix?: string;
  testIdPrefix?: string;
}

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

const emptyTier = (): TierForm => ({ minQuantity: '', regularPercent: '', membershipPercent: '' });

function sortedRowIndexes(tiers: TierForm[]): number[] {
  const key = (t: TierForm) => {
    const trimmed = t.minQuantity.trim();
    return trimmed === '' ? Number.NaN : Number(trimmed);
  };
  return tiers
    .map((t, index) => ({ index, key: key(t) }))
    .sort((a, b) => {
      if (Number.isNaN(a.key) || Number.isNaN(b.key)) {
        return Number.isNaN(a.key) === Number.isNaN(b.key) ? a.index - b.index : Number.isNaN(a.key) ? 1 : -1;
      }
      return a.key - b.key || a.index - b.index;
    })
    .map((x) => x.index);
}

/**
 * 구간 표 하나(기본 표와 예외 카드가 같이 쓴다). 행은 입력 순서 그대로 두고(입력 중 자리가 바뀌지 않게)
 * 각 행이 최소 수량 순서에서 몇 번째인지로 결과·위반을 붙이며, 최소 수량 칸을 떠날 때 행을 정렬한다.
 */
export function TierTable({
  rows,
  onChange,
  editable,
  preview,
  namePreview,
  messagesAt,
  maxQuantity,
  labelPrefix = '',
  testIdPrefix = '',
}: TierTableProps) {
  const sortedTiers = useMemo(() => tiersFromRows(rows), [rows]);
  const sortedPositionOf = useMemo(() => {
    const position = new Map<number, number>();
    sortedRowIndexes(rows).forEach((rowIndex, sortedIndex) => position.set(rowIndex, sortedIndex));
    return position;
  }, [rows]);
  const prices = useMemo(
    () =>
      preview
        ? buildTierPrices({ basePrice: preview.basePrice, membershipPrice: preview.membershipPrice, tiers: sortedTiers })
        : null,
    [preview, sortedTiers],
  );

  const updateRow = (index: number, patch: Partial<TierForm>) =>
    onChange(rows.map((t, i) => (i === index ? { ...t, ...patch } : t)));

  return (
    <div className="overflow-x-auto">
      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">구간이 없습니다.</p>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="px-3 py-2 text-left">최소 수량</th>
              <th className="px-3 py-2 text-left">일반 할인</th>
              <th className="px-3 py-2 text-left">멤버십 할인</th>
              <th className="px-3 py-2 text-right">결과 가격{preview && namePreview ? ` (${preview.name})` : ''}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((tier, index) => {
              const position = sortedPositionOf.get(index) ?? index;
              const regular = prices?.regular[position];
              const membership = prices?.membership[position];
              const sortedTier = sortedTiers[position];
              const label = `${labelPrefix}${index + 1}구간`;
              const overMax =
                maxQuantity !== null && sortedTier !== undefined && sortedTier.minQuantity > maxQuantity;
              return (
                <tr key={index} data-testid={`${testIdPrefix}tier-row-${position}`} className="border-b align-top">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1 text-sm">
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={2}
                        aria-label={`${label} 최소 수량`}
                        className="h-8 w-20"
                        value={tier.minQuantity}
                        onChange={(e) => updateRow(index, { minQuantity: e.target.value })}
                        onBlur={() => onChange(sortedRowIndexes(rows).map((i) => rows[i]))}
                        disabled={!editable}
                      />
                      개 이상
                    </div>
                    {overMax && (
                      <p className="mt-1 text-xs text-amber-700">
                        최대구매수량({maxQuantity}개)보다 커서 적용되지 않는 구간입니다.
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1 text-sm">
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={99}
                        placeholder="0"
                        aria-label={`${label} 일반 할인`}
                        className="h-8 w-20"
                        value={tier.regularPercent}
                        onChange={(e) => updateRow(index, { regularPercent: e.target.value })}
                        disabled={!editable}
                      />
                      %
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1 text-sm">
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={99}
                        placeholder="0"
                        aria-label={`${label} 멤버십 할인`}
                        className="h-8 w-20"
                        value={tier.membershipPercent}
                        onChange={(e) => updateRow(index, { membershipPercent: e.target.value })}
                        disabled={!editable}
                      />
                      %
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right text-sm tabular-nums">
                    {regular && membership && Number.isFinite(regular.price) && Number.isFinite(membership.price) ? (
                      <div className="flex flex-col items-end">
                        <span>
                          일반 <span>{sortedTier?.regularRateBp === 0 ? '할인 없음' : won(regular.price)}</span>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          멤버십 <span>{sortedTier?.membershipRateBp === 0 ? '할인 없음' : won(membership.price)}</span>
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                    {messagesAt(position).map((m) => (
                      <p key={m} className="mt-1 text-left text-xs text-destructive">
                        {m}
                      </p>
                    ))}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {editable && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`${label} 삭제`}
                        onClick={() => onChange(rows.filter((_, i) => i !== index))}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {editable && (
        <div className="mt-2 px-3">
          <Button
            size="sm"
            variant="ghost"
            disabled={rows.length >= MAX_QUANTITY_DISCOUNT_TIERS}
            onClick={() => onChange([...rows, emptyTier()])}
          >
            <Plus className="mr-1 h-3 w-3" />
            {labelPrefix ? `${labelPrefix}구간 추가` : '구간 추가'}
          </Button>
          <span className="text-xs text-muted-foreground">최대 {MAX_QUANTITY_DISCOUNT_TIERS}개</span>
        </div>
      )}
    </div>
  );
}
