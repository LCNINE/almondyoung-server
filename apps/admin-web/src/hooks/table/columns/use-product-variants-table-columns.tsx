'use client';

import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import type {
  ProductOptionGroup,
  ProductVariantRow,
} from '@/lib/services/products/products-detail.types';
import type {
  StockPolicyDto,
  VariantMatchingBatchItemDto,
} from '@/lib/types/dto/matching';
import {
  getMatchingStrategyDecisionLabel,
  getProductSellableReasonBadgeVariant,
  getProductSellableReasonLabel,
  normalizeStockPolicy,
} from '@/lib/services/matching';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Pencil } from 'lucide-react';

const STATUS_LABELS: Record<string, string> = {
  active: '활성',
  inactive: '판매중단',
  draft: '임시저장',
  archived: '보관',
};

export type ProductVariantTableRow = ProductVariantRow & {
  matchingInfo?: VariantMatchingBatchItemDto;
};

const columnHelper = createColumnHelper<ProductVariantTableRow>();

type RowActions = {
  onEdit: (row: ProductVariantTableRow) => void;
};

type MatchingActions = {
  isLoading?: boolean;
  pendingVariantId?: string | null;
  onPolicyChange: (row: ProductVariantTableRow, policy: StockPolicyDto) => void;
  onEditMatching: (row: ProductVariantTableRow) => void;
};

export function useProductVariantsTableColumns(
  optionGroups: ProductOptionGroup[],
  actions?: RowActions,
  matchingActions?: MatchingActions
) {
  return useMemo(() => {
    // valueId → displayName. master 의 모든 그룹/값을 평탄화.
    const valueLabelById = new Map<string, string>();
    for (const group of optionGroups) {
      for (const v of group.values) {
        valueLabelById.set(v.id, v.displayName);
      }
    }

    const sortedGroups = [...optionGroups].sort(
      (a, b) => a.sortOrder - b.sortOrder
    );

    const optionColumns: ColumnDef<ProductVariantTableRow, unknown>[] =
      sortedGroups.map((group) =>
        columnHelper.display({
          id: `optionGroup:${group.id}`,
          header: group.displayName,
          cell: ({ row }) => {
            const matches = row.original.optionValues.filter(
              (ov) => ov.optionGroupId === group.id
            );
            if (matches.length === 0) return '-';
            if (matches.length > 1) {
              console.warn(
                `[ProductVariants] variant ${row.original.id} has ${matches.length} values for option group ${group.id}; expected 1`
              );
            }
            const first = matches[0];
            const label = valueLabelById.get(first.id);
            if (label === undefined) {
              console.warn(
                `[ProductVariants] option value ${first.id} on variant ${row.original.id} not found in master option groups`
              );
              return '-';
            }
            return label;
          },
        })
      );

    const renderPolicyCheckbox = (
      row: ProductVariantTableRow,
      checked: boolean,
      ariaLabel: string,
      nextPolicy: (policy: StockPolicyDto, checked: boolean) => StockPolicyDto
    ) => {
      const info = row.matchingInfo;
      const pending = matchingActions?.pendingVariantId === row.id;
      const disabled = !matchingActions || !info || pending;
      return (
        <Checkbox
          checked={checked}
          disabled={disabled}
          aria-label={ariaLabel}
          onCheckedChange={(value) => {
            if (!matchingActions || !info || pending) return;
            matchingActions.onPolicyChange(
              row,
              nextPolicy(normalizeStockPolicy(info.stockPolicy), value === true)
            );
          }}
          onClick={(event) => event.stopPropagation()}
        />
      );
    };

    const matchingColumns: ColumnDef<ProductVariantTableRow, any>[] =
      matchingActions
        ? [
            columnHelper.display({
              id: 'sellableState',
              header: '운영 상태',
              cell: ({ row }) => {
                const projection = row.original.matchingInfo?.projection;
                if (!projection) {
                  return matchingActions.isLoading ? (
                    <span className="text-sm text-muted-foreground">
                      조회 중
                    </span>
                  ) : (
                    '-'
                  );
                }
                return (
                  <Badge
                    variant={getProductSellableReasonBadgeVariant(
                      projection.reason,
                      projection.isSellable
                    )}
                    title={projection.reason}
                  >
                    {getProductSellableReasonLabel(projection.reason)}
                  </Badge>
                );
              },
            }),
            columnHelper.display({
              id: 'sellableQuantity',
              header: '판매 가능 수량',
              cell: ({ row }) => {
                const projection = row.original.matchingInfo?.projection;
                if (!projection) return '-';
                return (
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium">
                      {projection.sellableQuantity.toLocaleString()}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      재고 기준 {projection.stockBoundQuantity.toLocaleString()}
                    </span>
                  </div>
                );
              },
            }),
            columnHelper.display({
              id: 'matchingDecision',
              header: '매칭',
              cell: ({ row }) => {
                const matching = row.original.matchingInfo?.matching;
                if (!matching) {
                  return <Badge variant="secondary">매칭 없음</Badge>;
                }
                return (
                  <Badge variant="outline">
                    {getMatchingStrategyDecisionLabel(matching)}
                  </Badge>
                );
              },
            }),
            columnHelper.display({
              id: 'skuLinks',
              header: 'SKU 구성',
              cell: ({ row }) => {
                const links = row.original.matchingInfo?.matching?.links ?? [];
                if (links.length === 0) return '-';
                const first = links[0];
                const label = first.skuCode ?? first.skuName ?? first.skuId;
                return (
                  <div className="flex max-w-[180px] flex-col gap-1">
                    <span className="truncate font-mono text-xs" title={label}>
                      {label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {links.length === 1 ? '1개' : `외 ${links.length - 1}개`}
                    </span>
                  </div>
                );
              },
            }),
            columnHelper.display({
              id: 'manualOutOfStock',
              header: '수동 품절',
              cell: ({ row }) => {
                const policy = normalizeStockPolicy(
                  row.original.matchingInfo?.stockPolicy
                );
                return renderPolicyCheckbox(
                  row.original,
                  policy.availabilityOverride === 'manual_out_of_stock',
                  '수동 품절',
                  (current, checked) => ({
                    ...current,
                    availabilityOverride: checked
                      ? 'manual_out_of_stock'
                      : null,
                  })
                );
              },
            }),
            columnHelper.display({
              id: 'preStockSellable',
              header: '선판매',
              cell: ({ row }) => {
                const policy = normalizeStockPolicy(
                  row.original.matchingInfo?.stockPolicy
                );
                return renderPolicyCheckbox(
                  row.original,
                  policy.preStockSellable,
                  '선판매',
                  (current, checked) => ({
                    ...current,
                    preStockSellable: checked,
                  })
                );
              },
            }),
            columnHelper.display({
              id: 'alwaysSellableZeroStock',
              header: '항상 판매',
              cell: ({ row }) => {
                const policy = normalizeStockPolicy(
                  row.original.matchingInfo?.stockPolicy
                );
                return renderPolicyCheckbox(
                  row.original,
                  policy.alwaysSellableZeroStock,
                  '항상 판매',
                  (current, checked) => ({
                    ...current,
                    alwaysSellableZeroStock: checked,
                  })
                );
              },
            }),
            columnHelper.display({
              id: 'matchingActions',
              header: '',
              cell: ({ row }) => (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(event) => {
                    event.stopPropagation();
                    matchingActions.onEditMatching(row.original);
                  }}
                >
                  <Pencil data-icon="inline-start" />
                  매칭
                </Button>
              ),
            }),
          ]
        : [];

    const columns: ColumnDef<ProductVariantTableRow, any>[] = [
      ...(actions
        ? [
            columnHelper.display({
              id: 'select',
              header: ({ table }) => (
                <Checkbox
                  checked={
                    table.getIsAllPageRowsSelected() ||
                    (table.getIsSomePageRowsSelected() && 'indeterminate')
                  }
                  onCheckedChange={(value) =>
                    table.toggleAllPageRowsSelected(!!value)
                  }
                  aria-label="전체 선택"
                  onClick={(event) => event.stopPropagation()}
                />
              ),
              cell: ({ row }) => (
                <Checkbox
                  checked={row.getIsSelected()}
                  onCheckedChange={(value) => row.toggleSelected(!!value)}
                  aria-label="행 선택"
                  onClick={(event) => event.stopPropagation()}
                />
              ),
            }),
          ]
        : []),
      columnHelper.accessor('variantName', {
        header: '이름',
        cell: ({ getValue }) => getValue() ?? '-',
      }),
      ...optionColumns,
      columnHelper.accessor('displayOrder', {
        header: '순서',
        cell: ({ getValue }) => getValue() ?? '-',
      }),
      columnHelper.accessor('isDefault', {
        header: '기본',
        cell: ({ getValue }) =>
          getValue() ? <Badge variant="default">기본</Badge> : null,
      }),
      columnHelper.accessor('status', {
        header: '상태',
        cell: ({ getValue }) => {
          const v = getValue();
          if (!v) return '-';
          return <Badge variant="secondary">{STATUS_LABELS[v] ?? v}</Badge>;
        },
      }),
      ...matchingColumns,
      ...(actions
        ? [
            columnHelper.display({
              id: 'actions',
              header: '',
              cell: ({ row }) => (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(event) => {
                    event.stopPropagation();
                    actions.onEdit(row.original);
                  }}
                >
                  <Pencil data-icon="inline-start" />
                  편집
                </Button>
              ),
            }),
          ]
        : []),
    ];

    return columns;
  }, [actions, matchingActions, optionGroups]);
}
