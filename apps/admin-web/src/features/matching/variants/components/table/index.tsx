'use client';

import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { DataTable } from '@/components/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useVariantsMatchingTableColumns } from '@/hooks/table/columns/use-variants-matching-table-columns';
import { useVariantsMatchingTableFilters } from '@/hooks/table/filters/use-variants-matching-table-filters';
import { useVariantsMatchingTableQuery } from '@/hooks/table/query/use-variants-matching-table-query';
import {
  useMatchings,
  useResolveLegacyIgnoredMatching,
} from '@/lib/services/matching';
import type {
  LegacyIgnoredResolutionTarget,
  MatchingDto,
  MatchingStatus,
} from '@/lib/types/dto/matching';
import { VariantMatchingEditorDialog } from '../editor-dialog';

const PAGE_SIZE = 20;

type VariantsMatchingTableProps = {
  fixedStatus?: MatchingStatus;
};

export function VariantsMatchingTable({
  fixedStatus,
}: VariantsMatchingTableProps = {}) {
  const { searchParams: query } = useVariantsMatchingTableQuery({
    pageSize: PAGE_SIZE,
  });
  const effectiveQuery = useMemo(
    () => (fixedStatus ? { ...query, status: fixedStatus } : query),
    [fixedStatus, query]
  );
  const { data, isLoading, isFetching } = useMatchings(effectiveQuery);
  const baseFilters = useVariantsMatchingTableFilters();
  const filters = fixedStatus ? [] : baseFilters;
  const resolveLegacyIgnored = useResolveLegacyIgnoredMatching();

  const rows = useMemo(() => data?.data ?? [], [data]);
  const total = data?.total ?? 0;

  const [editMatching, setEditMatching] = useState<MatchingDto | null>(null);

  const handleEdit = useCallback(
    (row: MatchingDto) => setEditMatching(row),
    []
  );

  const handleResolveLegacyIgnored = useCallback(
    async (row: MatchingDto, target: LegacyIgnoredResolutionTarget) => {
      const targetLabel =
        target === 'pending' ? '전략 미결정' : '재고상품 비매칭';
      const confirmed = window.confirm(
        `${row.variant?.name ?? row.variantId} 항목을 ${targetLabel}(으)로 정리할까요?`
      );

      if (!confirmed) return;

      try {
        await resolveLegacyIgnored.mutateAsync({
          id: row.id,
          data: {
            target,
            ...(target === 'void' && {
              stockPolicy: row.stockPolicy ?? {
                preStockSellable: true,
                alwaysSellableZeroStock: false,
              },
            }),
          },
        });
        toast.success('레거시 매칭이 정리되었습니다.');
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : '레거시 매칭 정리에 실패했습니다.'
        );
      }
    },
    [resolveLegacyIgnored]
  );

  const columns = useVariantsMatchingTableColumns({
    onEdit: handleEdit,
    onResolveLegacyIgnored: (row, target) => {
      void handleResolveLegacyIgnored(row, target);
    },
    isResolvingLegacyIgnored: resolveLegacyIgnored.isPending,
  });

  const { table } = useDataTable({
    data: rows,
    columns,
    count: total,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.id,
    enableRowSelection: false,
  });

  return (
    <>
      <DataTable
        table={table}
        filters={filters}
        isLoading={isLoading || isFetching}
        noRecords={{ message: '매칭 레코드가 없습니다.' }}
      />

      <VariantMatchingEditorDialog
        matching={editMatching}
        open={!!editMatching}
        onOpenChange={(open) => {
          if (!open) setEditMatching(null);
        }}
      />
    </>
  );
}
