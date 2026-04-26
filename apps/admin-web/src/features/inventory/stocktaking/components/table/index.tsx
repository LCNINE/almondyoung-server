'use client';

import { useState } from 'react';
import { DataTable } from '@/components/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useStocktakingTableColumns } from '@/hooks/table/columns/use-stocktaking-table-columns';
import { useStocktakingTableFilters } from '@/hooks/table/filters/use-stocktaking-table-filters';
import { useStocktakingTableQuery } from '@/hooks/table/query/use-stocktaking-table-query';
import { useStocktakingSessions } from '@/lib/services/inventory';
import type { StocktakingSessionDto } from '@/lib/types/dto/inventory';
import { Button } from '@/components/ui/button';
import { SessionDetailDrawer } from '../session-detail-drawer';
import { CreateSessionDialog } from '../create-session-dialog';

const PAGE_SIZE = 20;

export function StocktakingTable() {
  const { searchParams: query } = useStocktakingTableQuery({ pageSize: PAGE_SIZE });
  const { data, isLoading, isFetching } = useStocktakingSessions(query);
  const filters = useStocktakingTableFilters();

  const [detailRow, setDetailRow] = useState<StocktakingSessionDto | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const columns = useStocktakingTableColumns({ onDetail: setDetailRow });

  const rows = data?.sessions ?? [];
  const total = data?.total ?? 0;

  const { table } = useDataTable({
    data: rows,
    columns,
    count: total,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.id,
  });

  return (
    <>
      <div className="flex items-center gap-2 px-4 pt-4">
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          세션 생성
        </Button>
      </div>

      <DataTable
        table={table}
        isLoading={isLoading}
        isFetching={isFetching}
        count={total}
        pageSize={PAGE_SIZE}
        filters={filters}
        noRecords={{ message: '재고 실사 세션이 없습니다.' }}
      />

      <SessionDetailDrawer
        row={detailRow}
        open={!!detailRow}
        onOpenChange={(open) => {
          if (!open) setDetailRow(null);
        }}
      />

      <CreateSessionDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
