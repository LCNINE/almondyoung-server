'use client';

import {
  createColumnHelper,
  type ColumnDef,
  type Table as TanstackTable,
} from '@tanstack/react-table';
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
  COMING_SOON_MANUAL_CLEAR_HINT,
  COMING_SOON_WINS_HINT,
  getMatchingStrategyDecisionLabel,
  getProductSellableReasonBadgeVariant,
  getProductSellableReasonLabel,
  normalizeStockPolicy,
  willComingSoonClearOnStock,
} from '@/lib/services/matching';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertTriangle, PackagePlus, Pencil } from 'lucide-react';
import { format } from 'date-fns';

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
  isBulkPending?: boolean;
  /** 옵션이 여러 개인 상품에서 정책 하나를 전 품목에 한 번에 적용한다. */
  onBulkPolicyChange?: (
    rows: ProductVariantTableRow[],
    patch: (policy: StockPolicyDto) => StockPolicyDto
  ) => void;
  onPolicyChange: (row: ProductVariantTableRow, policy: StockPolicyDto) => void;
  onEditMatching: (row: ProductVariantTableRow) => void;
  onAdjustStock: (row: ProductVariantTableRow) => void;
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

    // 출시예정 행의 선판매·항상판매는 지금 적용되는 값이 아니라 입고 후 적용될 값이다.
    // 그래도 편집은 막지 않는다 — 입고 전에 미리 정해두는 게 이 칸의 용도다.
    const comingSoonNote = (policy: StockPolicyDto) =>
      policy.availabilityOverride === 'coming_soon'
        ? COMING_SOON_WINS_HINT
        : undefined;

    // 옵션이 여러 개인 상품은 품목마다 같은 체크를 반복해야 했다. 헤더 체크박스 하나로
    // 전 품목에 일괄 적용한다 — 테이블 관용구라 새 화면도 새 API 도 필요 없다.
    const renderBulkHeader = (
      label: string,
      isOn: (policy: StockPolicyDto) => boolean,
      nextPolicy: (policy: StockPolicyDto, checked: boolean) => StockPolicyDto
    ) =>
      function BulkPolicyHeader({
        table,
      }: {
        table: TanstackTable<ProductVariantTableRow>;
      }) {
        const bulk = matchingActions?.onBulkPolicyChange;
        const rows = table
          .getRowModel()
          .rows.map((r) => r.original)
          .filter((r) => !!r.matchingInfo);

        // 품목이 하나뿐이면 일괄이랄 게 없다 — 행 체크박스로 충분하다.
        if (!bulk || rows.length < 2) {
          return (
            <span className="block text-center whitespace-nowrap">{label}</span>
          );
        }

        const onCount = rows.filter((r) =>
          isOn(normalizeStockPolicy(r.matchingInfo?.stockPolicy))
        ).length;

        return (
          <div className="flex flex-col items-center w-full gap-1">
            <span className="whitespace-nowrap">{label}</span>
            <Checkbox
              checked={
                onCount === 0
                  ? false
                  : onCount === rows.length
                    ? true
                    : 'indeterminate'
              }
              disabled={matchingActions?.isBulkPending}
              aria-label={`${label} — 전체 품목에 적용`}
              title={`${label} — 전체 품목(${rows.length}개)에 일괄 적용`}
              onCheckedChange={(value) =>
                bulk(rows, (policy) => nextPolicy(policy, value === true))
              }
              onClick={(event) => event.stopPropagation()}
            />
          </div>
        );
      };

    const renderPolicyCheckbox = (
      row: ProductVariantTableRow,
      checked: boolean,
      ariaLabel: string,
      nextPolicy: (policy: StockPolicyDto, checked: boolean) => StockPolicyDto,
      note?: string
    ) => {
      const info = row.matchingInfo;
      const pending = matchingActions?.pendingVariantId === row.id;
      const disabled = !matchingActions || !info || pending;
      return (
        // 헤더의 일괄 체크박스와 세로로 맞추려면 셀도 같은 가운데 정렬이어야 한다.
        <div className="flex justify-center w-full">
          <Checkbox
            checked={checked}
            disabled={disabled}
            aria-label={ariaLabel}
            title={note}
            onCheckedChange={(value) => {
              if (!matchingActions || !info || pending) return;
              matchingActions.onPolicyChange(
                row,
                nextPolicy(
                  normalizeStockPolicy(info.stockPolicy),
                  value === true
                )
              );
            }}
            onClick={(event) => event.stopPropagation()}
          />
        </div>
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
                const label = first.skuName ?? first.skuCode ?? first.skuId;
                return (
                  <div className="flex max-w-[180px] flex-col gap-1">
                    <span className="text-xs truncate" title={label}>
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
              header: renderBulkHeader(
                '수동 품절',
                (p) => p.availabilityOverride === 'manual_out_of_stock',
                (p, checked) => ({
                  ...p,
                  availabilityOverride: checked ? 'manual_out_of_stock' : null,
                })
              ),
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
              id: 'comingSoon',
              header: renderBulkHeader(
                '출시 예정',
                (p) => p.availabilityOverride === 'coming_soon',
                (p, checked) => ({
                  ...p,
                  availabilityOverride: checked ? 'coming_soon' : null,
                  comingSoonDate: checked ? p.comingSoonDate : null,
                })
              ),
              cell: ({ row }) => {
                const policy = normalizeStockPolicy(
                  row.original.matchingInfo?.stockPolicy
                );
                const isComingSoon =
                  policy.availabilityOverride === 'coming_soon';
                // 실재고가 안 붙는 상품은 입고 트리거가 영영 안 와 직접 풀기 전까지 영구 품절이다.
                const needsManualClear =
                  isComingSoon &&
                  !willComingSoonClearOnStock(
                    policy,
                    row.original.matchingInfo?.matching?.strategy
                  );

                const dateLabel =
                  isComingSoon && policy.comingSoonDate
                    ? `(${format(new Date(policy.comingSoonDate), 'M/d')})`
                    : null;

                return (
                  // 체크박스는 헤더와 같은 축에 두고, 경고·날짜는 아래로 흘린다. 예전엔
                  // 셋을 가로로 붙여 날짜 폭만큼 체크박스가 헤더에서 밀려나 있었다.
                  <div className="flex w-full flex-col items-center gap-0.5">
                    {renderPolicyCheckbox(
                      row.original,
                      isComingSoon,
                      '출시 예정',
                      (current, checked) => ({
                        ...current,
                        availabilityOverride: checked ? 'coming_soon' : null,
                        comingSoonDate: checked ? current.comingSoonDate : null,
                      })
                    )}
                    {(needsManualClear || dateLabel) && (
                      <span
                        title={
                          needsManualClear
                            ? COMING_SOON_MANUAL_CLEAR_HINT
                            : undefined
                        }
                        className="flex items-center gap-0.5 text-[11px] whitespace-nowrap text-muted-foreground"
                      >
                        {needsManualClear && (
                          <AlertTriangle
                            className="size-3 shrink-0 text-destructive"
                            aria-label={COMING_SOON_MANUAL_CLEAR_HINT}
                          />
                        )}
                        {dateLabel}
                      </span>
                    )}
                  </div>
                );
              },
            }),
            columnHelper.display({
              id: 'preStockSellable',
              header: renderBulkHeader(
                '선판매',
                (p) => p.preStockSellable,
                (p, checked) => ({ ...p, preStockSellable: checked })
              ),
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
                  }),
                  comingSoonNote(policy)
                );
              },
            }),
            columnHelper.display({
              id: 'alwaysSellableZeroStock',
              header: renderBulkHeader(
                '항상 판매',
                (p) => p.alwaysSellableZeroStock,
                (p, checked) => ({ ...p, alwaysSellableZeroStock: checked })
              ),
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
                  }),
                  comingSoonNote(policy)
                );
              },
            }),
            columnHelper.display({
              id: 'matchingActions',
              header: '',
              cell: ({ row }) => {
                const hasSku =
                  (row.original.matchingInfo?.matching?.links?.length ?? 0) > 0;
                return (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!hasSku}
                      title={hasSku ? undefined : '매칭된 SKU가 없습니다'}
                      onClick={(event) => {
                        event.stopPropagation();
                        matchingActions.onAdjustStock(row.original);
                      }}
                    >
                      <PackagePlus data-icon="inline-start" />
                      재고조정
                    </Button>
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
                  </div>
                );
              },
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

      ...optionColumns,
      // 순서(displayOrder)는 실무에서 쓰지 않아 목록에서 감춘다 — 값과 편집 드로어 입력은 유지.
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
