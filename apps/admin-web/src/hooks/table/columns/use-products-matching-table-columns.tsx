'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { MasterMatchingRowVM } from '@/lib/types/ui/matching';

const columnHelper = createColumnHelper<MasterMatchingRowVM>();

type RowActions = {
  onEdit: (row: MasterMatchingRowVM) => void;
};

const getStrategyDecisionRateVariant = (
  rate: number
): 'default' | 'secondary' | 'destructive' | 'outline' => {
  if (rate >= 100) return 'default';
  if (rate >= 50) return 'secondary';
  return 'destructive';
};

export const useProductsMatchingTableColumns = (actions: RowActions) => {
  return useMemo(
    () => [
      columnHelper.accessor('name', {
        header: '상품명',
        cell: ({ getValue }) => (
          <span className="font-medium">{getValue()}</span>
        ),
      }),
      columnHelper.accessor('brand', {
        header: '브랜드',
        cell: ({ getValue }) => (
          <span className="text-xs text-muted-foreground">
            {getValue() ?? '—'}
          </span>
        ),
      }),
      columnHelper.accessor('categories', {
        header: '카테고리',
        cell: ({ getValue }) => {
          const cats = getValue();
          if (!cats?.length)
            return <span className="text-xs text-muted-foreground/40">—</span>;
          return (
            <span className="text-xs text-muted-foreground">
              {cats.map((c) => c.name).join(', ')}
            </span>
          );
        },
      }),
      columnHelper.accessor('variants', {
        header: 'variant 수',
        cell: ({ getValue }) => (
          <span className="tabular-nums text-xs">
            {getValue()?.length ?? 0}
          </span>
        ),
      }),
      columnHelper.accessor('matchingStats', {
        id: 'strategyDecisionRate',
        header: '전략 결정률',
        cell: ({ getValue }) => {
          const stats = getValue();
          if (!stats)
            return <span className="text-xs text-muted-foreground/40">—</span>;
          const { matchedVariants, totalVariants, matchingRate } = stats;
          return (
            <div className="flex items-center gap-1.5">
              <Badge
                variant={getStrategyDecisionRateVariant(matchingRate)}
                className="text-xs tabular-nums"
              >
                {matchingRate}%
              </Badge>
              <span className="text-xs text-muted-foreground">
                ({matchedVariants}/{totalVariants})
              </span>
            </div>
          );
        },
      }),
      columnHelper.accessor('matchingStats', {
        id: 'pendingCount',
        header: '전략 미결정',
        cell: ({ getValue }) => {
          const stats = getValue();
          if (!stats)
            return <span className="text-xs text-muted-foreground/40">—</span>;
          return (
            <span
              className={`text-xs tabular-nums ${stats.pendingVariants > 0 ? 'text-orange-600 font-medium' : 'text-muted-foreground'}`}
            >
              {stats.pendingVariants}
            </span>
          );
        },
      }),
      columnHelper.accessor('matchingStats', {
        id: 'legacyAuditCount',
        header: '감사 대상',
        cell: ({ getValue }) => {
          const stats = getValue();
          if (!stats)
            return <span className="text-xs text-muted-foreground/40">—</span>;
          return (
            <span className="text-xs tabular-nums text-muted-foreground">
              {stats.ignoredVariants}
            </span>
          );
        },
      }),
      columnHelper.display({
        id: 'actions',
        header: '액션',
        cell: ({ row }) => (
          <div onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => actions.onEdit(row.original)}
            >
              전략 편집
            </Button>
          </div>
        ),
      }),
    ],
    [actions]
  );
};
