'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { MatchingDto } from '@/lib/types/dto/matching';
import {
  getMatchingStrategyDecisionLabel,
  getMatchingStrategyDecisionColor,
  getMatchingStrategyLabel,
  getPriorityLabel,
  getPriorityColor,
} from '@/lib/services/matching';

const columnHelper = createColumnHelper<MatchingDto>();

type RowActions = {
  onEdit: (row: MatchingDto) => void;
};

export const useVariantsMatchingTableColumns = (actions: RowActions) => {
  return useMemo(
    () => [
      columnHelper.accessor('master', {
        id: 'masterName',
        header: '상품명',
        cell: ({ getValue }) => (
          <span className="font-medium">{getValue()?.name ?? '—'}</span>
        ),
      }),
      columnHelper.accessor('variant', {
        id: 'variantName',
        header: 'Variant',
        cell: ({ getValue }) => {
          const v = getValue();
          if (!v)
            return <span className="text-xs text-muted-foreground">—</span>;
          return (
            <div className="space-y-0.5">
              <span className="text-sm">{v.name}</span>
              {v.optionKey && Object.keys(v.optionKey).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {Object.entries(v.optionKey).map(([k, val]) => (
                    <Badge
                      key={k}
                      variant="outline"
                      className="text-xs px-1 py-0"
                    >
                      {k}: {val}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          );
        },
      }),
      columnHelper.accessor('status', {
        header: '전략 결정',
        cell: ({ row }) => {
          const { status, strategy, matchedSkus, links } = row.original;
          return (
            <Badge
              className={`text-xs ${getMatchingStrategyDecisionColor({
                status,
                strategy,
                matchedSkus,
                links,
              })}`}
              variant="outline"
            >
              {getMatchingStrategyDecisionLabel({
                status,
                strategy,
                matchedSkus,
                links,
              })}
            </Badge>
          );
        },
      }),
      columnHelper.accessor('priority', {
        header: '우선순위',
        cell: ({ getValue }) => {
          const priority = getValue();
          return (
            <Badge
              className={`text-xs ${getPriorityColor(priority)}`}
              variant="outline"
            >
              {getPriorityLabel(priority)}
            </Badge>
          );
        },
      }),
      columnHelper.accessor('strategy', {
        header: '매칭 전략',
        cell: ({ getValue }) => (
          <span className="text-xs text-muted-foreground">
            {getMatchingStrategyLabel(getValue())}
          </span>
        ),
      }),
      columnHelper.accessor('matchedSkus', {
        header: 'SKU 매핑',
        cell: ({ getValue, row }) => {
          if (
            row.original.status === 'matched' &&
            row.original.strategy === 'void'
          ) {
            return (
              <span className="text-xs text-muted-foreground">
                SKU 연결 불필요
              </span>
            );
          }

          const skus = getValue();
          if (!skus?.length)
            return (
              <span className="text-xs text-muted-foreground/40">없음</span>
            );
          return (
            <span className="tabular-nums text-xs text-muted-foreground">
              {skus.length}개
            </span>
          );
        },
      }),
      columnHelper.accessor('orderCount', {
        header: '주문 수',
        cell: ({ getValue }) => (
          <span className="tabular-nums text-xs">{getValue() ?? 0}</span>
        ),
      }),
      columnHelper.accessor('updatedAt', {
        header: '최종 수정',
        cell: ({ getValue }) => (
          <span className="text-xs text-muted-foreground">
            {new Date(getValue()).toLocaleDateString('ko-KR')}
          </span>
        ),
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
              편집
            </Button>
          </div>
        ),
      }),
    ],
    [actions]
  );
};
