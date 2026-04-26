'use client';

import { useCallback, useState } from 'react';
import { DataTable } from '@/components/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useTransferJobsTableColumns } from '@/hooks/table/columns/use-transfer-jobs-table-columns';
import { useTransferJobsTableFilters } from '@/hooks/table/filters/use-transfer-jobs-table-filters';
import { useTransferJobsTableQuery } from '@/hooks/table/query/use-transfer-jobs-table-query';
import { useTransferJobs, useExecuteTransferJob } from '@/lib/services/inventory';
import type { TransferJobWithLineCountDto } from '@/lib/types/dto/inventory';
import { Button } from '@/components/ui/button';
import { TransferDetailDrawer } from '../transfer-detail-drawer';
import { CreateTransferDialog } from '../create-transfer-dialog';
import { MoveWithinWarehouseDialog } from '../move-within-warehouse-dialog';
import { toast } from 'sonner';

const PAGE_SIZE = 20;

export function TransferJobsTable() {
  const { searchParams: query } = useTransferJobsTableQuery({ pageSize: PAGE_SIZE });
  const { data, isLoading, isFetching } = useTransferJobs(query);
  const filters = useTransferJobsTableFilters();
  const executeMutation = useExecuteTransferJob();

  const [detailRow, setDetailRow] = useState<TransferJobWithLineCountDto | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);

  const handleExecute = useCallback(async (row: TransferJobWithLineCountDto) => {
    try {
      const result = await executeMutation.mutateAsync(row.id);
      toast.success(`이동 작업이 실행되었습니다. (${result.linesExecuted}개 라인 처리)`);
    } catch {
      toast.error('이동 작업 실행에 실패했습니다.');
    }
  }, [executeMutation]);

  const columns = useTransferJobsTableColumns({
    onDetail: setDetailRow,
    onExecute: handleExecute,
  });

  const rows = data?.jobs ?? [];
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
          이동 작업 생성
        </Button>
        <Button variant="outline" size="sm" onClick={() => setMoveOpen(true)}>
          창고 내 간편 이동
        </Button>
      </div>

      <DataTable
        table={table}
        isLoading={isLoading}
        isFetching={isFetching}
        count={total}
        pageSize={PAGE_SIZE}
        filters={filters}
        noRecords={{ message: '이동 작업이 없습니다.' }}
      />

      <TransferDetailDrawer
        row={detailRow}
        open={!!detailRow}
        onOpenChange={(open) => { if (!open) setDetailRow(null); }}
      />

      <CreateTransferDialog open={createOpen} onOpenChange={setCreateOpen} />
      <MoveWithinWarehouseDialog open={moveOpen} onOpenChange={setMoveOpen} />
    </>
  );
}
