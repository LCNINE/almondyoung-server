'use client';

import { usePointsEvents, useCancelEarnPoints } from '@/lib/services/wallet';
import { useDataTable } from '@/hooks/use-data-table';
import { usePointsEventTableColumns } from '@/hooks/table/columns/use-points-event-table-columns';
import { DataTable } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useState } from 'react';

const PAGE_SIZE = 20;

export function PointsEventTable({ userId }: { userId: string }) {
  const { data, isLoading, isFetching } = usePointsEvents(userId, 1, PAGE_SIZE);
  const columns = usePointsEventTableColumns();
  const cancelMutation = useCancelEarnPoints();
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  const { table } = useDataTable({
    data: data?.data ?? [],
    columns,
    count: data?.total,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.id,
  });

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

  return (
    <div>
      <DataTable
        table={table}
        isLoading={isLoading}
        isFetching={isFetching}
        count={data?.total ?? 0}
        pageSize={PAGE_SIZE}
        noRecords={{ message: '포인트 이벤트가 없습니다.' }}
      />
      {(data?.data ?? []).some((e) => e.eventType === 'EARN') && (
        <div className="border-t px-4 py-2">
          <p className="text-xs text-muted-foreground mb-2">적립 이벤트 취소</p>
          <div className="space-y-1">
            {data?.data
              .filter((e) => e.eventType === 'EARN')
              .map((event) => (
                <div key={event.id} className="flex items-center justify-between text-sm py-1">
                  <span className="font-mono text-xs">
                    {event.id.slice(0, 8)}... (+{Math.abs(event.amount).toLocaleString('ko-KR')})
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    disabled={cancelingId === event.id}
                    onClick={() => handleCancel(event.id)}
                  >
                    {cancelingId === event.id ? '취소 중...' : '취소'}
                  </Button>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
