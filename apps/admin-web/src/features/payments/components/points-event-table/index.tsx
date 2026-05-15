'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePointsEvents, useCancelEarnPoints } from '@/lib/services/wallet';
import { useDataTable } from '@/hooks/use-data-table';
import { usePointsEventTableColumns } from '@/hooks/table/columns/use-points-event-table-columns';
import { DataTable } from '@/components/data-table';
import { toast } from 'sonner';
import { AlertCircle } from 'lucide-react';

const PAGE_SIZE = 20;
const PREFIX = 'pts';

export function PointsEventTable({ userId }: { userId: string }) {
  const searchParams = useSearchParams();
  const page = Number(searchParams.get(`${PREFIX}_page`) ?? '1');

  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const { data, isLoading, isFetching, isError } = usePointsEvents(userId, page, PAGE_SIZE);
  const cancelMutation = useCancelEarnPoints();

  const handleCancel = async (earnEventId: string) => {
    setCancelingId(earnEventId);
    try {
      await cancelMutation.mutateAsync({ userId, earnEventId });
      toast.success('적립 취소 완료');
    } catch {
      toast.error('적립 취소 실패');
    } finally {
      setCancelingId(null);
    }
  };

  const columns = usePointsEventTableColumns({ onCancel: handleCancel, cancelingId });

  const { table } = useDataTable({
    data: data?.data ?? [],
    columns,
    count: data?.total,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.id,
    prefix: PREFIX,
  });

  if (isError) {
    return (
      <div className="px-4 py-6 flex items-center gap-2 text-sm text-destructive">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>이벤트 목록을 불러오지 못했습니다.</span>
      </div>
    );
  }

  return (
    <DataTable
      table={table}
      isLoading={isLoading}
      isFetching={isFetching}
      count={data?.total ?? 0}
      pageSize={PAGE_SIZE}
      noRecords={{ message: '적립금 내역이 없습니다.' }}
    />
  );
}
